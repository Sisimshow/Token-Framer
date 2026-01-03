/**
 * Token Framer - Image Compositing Logic
 * Composites base image + mask + frame into a cached image
 * Then uses that cached image as the token's texture
 */

import { MODULE_ID, debugLog } from './main.js';

// Helper to get the v13 FilePicker implementation
const getFilePicker = () => foundry.applications.apps.FilePicker.implementation;

// Notification suppression state - handles concurrent uploads
let notificationSuppressionCount = 0;
let originalNotificationInfo = null;

/**
 * Get frame data from token flags
 * @param {Token} token 
 * @returns {Object} Frame configuration data
 */
export function getFrameData(token) {
  return token.document.getFlag(MODULE_ID, 'frameData') ?? {};
}

/**
 * Generate a cache key based on base image filename and token/actor ID
 */
function generateCacheKey(baseImagePath, id, isPrototype = false) {
  const baseFilename = baseImagePath.split('/').pop().replace(/\.[^.]+$/, '');
  const sanitizedFilename = baseFilename.replace(/[^a-zA-Z0-9_-]/g, '_');
  const prefix = isPrototype ? 'proto' : 'token';
  return `frame_${prefix}_${id}_${sanitizedFilename}`;
}

/**
 * Get the cache folder path
 */
function getCacheFolder() {
  const customPath = game.settings.get(MODULE_ID, 'cacheFolder');
  if (customPath) return customPath;
  return `worlds/${game.world.id}/token-framer-cache`;
}

/**
 * Ensure the cache folder exists
 */
async function ensureCacheFolder() {
  const folder = getCacheFolder();
  const FilePicker = getFilePicker();
  try {
    await FilePicker.browse('data', folder);
  } catch (e) {
    try {
      await FilePicker.createDirectory('data', folder);
      debugLog('Created cache folder:', folder);
    } catch (createErr) {
      console.error(`${MODULE_ID} | Failed to create cache folder:`, createErr);
    }
  }
}

/**
 * Load an image and return as HTMLImageElement
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/**
 * Composite the base image with frame and mask
 */
async function compositeImage(baseImagePath, frameData, size = 1000, quality = 0.95) {
  const {
    frameImage, maskImage, baseScale = 0.9, baseOffsetX = 0, baseOffsetY = 0,
    maskRadius = 0.95, maskScale = 1.0, maskOffsetX = 0, maskOffsetY = 0,
    frameScale = 1.0, frameOffsetX = 0, frameOffsetY = 0, bgEnabled = false, bgColor = '#000000'
  } = frameData;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  const centerX = size / 2;
  const centerY = size / 2;

  const [baseImg, frameImg, maskImg] = await Promise.all([
    loadImage(baseImagePath),
    loadImage(frameImage),
    maskImage ? loadImage(maskImage) : null
  ]);

  const baseAspect = baseImg.width / baseImg.height;
  let baseDrawWidth, baseDrawHeight, baseDrawY;
  
  if (baseAspect >= 1) {
    baseDrawHeight = size * baseScale;
    baseDrawWidth = baseDrawHeight * baseAspect;
    baseDrawY = centerY - baseDrawHeight / 2 + baseOffsetY;
  } else {
    baseDrawWidth = size * baseScale;
    baseDrawHeight = baseDrawWidth / baseAspect;
    baseDrawY = centerY - (size * baseScale / 2) + baseOffsetY;
  }
  
  const baseDrawX = centerX - baseDrawWidth / 2 + baseOffsetX;

  ctx.save();
  
  if (maskImg) {
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = size;
    baseCanvas.height = size;
    const baseCtx = baseCanvas.getContext('2d');
    
    if (bgEnabled && bgColor) {
      baseCtx.fillStyle = bgColor;
      baseCtx.fillRect(0, 0, size, size);
    }
    
    baseCtx.drawImage(baseImg, baseDrawX, baseDrawY, baseDrawWidth, baseDrawHeight);
    
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = size;
    maskCanvas.height = size;
    const maskCtx = maskCanvas.getContext('2d');
    const maskDrawSize = size * maskScale;
    
    maskCtx.drawImage(maskImg, centerX - maskDrawSize / 2 + maskOffsetX, centerY - maskDrawSize / 2 + maskOffsetY, maskDrawSize, maskDrawSize);
    
    const maskData = maskCtx.getImageData(0, 0, size, size);
    const pixels = maskData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const luminosity = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
      pixels[i + 3] = Math.min(pixels[i + 3], luminosity);
    }
    maskCtx.putImageData(maskData, 0, 0);
    
    baseCtx.globalCompositeOperation = 'destination-in';
    baseCtx.drawImage(maskCanvas, 0, 0);
    ctx.drawImage(baseCanvas, 0, 0);
  } else {
    ctx.beginPath();
    const radius = (size / 2) * maskRadius;
    ctx.arc(centerX + maskOffsetX, centerY + maskOffsetY, radius, 0, Math.PI * 2);
    ctx.clip();
    
    if (bgEnabled && bgColor) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, size);
    }
    
    ctx.drawImage(baseImg, baseDrawX, baseDrawY, baseDrawWidth, baseDrawHeight);
  }

  ctx.restore();

  const frameSize = size * frameScale;
  ctx.drawImage(frameImg, centerX - frameSize / 2 + frameOffsetX, centerY - frameSize / 2 + frameOffsetY, frameSize, frameSize);

  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/webp', quality);
  });
}

