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
 * This ensures:
 * - Same base image + same token = overwrites when settings change
 * - Different base image + same token = new file (preserves old cache)
 * @param {string} baseImagePath - Path to the base image
 * @param {string} id - Token ID or Actor ID
 * @param {boolean} isPrototype - Whether this is for a prototype token
 * @returns {string} Cache key
 */
function generateCacheKey(baseImagePath, id, isPrototype = false) {
  // Extract just the filename without extension from the base image path
  const baseFilename = baseImagePath.split('/').pop().replace(/\.[^.]+$/, '');
  // Sanitize the filename to remove any problematic characters
  const sanitizedFilename = baseFilename.replace(/[^a-zA-Z0-9_-]/g, '_');
  
  const prefix = isPrototype ? 'proto' : 'token';
  return `frame_${prefix}_${id}_${sanitizedFilename}`;
}

/**
 * Get the cache folder path
 * @returns {string} Cache folder path
 */
function getCacheFolder() {
  const customPath = game.settings.get(MODULE_ID, 'cacheFolder');
  if (customPath) return customPath;
  
  // Default to world's data folder
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
    // Folder doesn't exist, create it
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
 * @param {string} src - Image source path
 * @returns {Promise<HTMLImageElement>}
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
 * @param {string} baseImagePath - Path to base token image
 * @param {Object} frameData - Frame configuration
 * @param {number} size - Output size (square)
 * @param {number} quality - WebP quality (0.0 to 1.0)
 * @returns {Promise<Blob>} Composited image as blob
 */
async function compositeImage(baseImagePath, frameData, size = 1000, quality = 0.95) {
  const {
    frameImage,
    maskImage,
    baseScale = 0.9,
    baseOffsetX = 0,
    baseOffsetY = 0,
    maskRadius = 0.95,
    maskScale = 1.0,
    maskOffsetX = 0,
    maskOffsetY = 0,
    frameScale = 1.0,
    frameOffsetX = 0,
    frameOffsetY = 0,
    bgEnabled = false,
    bgColor = '#000000'
  } = frameData;

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  const centerX = size / 2;
  const centerY = size / 2;

  // Load images
  const [baseImg, frameImg, maskImg] = await Promise.all([
    loadImage(baseImagePath),
    loadImage(frameImage),
    maskImage ? loadImage(maskImage) : null
  ]);

  // Calculate base image dimensions maintaining aspect ratio
  const baseAspect = baseImg.width / baseImg.height;
  let baseDrawWidth, baseDrawHeight;
  let baseDrawY; // Vertical position for the base image
  
  if (baseAspect >= 1) {
    // Wider than tall or square - fit to height, center vertically
    baseDrawHeight = size * baseScale;
    baseDrawWidth = baseDrawHeight * baseAspect;
    baseDrawY = centerY - baseDrawHeight / 2 + baseOffsetY;
  } else {
    // Taller than wide (portrait) - fit to width, align to TOP
    // This shows the head/face of character portraits
    baseDrawWidth = size * baseScale;
    baseDrawHeight = baseDrawWidth / baseAspect;
    // Align top of image with top of the masked area
    baseDrawY = centerY - (size * baseScale / 2) + baseOffsetY;
  }
  
  // Horizontal position is always centered
  const baseDrawX = centerX - baseDrawWidth / 2 + baseOffsetX;

  // Create circular or custom mask (independent of base image settings)
  ctx.save();
  
  if (maskImg) {
    // Use custom mask image
    // First, draw background and base image to a temporary canvas
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = size;
    baseCanvas.height = size;
    const baseCtx = baseCanvas.getContext('2d');
    
    // Draw background color first if enabled
    if (bgEnabled && bgColor) {
      baseCtx.fillStyle = bgColor;
      baseCtx.fillRect(0, 0, size, size);
    }
    
    // Draw base image on top of background
    baseCtx.drawImage(
      baseImg,
      baseDrawX,
      baseDrawY,
      baseDrawWidth,
      baseDrawHeight
    );
    
    // Draw mask to another canvas and convert luminosity to alpha
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = size;
    maskCanvas.height = size;
    const maskCtx = maskCanvas.getContext('2d');
    
    // Mask uses its own scale and offset
    const maskDrawSize = size * maskScale;
    maskCtx.drawImage(
      maskImg,
      centerX - maskDrawSize / 2 + maskOffsetX,
      centerY - maskDrawSize / 2 + maskOffsetY,
      maskDrawSize,
      maskDrawSize
    );
    
    // Convert mask luminosity to alpha (white = visible, black = hidden)
    const maskData = maskCtx.getImageData(0, 0, size, size);
    const pixels = maskData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      // Calculate luminosity from RGB
      const luminosity = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
      // If the original alpha is less than luminosity, use the original (for pre-alpha masks)
      // Otherwise use luminosity as alpha
      pixels[i + 3] = Math.min(pixels[i + 3], luminosity);
    }
    maskCtx.putImageData(maskData, 0, 0);
    
    // Apply the alpha mask to the base image
    baseCtx.globalCompositeOperation = 'destination-in';
    baseCtx.drawImage(maskCanvas, 0, 0);
    
    // Draw the masked base to the main canvas
    ctx.drawImage(baseCanvas, 0, 0);
    
  } else {
    // Create circular clip path (uses maskRadius and mask offset)
    ctx.beginPath();
    const radius = (size / 2) * maskRadius;
    ctx.arc(centerX + maskOffsetX, centerY + maskOffsetY, radius, 0, Math.PI * 2);
    ctx.clip();
    
    // Draw background color first if enabled
    if (bgEnabled && bgColor) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, size);
    }
    
    // Draw base image on top of background
    ctx.drawImage(
      baseImg,
      baseDrawX,
      baseDrawY,
      baseDrawWidth,
      baseDrawHeight
    );
  }

  ctx.restore();

  // Draw frame overlay on top
  const frameSize = size * frameScale;
  ctx.drawImage(
    frameImg,
    centerX - frameSize / 2 + frameOffsetX,
    centerY - frameSize / 2 + frameOffsetY,
    frameSize,
    frameSize
  );

  // Convert to blob
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/webp', quality);
  });
}

