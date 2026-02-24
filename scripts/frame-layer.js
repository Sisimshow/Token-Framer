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
 * Simple deterministic hash function (djb2 algorithm)
 * Always produces the same output for the same input
 */
function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to positive hex string, take first 6 characters
  return Math.abs(hash).toString(16).substring(0, 6);
}

/**
 * Normalize a path by decoding URL encoding
 */
function normalizePath(path) {
  try {
    return decodeURIComponent(path);
  } catch (e) {
    return path;
  }
}

/**
 * Generate a cache key based on base image and frame image paths
 * Format: {baseParentFolder}_{baseFilename}_{frameFilename}_{combinedHash}_token
 */
export function generateCacheKey(baseImagePath, frameImagePath) {
  // Normalize paths - decode URL encoding to ensure consistency
  const normalizedBase = normalizePath(baseImagePath);
  const normalizedFrame = normalizePath(frameImagePath);
  
  // Extract base image info
  const baseParts = normalizedBase.split('/');
  const baseFilename = baseParts.pop().replace(/\.[^.]+$/, '');
  const sanitizedBaseFilename = baseFilename.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
  const baseParentFolder = baseParts.length > 0 ? baseParts[baseParts.length - 1] : '';
  const sanitizedBaseParent = baseParentFolder.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);
  
  // Extract frame image info
  const frameParts = normalizedFrame.split('/');
  const frameFilename = frameParts.pop().replace(/\.[^.]+$/, '');
  const sanitizedFrameFilename = frameFilename.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 25);
  
  // Generate hash of both full paths combined for uniqueness
  const combinedHash = simpleHash(normalizedBase + '|' + normalizedFrame);
  
  const prefix = sanitizedBaseParent ? `${sanitizedBaseParent}_` : '';
  return `${prefix}${sanitizedBaseFilename}_${sanitizedFrameFilename}_${combinedHash}_token`;
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
 * Draw a hexagon path (flat-top orientation)
 */
function drawHexagonPath(ctx, centerX, centerY, radius) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    // Flat-top hexagon: start at 0 degrees (right side)
    const angle = (Math.PI / 3) * i;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
}

/**
 * Apply mask shape to context (none, circle, square, or hexagon)
 * Returns false if no clipping should be applied (shape = 'none')
 */
function applyMaskShape(ctx, shape, centerX, centerY, radius, offsetX = 0, offsetY = 0) {
  // 'none' means no masking - return false to indicate no clip was applied
  if (shape === 'none') {
    return false;
  }
  
  ctx.beginPath();
  
  switch (shape) {
    case 'square':
      const squareSize = radius * 2;
      ctx.rect(
        centerX - radius + offsetX,
        centerY - radius + offsetY,
        squareSize,
        squareSize
      );
      break;
    
    case 'hexagon':
      drawHexagonPath(ctx, centerX + offsetX, centerY + offsetY, radius);
      break;
    
    case 'circle':
    default:
      ctx.arc(centerX + offsetX, centerY + offsetY, radius, 0, Math.PI * 2);
      break;
  }
  
  ctx.clip();
  return true;
}

/**
 * Composite the base image with frame and mask
 */