/**
 * Suppress info notifications during cache file uploads
 */
function beginNotificationSuppression() {
  if (notificationSuppressionCount === 0) {
    originalNotificationInfo = ui.notifications.info.bind(ui.notifications);
    ui.notifications.info = () => {};
  }
  notificationSuppressionCount++;
}

/**
 * Restore info notifications after cache file upload
 */
function endNotificationSuppression() {
  notificationSuppressionCount--;
  if (notificationSuppressionCount === 0 && originalNotificationInfo) {
    ui.notifications.info = originalNotificationInfo;
    originalNotificationInfo = null;
  }
}

/**
 * Save composited image to cache
 */
async function saveToCacheFile(blob, filename) {
  await ensureCacheFolder();
  const folder = getCacheFolder();
  const FilePicker = getFilePicker();
  const file = new File([blob], `${filename}.webp`, { type: 'image/webp' });
  
  beginNotificationSuppression();
  
  try {
    const response = await FilePicker.upload('data', folder, file, { notify: false });
    debugLog('Saved cache file:', response.path);
    return response.path;
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to save cache file:`, err);
    throw err;
  } finally {
    endNotificationSuppression();
  }
}

/**
 * CRITICAL HELPER: Generates a framed image path WITHOUT updating the token document.
 * Used by main.js "Stop & Swap" logic.
 */
export async function getFramedPathForImage(baseImagePath, frameData, id, isPrototype = false) {
  // 1. Validate inputs
  if (!frameData.enabled || !frameData.frameImage) return null;

  // 2. Create Cache Key
  const cacheKey = generateCacheKey(baseImagePath, id, isPrototype);
  
  // 3. Generate the Blob (The slow part)
  const cacheResolution = game.settings.get(MODULE_ID, 'cacheResolution') ?? 1000;
  const cacheQuality = game.settings.get(MODULE_ID, 'cacheQuality') ?? 0.95;
  
  try {
    const blob = await compositeImage(baseImagePath, frameData, cacheResolution, cacheQuality);
    const cachedPath = await saveToCacheFile(blob, cacheKey);
    
    // Add cache busting
    return {
      path: `${cachedPath}?t=${Date.now()}`,
      key: cacheKey
    };
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to generate framed image:`, err);
    return null;
  }
}

/**
 * Apply frame to a token - Used when modifying SLIDERS/SETTINGS
 * (Not used during art swaps anymore, that is handled by getFramedPathForImage)
 */
export async function applyFrameToToken(token, forceRegenerate = false) {
  const frameData = getFrameData(token);
  
  // If frame is disabled, restore base image
  if (!frameData.enabled || !frameData.frameImage) {
    await restoreOriginalImage(token);
    return;
  }

  let baseImagePath = token.document.getFlag(MODULE_ID, 'originalImage');
  if (!baseImagePath) {
    baseImagePath = token.document.texture.src;
    await token.document.setFlag(MODULE_ID, 'originalImage', baseImagePath);
  }

  const cacheKey = generateCacheKey(baseImagePath, token.document.id, false);
  let cachedPath = null;

  try {
    debugLog('Generating framed image for token:', token.name);
    const cacheResolution = game.settings.get(MODULE_ID, 'cacheResolution') ?? 1000;
    const cacheQuality = game.settings.get(MODULE_ID, 'cacheQuality') ?? 0.95;
    
    const blob = await compositeImage(baseImagePath, frameData, cacheResolution, cacheQuality);
    cachedPath = await saveToCacheFile(blob, cacheKey);
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to generate framed image:`, err);
    return;
  }

  // Clear texture cache
   try {
       // Modern V12/V13 way
       if (PIXI.Assets.cache.has(cachedPath)) {
           await PIXI.Assets.unload(cachedPath);
       }
   } catch (e) {
       // Fallback for older versions or weird states
       try {
           PIXI.Texture.removeFromCache(cachedPath);
       } catch (e2) {}
   }

  await token.document.update({
    'texture.src': `${cachedPath}?t=${Date.now()}`,
    [`flags.${MODULE_ID}.currentCacheKey`]: cacheKey
  });
}

/**
 * Restore the base image (remove frame)
 */
export async function restoreOriginalImage(token) {
  const originalImage = token.document.getFlag(MODULE_ID, 'originalImage');
  
  if (originalImage) {
    debugLog('Restoring base image for token:', token.name);
    await token.document.update({
      'texture.src': originalImage,
      [`flags.${MODULE_ID}.-=frameData`]: null,
      [`flags.${MODULE_ID}.-=originalImage`]: null,
      [`flags.${MODULE_ID}.-=currentCacheKey`]: null,
      [`flags.${MODULE_ID}.-=cachedFramePath`]: null
    });
  }
}

/**
 * Generate and cache a framed image for a prototype token
 */
export async function generateFrameForPrototype(baseImagePath, frameData, actorId) {
  if (!frameData.enabled || !frameData.frameImage || !baseImagePath || !actorId) {
    return null;
  }

  const cacheKey = generateCacheKey(baseImagePath, actorId, true);
  
  try {
    debugLog('Generating frame for prototype token (actor:', actorId, ')');
    const cacheResolution = game.settings.get(MODULE_ID, 'cacheResolution') ?? 1000;
    const cacheQuality = game.settings.get(MODULE_ID, 'cacheQuality') ?? 0.95;
    
    const blob = await compositeImage(baseImagePath, frameData, cacheResolution, cacheQuality);
    const cachedPath = await saveToCacheFile(blob, cacheKey);
    
    // Clear texture cache (Updated to match applyFrameToToken logic)
    try {
      if (PIXI.Assets?.cache?.has(cachedPath)) {
        await PIXI.Assets.unload(cachedPath);
      }
    } catch (e) {
      try {
        PIXI.Texture.removeFromCache(cachedPath);
      } catch (e2) {}
    }

    return `${cachedPath}?t=${Date.now()}`;
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to generate frame for prototype:`, err);
    return null;
  }
}

