/**
 * Token Framer - Main Entry Point
 * Adds pog-style frames to tokens via image compositing
 */

import { applyFrameToToken, handleBaseImageChange, getFrameData, generateFrameForPrototype } from './frame-layer.js';
import { registerTokenConfigHooks } from './token-config.js';
import { registerSettings } from './settings.js';

export const MODULE_ID = 'token-framer';

/**
 * Debug logging - only outputs when debug mode is enabled
 */
export function debugLog(...args) {
  if (game.settings.get(MODULE_ID, 'debugMode')) {
    console.log(`${MODULE_ID} |`, ...args);
  }
}

/**
 * Initialize module on Foundry init
 */
Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing Token Framer`);
  registerSettings();
});

/**
 * Setup module functionality once Foundry is ready
 */
Hooks.once('ready', () => {
  debugLog('Registering hooks');
  registerTokenConfigHooks();
  debugLog('Token Framer ready');
});

/**
 * Handle token updates
 */
Hooks.on('updateToken', async (document, changes, options, userId) => {
  // Only process on the triggering client
  if (game.userId !== userId) return;
  
  const token = canvas.tokens?.get(document.id);
  if (!token) return;

  const cacheFolder = `worlds/${game.world.id}/token-framer-cache`;
  const customCacheFolder = game.settings.get(MODULE_ID, 'cacheFolder');
  const actualCacheFolder = customCacheFolder || cacheFolder;
  
  const frameDataChanged = changes.flags?.[MODULE_ID]?.frameData !== undefined;
  const originalImageChanged = changes.flags?.[MODULE_ID]?.originalImage !== undefined;
  const textureSrcChanged = changes.texture?.src !== undefined;
  
  // Check if texture.src changed to a non-cached image (e.g., from TVA)
  let newBaseImage = null;
  if (textureSrcChanged) {
    const newSrc = changes.texture.src;
    // Check if this is NOT one of our cached images
    if (!newSrc.includes(actualCacheFolder) && !newSrc.includes('token-framer-cache')) {
      newBaseImage = newSrc;
    }
  }
  
  // Handle combined update from TVA (both texture.src AND frameData changed)
  // This happens when TVA applies a custom config that includes Token Framer settings
  if (newBaseImage && frameDataChanged) {
    debugLog('TVA combined update detected - new base image with frame settings');
    // Update the originalImage FIRST, then apply frame with new settings
    await document.setFlag(MODULE_ID, 'originalImage', newBaseImage);
    await document.unsetFlag(MODULE_ID, 'currentCacheKey');
    await applyFrameToToken(token, true);
    return;
  }
  
  // Handle frameData-only change or originalImage change
  if (frameDataChanged || originalImageChanged) {
    // Frame settings or base image changed - regenerate
    const frameData = getFrameData(token);
    if (frameData.enabled && frameData.frameImage) {
      debugLog('Frame settings or base image changed - regenerating');
      await document.unsetFlag(MODULE_ID, 'currentCacheKey');
      await applyFrameToToken(token, true);
    }
    return;
  }
  
  // Handle texture.src-only change (TVA without custom Token Framer config)
  if (newBaseImage) {
    // This is a new base image (likely from TVA)
    await handleBaseImageChange(token, newBaseImage);
  }
});

/**
 * Handle token creation - apply frame if prototype token has frame settings
 */
Hooks.on('createToken', async (document, options, userId) => {
  // Only process on the triggering client
  if (game.userId !== userId) return;
  
  const token = canvas.tokens?.get(document.id);
  if (!token) return;

  const frameData = getFrameData(token);
  if (frameData.enabled && frameData.frameImage) {
    // Check if frame was already applied in preCreateToken (has currentCacheKey)
    const currentCacheKey = document.getFlag(MODULE_ID, 'currentCacheKey');
    if (currentCacheKey) {
      // Frame already applied from prototype cache
      debugLog('Token created with pre-cached frame');
      return;
    }
    
    // Token has frame settings but no cache - generate now
    await applyFrameToToken(token);
  }
});

/**
 * Handle pre-create token to inherit prototype token settings
 */
Hooks.on('preCreateToken', (document, data, options, userId) => {
  // Check if the actor has prototype token frame settings
  const actor = document.actor;
  if (!actor) return;
  
  // Get prototype token frame data and cached path from actor
  const prototypeFrameData = actor.prototypeToken?.getFlag?.(MODULE_ID, 'frameData');
  const cachedFramePath = actor.prototypeToken?.getFlag?.(MODULE_ID, 'cachedFramePath');
  const originalImage = actor.prototypeToken?.getFlag?.(MODULE_ID, 'originalImage');
  
  if (prototypeFrameData?.enabled && prototypeFrameData?.frameImage) {
    // Build the update object
    const updateData = {
      [`flags.${MODULE_ID}.frameData`]: prototypeFrameData
    };
    
    // If we have a pre-cached frame, use it as the initial texture
    if (cachedFramePath) {
      updateData['texture.src'] = cachedFramePath;
      updateData[`flags.${MODULE_ID}.originalImage`] = originalImage || document.texture.src;
      updateData[`flags.${MODULE_ID}.currentCacheKey`] = cachedFramePath.split('/').pop().replace('.webp', '');
    }
    
    document.updateSource(updateData);
  }
});

/**
 * Apply frames to tokens when canvas is ready
 */
Hooks.on('canvasReady', async () => {
  if (!canvas.tokens?.placeables) return;
  
  // Process each token that has frame data
  for (const token of canvas.tokens.placeables) {
    const frameData = getFrameData(token);
    if (frameData.enabled && frameData.frameImage) {
      // Check if the token already has the correct cached image
      const currentCacheKey = token.document.getFlag(MODULE_ID, 'currentCacheKey');
      if (!currentCacheKey) {
        // Need to apply frame
        await applyFrameToToken(token);
      }
    }
  }
});

/**
 * Handle actor updates - generate frame for prototype token when settings change
 */
Hooks.on('updateActor', async (actor, changes, options, userId) => {
  // Only process on the triggering client
  if (game.userId !== userId) return;
  
  // Check if prototype token frame data was changed
  const frameDataChanged = changes.prototypeToken?.flags?.[MODULE_ID]?.frameData !== undefined;
  
  if (!frameDataChanged) return;
  
  const frameData = actor.prototypeToken?.getFlag?.(MODULE_ID, 'frameData');
  
  // If frame is enabled and has a frame image, generate the cached frame
  if (frameData?.enabled && frameData?.frameImage) {
    // Get the current base image (either original or current texture)
    const originalImage = actor.prototypeToken?.getFlag?.(MODULE_ID, 'originalImage') 
                       || actor.prototypeToken?.texture?.src;
    
    if (!originalImage) return;
    
    // Check if this is already a cached frame (avoid re-processing)
    const cacheFolder = game.settings.get(MODULE_ID, 'cacheFolder') || `worlds/${game.world.id}/token-framer-cache`;
    if (originalImage.includes(cacheFolder) || originalImage.includes('token-framer-cache')) {
      return;
    }
    
    debugLog('Generating frame for prototype token via updateActor');
    
    // Generate the cached frame using actor ID for consistent filename
    const cachedPath = await generateFrameForPrototype(originalImage, frameData, actor.id);
    
    if (cachedPath) {
      // Update the prototype token's texture and store original
      await actor.update({
        'prototypeToken.texture.src': cachedPath,
        [`prototypeToken.flags.${MODULE_ID}.cachedFramePath`]: cachedPath,
        [`prototypeToken.flags.${MODULE_ID}.originalImage`]: originalImage
      });
      debugLog('Prototype token frame applied via form submit:', cachedPath);
    }
  } else if (frameData && !frameData.enabled) {
    // Frame was disabled - restore base image if we have one
    const originalImage = actor.prototypeToken?.getFlag?.(MODULE_ID, 'originalImage');
    if (originalImage) {
      await actor.update({
        'prototypeToken.texture.src': originalImage,
        [`prototypeToken.flags.${MODULE_ID}.-=cachedFramePath`]: null,
        [`prototypeToken.flags.${MODULE_ID}.-=originalImage`]: null,
        [`prototypeToken.flags.${MODULE_ID}.-=currentCacheKey`]: null
      });
      debugLog('Prototype token frame disabled, restored original');
    }
  }
});
