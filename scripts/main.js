/**
 * Token Framer - Main Entry Point
 * Implements "Stop & Swap" pattern to prevent FOUC (Flash of Unframed Content)
 * Fixed to handle Restore actions and Base Image updates correctly.
 */

import { applyFrameToToken, getFrameData, generateFrameForPrototype } from './frame-layer.js';
import { registerTokenConfigHooks } from './token-config.js';
import { registerSettings } from './settings.js';

export const MODULE_ID = 'token-framer';

// Lock to prevent infinite loops when we re-issue the update
const UPDATE_LOCKS = new Set();

export function debugLog(...args) {
  if (game.settings.get(MODULE_ID, 'debugMode')) {
    console.log(`${MODULE_ID} |`, ...args);
  }
}

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing Token Framer`);
  registerSettings();
});

Hooks.once('ready', () => {
  registerTokenConfigHooks();
});

/**
 * INTERCEPTOR: The "Stop & Swap" Logic
 * Handles external art changes (TVA, file picker, etc.)
 */
Hooks.on('preUpdateToken', (document, changes, options, userId) => {
  // 1. Only run for the owner (client-side generation)
  if (!document.isOwner) return true;

  // 2. Ignore if this update is "Locked" (initiated by us)
  if (UPDATE_LOCKS.has(document.id)) {
    UPDATE_LOCKS.delete(document.id);
    return true; 
  }

  // 3. CRITICAL FIX FOR RESTORE: 
  // If the update is deleting the frame data (Restore button), LET IT PASS.
  // The syntax for deletion in Foundry is "-=key": null
  if (changes.flags?.[MODULE_ID]?.['-=frameData'] !== undefined) {
    debugLog('♻️ Restore detected - bypassing interceptor.');
    return true;
  }

  // 4. Check if texture is changing
  const newTexture = changes.texture?.src;
  if (!newTexture) return true;

  // 5. Ignore if it's already a cached file (prevents loops)
  const cacheFolder = game.settings.get(MODULE_ID, 'cacheFolder') || 'token-framer-cache';
  if (newTexture.includes(cacheFolder) || newTexture.includes('token-framer-cache')) return true;

  // 6. Check if Frame is Enabled
  const currentFrameData = document.getFlag(MODULE_ID, 'frameData') ?? {};
  const newFrameData = changes.flags?.[MODULE_ID]?.frameData ?? {};
  const frameData = { ...currentFrameData, ...newFrameData };

  if (newFrameData.enabled === false) return true; 

  if (frameData.enabled && frameData.frameImage) {
    debugLog('🛑 Blocking update for:', newTexture);
    
    // STOP THE UPDATE and run async generation
    performAsyncFrameUpdate(document, changes, newTexture, frameData);
    return false;
  }

  return true;
});

/**
 * Performs the frame generation and re-issues the update
 */
async function performAsyncFrameUpdate(document, originalChanges, baseImage, frameData) {
  try {
    const { getFramedPathForImage } = await import('./frame-layer.js');
    
    debugLog('🎨 Generating frame...');
    const result = await getFramedPathForImage(baseImage, frameData, document.id);

    if (result) {
      // Clone changes
      const newChanges = foundry.utils.deepClone(originalChanges);
      
      // Update texture
      newChanges.texture = newChanges.texture || {};
      newChanges.texture.src = result.path;
      
      // Update flags (NO justIntercepted FLAG HERE)
      newChanges.flags = newChanges.flags || {};
      newChanges.flags[MODULE_ID] = newChanges.flags[MODULE_ID] || {};
      newChanges.flags[MODULE_ID].originalImage = baseImage;
      newChanges.flags[MODULE_ID].currentCacheKey = result.key;

      UPDATE_LOCKS.add(document.id);
      debugLog('🚀 Re-issuing update with frame:', result.path);

      // OPTIMIZATION: Pass the signal in the OPTIONS object (3rd argument)
      // This tells hooks "We did this", but doesn't save to DB.
      await document.update(newChanges, { tokenFramerIntercepted: true });

    } else {
      UPDATE_LOCKS.add(document.id);
      await document.update(originalChanges);
    }
  } catch (err) {
    console.error("Token Framer | Async update failed:", err);
    UPDATE_LOCKS.add(document.id);
    await document.update(originalChanges);
  }
}

/**
 * REACTOR: Handles settings changes and Manual "Original Image" swaps
 */
Hooks.on('updateToken', async (document, changes, options, userId) => {
  if (game.userId !== userId) return;
  
  // CHECK CONTEXT INSTEAD OF FLAGS
  // We check the options object we passed earlier.
  // No need to unsetFlag() because this data isn't in the DB!
  if (options.tokenFramerIntercepted) {
    debugLog('Update handled by interceptor (context detected), skipping reactor.');
    return;
  }

  const token = canvas.tokens?.get(document.id);
  if (!token) return;

  // CRITICAL FIX FOR SETTINGS: Check if frameData OR originalImage changed
  const frameDataChanged = changes.flags?.[MODULE_ID]?.frameData !== undefined;
  const originalImageChanged = changes.flags?.[MODULE_ID]?.originalImage !== undefined;
  
  if (frameDataChanged || originalImageChanged) {
    const frameData = getFrameData(token);
    
    // Only regenerate if enabled
    if (frameData.enabled && frameData.frameImage) {
      debugLog('⚙️ Settings or Base Image changed - Regenerating');
      // This will pick up the NEW originalImage flag automatically
      await applyFrameToToken(token, true);
    }
  }
});

// --- Standard Hooks ---

Hooks.on('createToken', async (document, options, userId) => {
  if (game.userId !== userId) return;
  const token = canvas.tokens?.get(document.id);
  if (!token) return;

  const frameData = getFrameData(token);
  if (frameData.enabled && frameData.frameImage) {
    const currentCacheKey = document.getFlag(MODULE_ID, 'currentCacheKey');
    if (currentCacheKey) return;
    await applyFrameToToken(token);
  }
});

Hooks.on('preCreateToken', (document, data, options, userId) => {
  const actor = document.actor;
  if (!actor) return;
  
  const prototypeFrameData = actor.prototypeToken?.getFlag?.(MODULE_ID, 'frameData');
  const cachedFramePath = actor.prototypeToken?.getFlag?.(MODULE_ID, 'cachedFramePath');
  const originalImage = actor.prototypeToken?.getFlag?.(MODULE_ID, 'originalImage');
  
  if (prototypeFrameData?.enabled && prototypeFrameData?.frameImage) {
    const updateData = {
      [`flags.${MODULE_ID}.frameData`]: prototypeFrameData
    };
    if (cachedFramePath) {
      updateData['texture.src'] = cachedFramePath;
      updateData[`flags.${MODULE_ID}.originalImage`] = originalImage || document.texture.src;
      updateData[`flags.${MODULE_ID}.currentCacheKey`] = cachedFramePath.split('/').pop().replace('.webp', '');
    }
    document.updateSource(updateData);
  }
});

Hooks.on('canvasReady', async () => {
  if (!canvas.tokens?.placeables) return;
  for (const token of canvas.tokens.placeables) {
    const frameData = getFrameData(token);
    if (frameData.enabled && frameData.frameImage) {
      const currentCacheKey = token.document.getFlag(MODULE_ID, 'currentCacheKey');
      if (!currentCacheKey) {
        await applyFrameToToken(token);
      }
    }
  }
});

/**
 * Handles Prototype Token Updates
 * FIX: Now triggers if 'originalImage' changes, not just 'frameData'
 */
Hooks.on('updateActor', async (actor, changes, options, userId) => {
  if (game.userId !== userId) return;
  
  const flags = changes.prototypeToken?.flags?.[MODULE_ID];
  const frameDataChanged = flags?.frameData !== undefined;
  const originalImageChanged = flags?.originalImage !== undefined;
  
  // Exit if neither relevant field changed
  if (!frameDataChanged && !originalImageChanged) return;
  
  const frameData = actor.prototypeToken?.getFlag?.(MODULE_ID, 'frameData');
  
  if (frameData?.enabled && frameData?.frameImage) {
    const originalImage = actor.prototypeToken?.getFlag?.(MODULE_ID, 'originalImage') 
                       || actor.prototypeToken?.texture?.src;
    if (!originalImage) return;
    
    const cacheFolder = game.settings.get(MODULE_ID, 'cacheFolder') || `worlds/${game.world.id}/token-framer-cache`;
    if (originalImage.includes(cacheFolder) || originalImage.includes('token-framer-cache')) return;
    
    debugLog('Generating frame for prototype token via updateActor');
    const cachedPath = await generateFrameForPrototype(originalImage, frameData, actor.id);
    
    if (cachedPath) {
      await actor.update({
        'prototypeToken.texture.src': cachedPath,
        [`prototypeToken.flags.${MODULE_ID}.cachedFramePath`]: cachedPath,
        [`prototypeToken.flags.${MODULE_ID}.originalImage`]: originalImage
      });
    }
  } else if (frameData && !frameData.enabled) {
    const originalImage = actor.prototypeToken?.getFlag?.(MODULE_ID, 'originalImage');
    if (originalImage) {
      await actor.update({
        'prototypeToken.texture.src': originalImage,
        [`prototypeToken.flags.${MODULE_ID}.-=cachedFramePath`]: null,
        [`prototypeToken.flags.${MODULE_ID}.-=originalImage`]: null,
        [`prototypeToken.flags.${MODULE_ID}.-=currentCacheKey`]: null
      });
    }
  }
});