async function compositeImage(baseImagePath, frameData, size = 1000, quality = 0.95) {
  const {
    frameImage, maskImage, baseScale = 0.9, baseOffsetX = 0, baseOffsetY = 0,
    maskRadius = 0.95, maskScale = 1.0, maskOffsetX = 0, maskOffsetY = 0,
    maskShape = 'circle',
    frameScale = 1.0, frameOffsetX = 0, frameOffsetY = 0,
    baseOverFrame = false,
    bgEnabled = false, bgColor = '#000000',
    bgImage = '', bgImageScale = 1.0, bgImageOffsetX = 0, bgImageOffsetY = 0,
    overlayImage = '', overlayScale = 1.0, overlayOffsetX = 0, overlayOffsetY = 0,
    popOutEnabled = false, popOutDegrees = 180, popOutRotation = 0,
    popOutOffsetX = 0, popOutOffsetY = 0
  } = frameData;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  const centerX = size / 2;
  const centerY = size / 2;

  const [baseImg, frameImg, maskImg, bgImg, overlayImg] = await Promise.all([
    loadImage(baseImagePath),
    loadImage(frameImage),
    maskImage ? loadImage(maskImage) : null,
    bgImage ? loadImage(bgImage).catch(() => null) : null,
    overlayImage ? loadImage(overlayImage).catch(() => null) : null
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

  // Helper function to draw background (color and/or image)
  const drawBackground = (targetCtx) => {
    if (bgEnabled && bgColor) {
      targetCtx.fillStyle = bgColor;
      targetCtx.fillRect(0, 0, size, size);
    }
    
    if (bgImg) {
      const bgDrawSize = size * bgImageScale;
      targetCtx.drawImage(
        bgImg,
        centerX - bgDrawSize / 2 + bgImageOffsetX,
        centerY - bgDrawSize / 2 + bgImageOffsetY,
        bgDrawSize,
        bgDrawSize
      );
    }
  };

  // Helper function to draw the masked base image
  const drawMaskedBase = () => {
    ctx.save();
    
    if (maskImg) {
      // Custom mask image - ignore maskShape
      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = size;
      baseCanvas.height = size;
      const baseCtx = baseCanvas.getContext('2d');
      
      drawBackground(baseCtx);
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
      // Use mask shape (circle, square, hexagon)
      const radius = (size / 2) * maskRadius;
      applyMaskShape(ctx, maskShape, centerX, centerY, radius, maskOffsetX, maskOffsetY);
      
      drawBackground(ctx);
      ctx.drawImage(baseImg, baseDrawX, baseDrawY, baseDrawWidth, baseDrawHeight);
    }
    
    ctx.restore();
  };

  // Helper function to draw the frame
  const drawFrame = () => {
    const frameSize = size * frameScale;
    ctx.drawImage(frameImg, centerX - frameSize / 2 + frameOffsetX, centerY - frameSize / 2 + frameOffsetY, frameSize, frameSize);
  };

  // Helper function to draw the overlay (always on top)
  const drawOverlay = () => {
    if (overlayImg) {
      const overlaySize = size * overlayScale;
      ctx.drawImage(
        overlayImg,
        centerX - overlaySize / 2 + overlayOffsetX,
        centerY - overlaySize / 2 + overlayOffsetY,
        overlaySize,
        overlaySize
      );
    }
  };

  // Helper function to draw the pop-out layer (base image clipped to a pie wedge, above the frame)
  const drawPopOut = () => {
    if (!popOutEnabled || popOutDegrees <= 0) return;
    ctx.save();
    const halfAngle = (popOutDegrees / 2) * Math.PI / 180;
    const centerAngle = (popOutRotation - 90) * Math.PI / 180;
    const popCenterX = centerX + popOutOffsetX;
    const popCenterY = centerY + popOutOffsetY;
    ctx.beginPath();
    ctx.moveTo(popCenterX, popCenterY);
    ctx.arc(popCenterX, popCenterY, size, centerAngle - halfAngle, centerAngle + halfAngle);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(baseImg, baseDrawX, baseDrawY, baseDrawWidth, baseDrawHeight);
    ctx.restore();
  };

  // Draw in order based on baseOverFrame setting
  if (baseOverFrame) {
    drawFrame();
    drawMaskedBase();
  } else {
    drawMaskedBase();
    drawFrame();
  }
  
  // Pop-out draws unmasked base image above the frame in a pie wedge
  drawPopOut();

  // Overlay is always on top of everything
  drawOverlay();

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
export async function getFramedPathForImage(baseImagePath, frameData) {
  // 1. Validate inputs
  if (!frameData.enabled || !frameData.frameImage) return null;

  // 2. Create Cache Key (based on base image + frame image paths)
  const cacheKey = generateCacheKey(baseImagePath, frameData.frameImage);
  
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

  const cacheKey = generateCacheKey(baseImagePath, frameData.frameImage);
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
    if (PIXI.Assets.cache.has(cachedPath)) {
      await PIXI.Assets.unload(cachedPath);
    }
  } catch (e) {
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
export async function generateFrameForPrototype(baseImagePath, frameData) {
  if (!frameData.enabled || !frameData.frameImage || !baseImagePath) {
    return null;
  }

  const cacheKey = generateCacheKey(baseImagePath, frameData.frameImage);
  
  try {
    debugLog('Generating frame for prototype token');
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
 * Regenerate all frames in the world
 * Useful for when the cache is deleted manually
 */
export async function regenerateAllFrames() {
  const confirm = await Dialog.confirm({
    title: game.i18n.localize('TOKEN-FRAMER.Settings.Regenerate.Name'),
    content: `<p>${game.i18n.localize('TOKEN-FRAMER.Settings.Regenerate.ConfirmContent')}</p>`
  });

  if (!confirm) return;

  let count = 0;
  const actors = game.actors.filter(a => a.prototypeToken.flags?.[MODULE_ID]?.frameData?.enabled);
  const scenes = game.scenes.map(s => s.tokens.filter(t => t.flags?.[MODULE_ID]?.frameData?.enabled)).flat();
  const total = actors.length + scenes.length;

  if (total === 0) {
    ui.notifications.info(game.i18n.localize('TOKEN-FRAMER.Notifications.NoFramedTokens'));
    return;
  }

  ui.notifications.info(game.i18n.format('TOKEN-FRAMER.Notifications.RegenerateStart', { total }));
  console.log(`${MODULE_ID} | Starting Mass Regeneration`);

  // 2. Process Actors (Prototype Tokens)
  for (const actor of actors) {
    const frameData = actor.prototypeToken.getFlag(MODULE_ID, 'frameData');
    let originalImage = actor.prototypeToken.getFlag(MODULE_ID, 'originalImage') 
                       || actor.prototypeToken.texture.src;
    
    if (!originalImage) continue;

    // Skip if the original image was lost (current texture is a cached file)
    if (originalImage.includes("token-framer-cache")) {
      console.warn(`${MODULE_ID} | Skipped ${actor.name} - Lost original image source.`);
      continue;
    }

    console.log(`${MODULE_ID} | Regenerating Prototype Token: ${actor.prototypeToken.name} (Actor: ${actor.name})`);
    
    const cachedPath = await generateFrameForPrototype(originalImage, frameData);
    
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
    const result = await getFramedPathForImage(baseImagePath, frameData);

    if (result) {
        await tokenDoc.update({
            'texture.src': result.path,
            [`flags.${MODULE_ID}.currentCacheKey`]: result.key
        });
    }
    count++;
  }

  ui.notifications.info(game.i18n.format('TOKEN-FRAMER.Notifications.RegenerateComplete', { count }));
}