/**
 * Suppress info notifications during cache file uploads
 * Uses reference counting to handle concurrent uploads
 */
function beginNotificationSuppression() {
  if (notificationSuppressionCount === 0) {
    // First suppression - store the real original function
    originalNotificationInfo = ui.notifications.info.bind(ui.notifications);
    ui.notifications.info = () => {};
  }
  notificationSuppressionCount++;
}

/**
 * Restore info notifications after cache file upload
 * Only restores when all concurrent uploads are complete
 */
function endNotificationSuppression() {
  notificationSuppressionCount--;
  if (notificationSuppressionCount === 0 && originalNotificationInfo) {
    // Last upload complete - restore the real original function
    ui.notifications.info = originalNotificationInfo;
    originalNotificationInfo = null;
  }
}

/**
 * Save composited image to cache
 * @param {Blob} blob - Image blob
 * @param {string} filename - Cache filename
 * @returns {Promise<string>} Path to saved file
 */
async function saveToCacheFile(blob, filename) {
  await ensureCacheFolder();
  
  const folder = getCacheFolder();
  const FilePicker = getFilePicker();
  
  // Convert blob to File
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
 * Apply frame to a token - main entry point
 * @param {Token} token - The token to apply frame to
 * @param {boolean} forceRegenerate - Force regeneration even if cached
 */
export async function applyFrameToToken(token, forceRegenerate = false) {
  const frameData = getFrameData(token);
  
  // If frame is disabled, restore base image
  if (!frameData.enabled || !frameData.frameImage) {
    await restoreOriginalImage(token);
    return;
  }

  // Get the original base image (not the cached frame image)
  let baseImagePath = token.document.getFlag(MODULE_ID, 'originalImage');
  
  // If no original stored, the current texture is the original
  if (!baseImagePath) {
    baseImagePath = token.document.texture.src;
    // Store it for later
    await token.document.setFlag(MODULE_ID, 'originalImage', baseImagePath);
  }

  // Generate cache key based on base image filename + token ID
  // Same base image + same token = same cache file (overwritten when settings change)
  const cacheKey = generateCacheKey(baseImagePath, token.document.id, false);
  
  // Always regenerate to ensure settings are current (file will be overwritten)
  let cachedPath = null;

  try {
    debugLog('Generating framed image for token:', token.name);
    
    // Get cache settings
    const cacheResolution = game.settings.get(MODULE_ID, 'cacheResolution') ?? 1000;
    const cacheQuality = game.settings.get(MODULE_ID, 'cacheQuality') ?? 0.95;
    
    const blob = await compositeImage(baseImagePath, frameData, cacheResolution, cacheQuality);
    cachedPath = await saveToCacheFile(blob, cacheKey);
    
    debugLog('Frame generated and saved for token:', token.name);
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to generate framed image:`, err);
    return;
  }

  // Clear the texture from PIXI's cache to force reload
  // This ensures the updated file is displayed, not a cached version
  try {
    // Remove from PIXI texture cache
    if (PIXI.Assets?.cache?.has(cachedPath)) {
      PIXI.Assets.cache.remove(cachedPath);
    }
    // Also try the texture cache directly
    const texture = PIXI.Texture.from(cachedPath, { resourceOptions: { autoLoad: false } });
    if (texture) {
      PIXI.Texture.removeFromCache(cachedPath);
      texture.destroy(true);
    }
  } catch (e) {
    // Ignore cache clearing errors
    debugLog('Could not clear texture cache:', e);
  }

  // Add cache-busting query parameter to force browser to reload
  const cacheBustedPath = `${cachedPath}?t=${Date.now()}`;

  // Update token to use cached image
  await token.document.update({
    'texture.src': cacheBustedPath,
    [`flags.${MODULE_ID}.currentCacheKey`]: cacheKey
  });
}

/**
 * Restore the base image (remove frame)
 * @param {Token} token - The token to restore
 */
export async function restoreOriginalImage(token) {
  const originalImage = token.document.getFlag(MODULE_ID, 'originalImage');
  
  if (originalImage && token.document.texture.src !== originalImage) {
    debugLog('Restoring base image for token:', token.name);
    await token.document.update({
      'texture.src': originalImage,
      [`flags.${MODULE_ID}.currentCacheKey`]: null
    });
  }
}

/**
 * Generate and cache a framed image for a prototype token
 * This pre-generates the image so new tokens can use it immediately
 * @param {string} baseImagePath - Path to the base token image
 * @param {Object} frameData - Frame configuration data
 * @param {string} actorId - The actor's ID (used for cache filename)
 * @returns {Promise<string|null>} The cached image path, or null on failure
 */
export async function generateFrameForPrototype(baseImagePath, frameData, actorId) {
  if (!frameData.enabled || !frameData.frameImage || !baseImagePath || !actorId) {
    return null;
  }

  // Generate cache key based on base image filename + actor ID
  // Same base image + same actor = same cache file (overwritten when settings change)
  const cacheKey = generateCacheKey(baseImagePath, actorId, true);
  
  // Always regenerate to ensure settings are current (file will be overwritten)
  let cachedPath = null;
  
  try {
    debugLog('Generating frame for prototype token (actor:', actorId, ')');
    
    // Get cache settings
    const cacheResolution = game.settings.get(MODULE_ID, 'cacheResolution') ?? 1000;
    const cacheQuality = game.settings.get(MODULE_ID, 'cacheQuality') ?? 0.95;
    
    const blob = await compositeImage(baseImagePath, frameData, cacheResolution, cacheQuality);
    cachedPath = await saveToCacheFile(blob, cacheKey);
    
    debugLog('Frame generated for prototype:', cachedPath);
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to generate frame for prototype:`, err);
    return null;
  }

  // Clear the texture from PIXI's cache to force reload
  try {
    if (PIXI.Assets?.cache?.has(cachedPath)) {
      PIXI.Assets.cache.remove(cachedPath);
    }
    PIXI.Texture.removeFromCache(cachedPath);
  } catch (e) {
    // Ignore cache clearing errors
  }

  // Add cache-busting query parameter to force browser to reload
  return `${cachedPath}?t=${Date.now()}`;
}

/**
 * Handle base image change (e.g., from Token Variant Art)
 * @param {Token} token - The token
 * @param {string} newImagePath - The new base image path
 */
export async function handleBaseImageChange(token, newImagePath) {
  const frameData = getFrameData(token);
  
  // If frame is not enabled, nothing to do
  if (!frameData.enabled || !frameData.frameImage) {
    return;
  }

  // Check if this is a cached image path (our own output)
  const cacheFolder = getCacheFolder();
  if (newImagePath.includes(cacheFolder)) {
    // This is one of our cached images, ignore
    return;
  }

  debugLog('Base image changed for token:', token.name);

  // Batch update the flags in a single operation to reduce HUD re-renders
  await token.document.update({
    [`flags.${MODULE_ID}.originalImage`]: newImagePath,
    [`flags.${MODULE_ID}.currentCacheKey`]: null
  });
  
  // Apply frame - DON'T force regenerate, let cache handle it
  // The cache key includes the base image path, so if this combo exists, it will be reused
  await applyFrameToToken(token, false);
}