/**
 * DEPRECATED: Stubs for compatibility
 * We now handle art changes in main.js via preUpdateToken
 */
export async function handleBaseImageChange(token, newImagePath) {
  return;
}

/**
 * Regenerate all frames in the world
 * Useful for when the cache is deleted manually
 */
export async function regenerateAllFrames() {
  const confirm = await Dialog.confirm({
    title: "Regenerate All Frames",
    content: "<p>This will scan all Actors and Tokens in your world. If they have Token Framer settings, it will regenerate their cached images.<br><br><strong>Use this after manually emptying your cache folder to fix broken images.</strong></p>"
  });

  if (!confirm) return;

  // 1. Counters for the progress notification
  let count = 0;
  const actors = game.actors.filter(a => a.prototypeToken.flags?.[MODULE_ID]?.frameData?.enabled);
  const scenes = game.scenes.map(s => s.tokens.filter(t => t.flags?.[MODULE_ID]?.frameData?.enabled)).flat();
  const total = actors.length + scenes.length;

  if (total === 0) {
    ui.notifications.info("No framed tokens found to regenerate.");
    return;
  }

  ui.notifications.info(`Starting regeneration of ${total} tokens... check console for details.`);
  console.log(`${MODULE_ID} | Starting Mass Regeneration`);

  // 2. Process Actors (Prototype Tokens)
  for (const actor of actors) {
    const frameData = actor.prototypeToken.getFlag(MODULE_ID, 'frameData');
    const originalImage = actor.prototypeToken.getFlag(MODULE_ID, 'originalImage') 
                       || actor.prototypeToken.texture.src;
    
    if (!originalImage) continue;

    console.log(`${MODULE_ID} | Regenerating Actor: ${actor.name}`);
    
    const cachedPath = await generateFrameForPrototype(originalImage, frameData, actor.id);
    
    if (cachedPath) {
      await actor.update({
        'prototypeToken.texture.src': cachedPath,
        [`prototypeToken.flags.${MODULE_ID}.cachedFramePath`]: cachedPath
      });
    }
    count++;
  }

  // 3. Process Placed Tokens (in Scenes)
  for (const tokenDoc of scenes) {
    console.log(`${MODULE_ID} | Regenerating Token: ${tokenDoc.name} in scene ${tokenDoc.parent.name}`);
    
    const frameData = tokenDoc.getFlag(MODULE_ID, 'frameData');
    let baseImagePath = tokenDoc.getFlag(MODULE_ID, 'originalImage');
    
    if (!baseImagePath) baseImagePath = tokenDoc.texture.src;

    if (baseImagePath.includes("token-framer-cache")) {
        console.warn(`${MODULE_ID} | Skipped ${tokenDoc.name} - Lost original image source.`);
        continue;
    }

    // Direct call since we are in the same file now
    const result = await getFramedPathForImage(baseImagePath, frameData, tokenDoc.id);

    if (result) {
        await tokenDoc.update({
            'texture.src': result.path,
            [`flags.${MODULE_ID}.currentCacheKey`]: result.key
        });
    }
    count++;
  }

  ui.notifications.info(`${MODULE_ID} | Regeneration Complete! Processed ${count} assets.`);
}