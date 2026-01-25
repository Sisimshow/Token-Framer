/**
 * Token Framer - Token Configuration UI
 * 
 * Injects frame controls (enable checkbox + configure button) into the Token Config.
 * Opens a separate dialog for frame settings to avoid prototype token form state issues.
 * Uses a pending data pattern for prototype tokens to defer saves until form submission.
 */

import { MODULE_ID, debugLog } from './main.js';
import { applyFrameToToken, restoreOriginalImage, generateFrameForPrototype } from './frame-layer.js';

// Debounce timer for preview updates
let previewDebounceTimer = null;
const PREVIEW_DEBOUNCE_MS = 150;

// Pending frame data for prototype tokens (keyed by actor ID)
// This is used to defer saves until the TokenConfig form is submitted
const PENDING_PROTOTYPE_DATA = new Map();

/**
 * Get pending frame data for an actor
 */
export function getPendingPrototypeData(actorId) {
  return PENDING_PROTOTYPE_DATA.get(actorId);
}

/**
 * Clear pending frame data for an actor
 */
export function clearPendingPrototypeData(actorId) {
  PENDING_PROTOTYPE_DATA.delete(actorId);
}

/**
 * Register hooks for Token Configuration UI injection
 */
export function registerTokenConfigHooks() {
  // v13 uses renderTokenApplication for both placed tokens and prototype tokens
  Hooks.on('renderTokenApplication', renderTokenFrameControls);
}

/**
 * Get default values from module settings
 */
function getDefaultSettings() {
  return {
    baseScale: game.settings.get(MODULE_ID, 'defaultBaseScale') ?? 0.9,
    frameScale: game.settings.get(MODULE_ID, 'defaultFrameScale') ?? 1.0,
    maskScale: game.settings.get(MODULE_ID, 'defaultMaskScale') ?? 0.95,
    overlayScale: game.settings.get(MODULE_ID, 'defaultOverlayScale') ?? 1.0,
    bgImageScale: game.settings.get(MODULE_ID, 'defaultBgImageScale') ?? 1.0,
    defaultFrameImage: game.settings.get(MODULE_ID, 'defaultFrameImage') ?? 'modules/token-framer/assets/default.webp'
  };
}

/**
 * Load an image and return as HTMLImageElement
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

/**
 * Draw a hexagon path (flat-top orientation)
 */
function drawHexagonPath(ctx, centerX, centerY, radius) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
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
  // 'none' means no masking
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
 * Generate a preview image using Canvas compositing
 */
async function generatePreview(baseImagePath, frameData, size = 200) {
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
    maskShape = 'circle',
    frameScale = 1.0,
    frameOffsetX = 0,
    frameOffsetY = 0,
    baseOverFrame = false,
    bgEnabled = false,
    bgColor = '#000000',
    bgImage = '',
    bgImageScale = 1.0,
    bgImageOffsetX = 0,
    bgImageOffsetY = 0,
    overlayImage = '',
    overlayScale = 1.0,
    overlayOffsetX = 0,
    overlayOffsetY = 0
  } = frameData;

  if (!baseImagePath || !frameImage) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  const centerX = size / 2;
  const centerY = size / 2;

  try {
    const [baseImg, frameImg, maskImg, bgImg, overlayImg] = await Promise.all([
      loadImage(baseImagePath),
      loadImage(frameImage),
      maskImage ? loadImage(maskImage).catch(() => null) : null,
      bgImage ? loadImage(bgImage).catch(() => null) : null,
      overlayImage ? loadImage(overlayImage).catch(() => null) : null
    ]);

    const baseAspect = baseImg.width / baseImg.height;
    let baseDrawWidth, baseDrawHeight;
    let baseDrawY;
    
    const offsetScale = size / 512;
    const scaledBaseOffsetX = baseOffsetX * offsetScale;
    const scaledBaseOffsetY = baseOffsetY * offsetScale;
    const scaledMaskOffsetX = maskOffsetX * offsetScale;
    const scaledMaskOffsetY = maskOffsetY * offsetScale;
    const scaledFrameOffsetX = frameOffsetX * offsetScale;
    const scaledFrameOffsetY = frameOffsetY * offsetScale;
    
    if (baseAspect >= 1) {
      baseDrawHeight = size * baseScale;
      baseDrawWidth = baseDrawHeight * baseAspect;
      baseDrawY = centerY - baseDrawHeight / 2 + scaledBaseOffsetY;
    } else {
      baseDrawWidth = size * baseScale;
      baseDrawHeight = baseDrawWidth / baseAspect;
      baseDrawY = centerY - (size * baseScale / 2) + scaledBaseOffsetY;
    }
    
    const baseDrawX = centerX - baseDrawWidth / 2 + scaledBaseOffsetX;
    
    // Scale background image offsets
    const scaledBgImageOffsetX = bgImageOffsetX * offsetScale;
    const scaledBgImageOffsetY = bgImageOffsetY * offsetScale;

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
          centerX - bgDrawSize / 2 + scaledBgImageOffsetX,
          centerY - bgDrawSize / 2 + scaledBgImageOffsetY,
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
        maskCtx.drawImage(
          maskImg,
          centerX - maskDrawSize / 2 + scaledMaskOffsetX,
          centerY - maskDrawSize / 2 + scaledMaskOffsetY,
          maskDrawSize,
          maskDrawSize
        );
        
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
        applyMaskShape(ctx, maskShape, centerX, centerY, radius, scaledMaskOffsetX, scaledMaskOffsetY);
        
        drawBackground(ctx);
        ctx.drawImage(baseImg, baseDrawX, baseDrawY, baseDrawWidth, baseDrawHeight);
      }

      ctx.restore();
    };

    // Helper function to draw the frame
    const drawFrame = () => {
      const frameSize = size * frameScale;
      ctx.drawImage(
        frameImg,
        centerX - frameSize / 2 + scaledFrameOffsetX,
        centerY - frameSize / 2 + scaledFrameOffsetY,
        frameSize,
        frameSize
      );
    };

    // Scale overlay offsets
    const scaledOverlayOffsetX = overlayOffsetX * offsetScale;
    const scaledOverlayOffsetY = overlayOffsetY * offsetScale;

    // Helper function to draw the overlay (always on top)
    const drawOverlay = () => {
      if (overlayImg) {
        const overlaySize = size * overlayScale;
        ctx.drawImage(
          overlayImg,
          centerX - overlaySize / 2 + scaledOverlayOffsetX,
          centerY - overlaySize / 2 + scaledOverlayOffsetY,
          overlaySize,
          overlaySize
        );
      }
    };

    // Draw in order based on baseOverFrame setting
    if (baseOverFrame) {
      // Frame first, then base on top
      drawFrame();
      drawMaskedBase();
    } else {
      // Base first, then frame on top (default)
      drawMaskedBase();
      drawFrame();
    }
    
    // Overlay is always on top of everything
    drawOverlay();

    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error(`${MODULE_ID} | Preview generation failed:`, err);
    return null;
  }
}

/**
 * Check if a path is from the Token Framer cache
 */
function isFromCache(imagePath) {
  if (!imagePath) return false;
  
  const customCacheFolder = game.settings.get(MODULE_ID, 'cacheFolder');
  if (customCacheFolder && imagePath.includes(customCacheFolder)) {
    return true;
  }
  
  const defaultCacheFolder = `worlds/${game.world.id}/token-framer-cache`;
  if (imagePath.includes(defaultCacheFolder)) {
    return true;
  }
  
  if (imagePath.includes('token-framer-cache')) {
    return true;
  }
  
  return false;
}

/**
 * Token Framer Dialog - Separate window for frame configuration
 */
class TokenFramerDialog extends FormApplication {
  constructor(token, tokenConfigApp = null) {
    super({}, {});
    this.token = token;
    this.tokenConfigApp = tokenConfigApp;
    this.baseImagePath = '';
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'token-framer-dialog',
      classes: ['token-framer-dialog-app', 'standard-form'],
      template: `modules/${MODULE_ID}/templates/frame-dialog.hbs`,
      width: 1050,
      height: 800,
      title: game.i18n.localize('TOKEN-FRAMER.Config.DialogTitle'),
      resizable: true
    });
  }

  async getData() {
    const frameData = await this.token.getFlag(MODULE_ID, 'frameData') ?? {};
    const defaults = getDefaultSettings();
    
    // Get original image - prefer stored original, then current texture
    let originalImage = await this.token.getFlag(MODULE_ID, 'originalImage');
    if (!originalImage || isFromCache(originalImage)) {
      originalImage = this.token.texture?.src ?? '';
      if (isFromCache(originalImage)) {
        originalImage = '';
      }
    }
    this.baseImagePath = originalImage;

    return {
      moduleId: MODULE_ID,
      baseImage: originalImage,
      frameImage: frameData.frameImage ?? defaults.defaultFrameImage,
      maskImage: frameData.maskImage ?? '',
      baseScale: frameData.baseScale ?? defaults.baseScale,
      baseOffsetX: frameData.baseOffsetX ?? 0,
      baseOffsetY: frameData.baseOffsetY ?? 0,
      maskSize: frameData.maskImage ? (frameData.maskScale ?? defaults.maskScale) : (frameData.maskRadius ?? defaults.maskScale),
      maskOffsetX: frameData.maskOffsetX ?? 0,
      maskOffsetY: frameData.maskOffsetY ?? 0,
      maskShape: frameData.maskShape ?? 'circle',
      frameScale: frameData.frameScale ?? defaults.frameScale,
      frameOffsetX: frameData.frameOffsetX ?? 0,
      frameOffsetY: frameData.frameOffsetY ?? 0,
      baseOverFrame: frameData.baseOverFrame ? 'checked' : '',
      bgEnabled: frameData.bgEnabled ? 'checked' : '',
      bgColor: frameData.bgColor ?? '#000000',
      bgImage: frameData.bgImage ?? '',
      bgImageScale: frameData.bgImageScale ?? defaults.bgImageScale,
      bgImageOffsetX: frameData.bgImageOffsetX ?? 0,
      bgImageOffsetY: frameData.bgImageOffsetY ?? 0,
      overlayImage: frameData.overlayImage ?? '',
      overlayScale: frameData.overlayScale ?? defaults.overlayScale,
      overlayOffsetX: frameData.overlayOffsetX ?? 0,
      overlayOffsetY: frameData.overlayOffsetY ?? 0
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    
    const rootEl = html[0];
    
    // File picker buttons
    rootEl.querySelectorAll('.tfl-file-picker').forEach(button => {
      button.addEventListener('click', () => {
        const targetName = button.dataset.target;
        const input = rootEl.querySelector(`input[name="${targetName}"]`);
        
        new foundry.applications.apps.FilePicker.implementation({
          type: 'imagevideo',
          current: input?.value ?? '',
          callback: (path) => {
            if (targetName === 'baseImage' && isFromCache(path)) {
              ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.CachedImageWarning'));
              return;
            }
            if (input) {
              input.value = path;
              if (targetName === 'baseImage') {
                this.baseImagePath = path;
              }
              this._debouncedPreviewUpdate(rootEl);
            }
          }
        }).render();
      });
    });

    // Refresh button - sync from TokenConfig's Image Path
    const refreshButton = rootEl.querySelector('.tfl-refresh-button');
    if (refreshButton) {
      refreshButton.addEventListener('click', () => {
        const newPath = this._getTokenConfigImagePath();
        
        if (!newPath) {
          ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.NoImagePath'));
          return;
        }
        
        if (isFromCache(newPath)) {
          ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.CachedImageWarning'));
          return;
        }
        
        const baseImageInput = rootEl.querySelector('input[name="baseImage"]');
        if (baseImageInput) {
          baseImageInput.value = newPath;
        }
        this.baseImagePath = newPath;
        this._debouncedPreviewUpdate(rootEl);
        debugLog('Base image refreshed to:', newPath);
      });
    }

    // Save Image button - export composited image to file
    const saveImageButton = rootEl.querySelector('.tfl-save-image-button');
    if (saveImageButton) {
      saveImageButton.addEventListener('click', async () => {
        await this._saveImageToFile(rootEl);
      });
    }

    // Range slider and number input two-way sync with preview update
    rootEl.querySelectorAll('input[type="range"]').forEach(rangeInput => {
      const numberInput = rootEl.querySelector(`input.range-value[data-for="${rangeInput.name}"]`);
      
      // Range slider changes -> update number input
      rangeInput.addEventListener('input', () => {
        if (numberInput) {
          numberInput.value = parseFloat(rangeInput.value).toFixed(2);
        }
        this._debouncedPreviewUpdate(rootEl);
      });
      
      if (numberInput) {
        // Number input changes -> update range slider
        numberInput.addEventListener('input', () => {
          const val = parseFloat(numberInput.value);
          if (!isNaN(val)) {
            // Clamp to range slider bounds
            const min = parseFloat(rangeInput.min);
            const max = parseFloat(rangeInput.max);
            rangeInput.value = Math.min(max, Math.max(min, val));
          }
          this._debouncedPreviewUpdate(rootEl);
        });
        
        // Mouse wheel scrolling on number input
        numberInput.addEventListener('wheel', (e) => {
          e.preventDefault();
          const step = parseFloat(rangeInput.step) || 0.01;
          const min = parseFloat(rangeInput.min);
          const max = parseFloat(rangeInput.max);
          let currentVal = parseFloat(numberInput.value) || 0;
          
          // Scroll up = increase, scroll down = decrease
          if (e.deltaY < 0) {
            currentVal = Math.min(max, currentVal + step);
          } else {
            currentVal = Math.max(min, currentVal - step);
          }
          
          numberInput.value = currentVal.toFixed(2);
          rangeInput.value = currentVal;
          this._debouncedPreviewUpdate(rootEl);
        });
      }
    });

    // Number inputs
    rootEl.querySelectorAll('input[type="number"]').forEach(input => {
      input.addEventListener('input', () => {
        this._debouncedPreviewUpdate(rootEl);
      });
    });

    // Text inputs (file paths)
    rootEl.querySelectorAll('input[type="text"]:not(.tfl-color-text)').forEach(input => {
      input.addEventListener('change', () => {
        if (input.name === 'baseImage') {
          if (isFromCache(input.value)) {
            ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.CachedImageWarning'));
            input.value = this.baseImagePath;
            return;
          }
          this.baseImagePath = input.value;
        }
        this._debouncedPreviewUpdate(rootEl);
      });
    });

    // Color picker syncing
    const colorPicker = rootEl.querySelector('input[name="bgColor"]');
    const colorText = rootEl.querySelector('input[name="bgColorText"]');
    
    if (colorPicker && colorText) {
      colorPicker.addEventListener('input', () => {
        colorText.value = colorPicker.value.toUpperCase();
        this._debouncedPreviewUpdate(rootEl);
      });
      
      colorText.addEventListener('change', () => {
        const hexMatch = colorText.value.match(/^#?([0-9A-Fa-f]{6})$/);
        if (hexMatch) {
          const hexColor = `#${hexMatch[1].toUpperCase()}`;
          colorText.value = hexColor;
          colorPicker.value = hexColor;
          this._debouncedPreviewUpdate(rootEl);
        } else {
          colorText.value = colorPicker.value.toUpperCase();
        }
      });
    }

    // Checkbox inputs that affect preview
    rootEl.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        this._debouncedPreviewUpdate(rootEl);
      });
    });

    // Select dropdowns (mask shape, etc.)
    rootEl.querySelectorAll('select').forEach(select => {
      select.addEventListener('change', () => {
        this._debouncedPreviewUpdate(rootEl);
      });
    });

    // Collapsible sections
    rootEl.querySelectorAll('.tfl-collapsible-header').forEach(header => {
      header.addEventListener('click', () => {
        const collapsible = header.closest('.tfl-collapsible');
        if (collapsible) {
          const isCollapsed = collapsible.dataset.collapsed === 'true';
          collapsible.dataset.collapsed = isCollapsed ? 'false' : 'true';
        }
      });
    });

    // Apply Frame button
    const applyButton = rootEl.querySelector('.tfl-apply-button');
    if (applyButton) {
      applyButton.addEventListener('click', async (event) => {
        event.preventDefault();
        await this._applyFrame(rootEl);
      });
    }

    // Restore button
    const restoreButton = rootEl.querySelector('.tfl-restore-button');
    if (restoreButton) {
      restoreButton.addEventListener('click', async (event) => {
        event.preventDefault();
        await this._restoreOriginal();
      });
    }

    // Initial preview
    this._updatePreview(rootEl);
  }

  /**
   * Get the current Image Path from the parent TokenConfig app
   */
  _getTokenConfigImagePath() {
    if (!this.tokenConfigApp) return null;
    
    const appElement = this.tokenConfigApp.element instanceof jQuery 
      ? this.tokenConfigApp.element[0] 
      : this.tokenConfigApp.element;
    
    if (!appElement) return null;
    
    let textureInput = appElement.querySelector('input[name="texture.src"]');
    if (!textureInput) {
      textureInput = appElement.querySelector('file-picker[name="texture.src"] input');
      textureInput = textureInput || appElement.querySelector('[name="texture.src"]');
    }
    
    return textureInput?.value?.trim() || null;
  }

  /**
   * Gather form data
   */
  _gatherFormData(rootEl) {
    const getValue = (name) => rootEl.querySelector(`input[name="${name}"]`)?.value ?? '';
    const getSelectValue = (name) => rootEl.querySelector(`select[name="${name}"]`)?.value ?? '';
    const getChecked = (name) => rootEl.querySelector(`input[name="${name}"]`)?.checked ?? false;
    const getNumber = (name, fallback) => parseFloat(getValue(name)) || fallback;
    const getInt = (name, fallback) => parseInt(getValue(name)) || fallback;

    return {
      enabled: true,
      frameImage: getValue('frameImage'),
      maskImage: getValue('maskImage'),
      baseScale: getNumber('baseScale', 0.9),
      baseOffsetX: getInt('baseOffsetX', 0),
      baseOffsetY: getInt('baseOffsetY', 0),
      maskRadius: getNumber('maskSize', 0.95),
      maskScale: getNumber('maskSize', 1.0),
      maskOffsetX: getInt('maskOffsetX', 0),
      maskOffsetY: getInt('maskOffsetY', 0),
      maskShape: getSelectValue('maskShape') || 'circle',
      frameScale: getNumber('frameScale', 1.0),
      frameOffsetX: getInt('frameOffsetX', 0),
      frameOffsetY: getInt('frameOffsetY', 0),
      baseOverFrame: getChecked('baseOverFrame'),
      bgEnabled: getChecked('bgEnabled'),
      bgColor: getValue('bgColor') || '#000000',
      bgImage: getValue('bgImage'),
      bgImageScale: getNumber('bgImageScale', 1.0),
      bgImageOffsetX: getInt('bgImageOffsetX', 0),
      bgImageOffsetY: getInt('bgImageOffsetY', 0),
      overlayImage: getValue('overlayImage'),
      overlayScale: getNumber('overlayScale', 1.0),
      overlayOffsetX: getInt('overlayOffsetX', 0),
      overlayOffsetY: getInt('overlayOffsetY', 0)
    };
  }

  /**
   * Update the preview image
   */
  async _updatePreview(rootEl) {
    const previewImg = rootEl.querySelector('.tfl-preview-image');
    const previewPlaceholder = rootEl.querySelector('.tfl-preview-placeholder');
    const previewLoading = rootEl.querySelector('.tfl-preview-loading');
    
    if (!previewImg) return;

    const frameData = this._gatherFormData(rootEl);
    
    if (!this.baseImagePath || !frameData.frameImage) {
      previewImg.style.display = 'none';
      if (previewPlaceholder) previewPlaceholder.style.display = 'flex';
      if (previewLoading) previewLoading.style.display = 'none';
      return;
    }

    if (previewLoading) previewLoading.style.display = 'flex';
    if (previewPlaceholder) previewPlaceholder.style.display = 'none';

    try {
      // Use larger preview size for better quality in the dialog
      const dataUrl = await generatePreview(this.baseImagePath, frameData, 500);
      
      if (dataUrl) {
        previewImg.src = dataUrl;
        previewImg.style.display = 'block';
        if (previewPlaceholder) previewPlaceholder.style.display = 'none';
      } else {
        previewImg.style.display = 'none';
        if (previewPlaceholder) previewPlaceholder.style.display = 'flex';
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Preview update failed:`, err);
      previewImg.style.display = 'none';
      if (previewPlaceholder) previewPlaceholder.style.display = 'flex';
    } finally {
      if (previewLoading) previewLoading.style.display = 'none';
    }
  }

  /**
   * Debounced preview update
   */
  _debouncedPreviewUpdate(rootEl) {
    if (previewDebounceTimer) {
      clearTimeout(previewDebounceTimer);
    }
    previewDebounceTimer = setTimeout(() => {
      this._updatePreview(rootEl);
    }, PREVIEW_DEBOUNCE_MS);
  }

  /**
   * Save the composited image to a user-selected location
   */
  async _saveImageToFile(rootEl) {
    const frameData = this._gatherFormData(rootEl);
    
    if (!this.baseImagePath) {
      ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.NoBaseImage'));
      return;
    }
    
    if (!frameData.frameImage) {
      ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.NoFrameImage'));
      return;
    }

    // Generate high-quality image using the cache resolution setting
    const cacheResolution = game.settings.get(MODULE_ID, 'cacheResolution') ?? 1000;
    const cacheQuality = game.settings.get(MODULE_ID, 'cacheQuality') ?? 0.95;
    
    try {
      // Generate the composited image as a data URL at high resolution
      const dataUrl = await generatePreview(this.baseImagePath, frameData, cacheResolution);
      
      if (!dataUrl) {
        ui.notifications.error(game.i18n.localize('TOKEN-FRAMER.Notifications.SaveImageFailed'));
        return;
      }

      // Convert data URL to blob
      const response = await fetch(dataUrl);
      const pngBlob = await response.blob();
      
      // Convert PNG to WebP for better compression
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      const webpBlob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/webp', cacheQuality);
      });

      // Generate a default filename
      const baseFilename = this.baseImagePath.split('/').pop().replace(/\.[^.]+$/, '');
      const defaultFilename = `${baseFilename}_token.webp`;

      // Open FilePicker to let user choose save location
      new foundry.applications.apps.FilePicker.implementation({
        type: 'folder',
        callback: async (folderPath) => {
          if (!folderPath) return;
          
          // Create the file and upload
          const file = new File([webpBlob], defaultFilename, { type: 'image/webp' });
          
          try {
            const uploadResult = await foundry.applications.apps.FilePicker.implementation.upload(
              'data',
              folderPath,
              file,
              { notify: false }
            );
            
            if (uploadResult?.path) {
              ui.notifications.info(game.i18n.format('TOKEN-FRAMER.Notifications.ImageSaved', { path: uploadResult.path }));
              debugLog('Image saved to:', uploadResult.path);
            } else {
              ui.notifications.error(game.i18n.localize('TOKEN-FRAMER.Notifications.SaveImageFailed'));
            }
          } catch (uploadErr) {
            console.error(`${MODULE_ID} | Failed to upload image:`, uploadErr);
            ui.notifications.error(game.i18n.localize('TOKEN-FRAMER.Notifications.SaveImageFailed'));
          }
        }
      }).render(true);
      
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to save image:`, err);
      ui.notifications.error(game.i18n.localize('TOKEN-FRAMER.Notifications.SaveImageFailed'));
    }
  }

  /**
   * Apply the frame to the token
   */
  async _applyFrame(rootEl) {
    const formData = this._gatherFormData(rootEl);
    
    if (!this.baseImagePath) {
      ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.NoBaseImage'));
      return;
    }
    
    if (!formData.frameImage) {
      ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.NoFrameImage'));
      return;
    }

    const placedToken = canvas.tokens?.get(this.token.id);
    
    if (placedToken) {
      // Placed token - update directly (no form state issues)
      await placedToken.document.setFlag(MODULE_ID, 'originalImage', this.baseImagePath);
      await placedToken.document.setFlag(MODULE_ID, 'frameData', formData);
      await applyFrameToToken(placedToken, true);
      debugLog('Frame applied to placed token:', placedToken.name);
      ui.notifications.info(game.i18n.localize('TOKEN-FRAMER.Notifications.FrameApplied'));
    } else {
      // Prototype token - store pending data to be merged when form is submitted
      const actor = game.actors.get(this.token.actorId) || this.token.actor;
      
      if (actor) {
        const cachedPath = await generateFrameForPrototype(this.baseImagePath, formData, actor.id);
        
        if (cachedPath) {
          // Store pending data - will be merged in preUpdateActor hook
          PENDING_PROTOTYPE_DATA.set(actor.id, {
            cachedPath: cachedPath,
            frameData: formData,
            originalImage: this.baseImagePath
          });
          
          // Update the visible Image Path field so user sees the change
          this._updateTokenConfigImagePath(cachedPath);
          
          // Check the enable checkbox if not already checked
          if (this.tokenConfigApp) {
            const appElement = this.tokenConfigApp.element instanceof jQuery 
              ? this.tokenConfigApp.element[0] 
              : this.tokenConfigApp.element;
            if (appElement) {
              const enableCheckbox = appElement.querySelector(`input[name="flags.${MODULE_ID}.frameData.enabled"]`);
              if (enableCheckbox && !enableCheckbox.checked) {
                enableCheckbox.checked = true;
              }
            }
          }
          
          debugLog('Prototype token: Frame generated, pending data stored for actor:', actor.id);
          ui.notifications.info(game.i18n.localize('TOKEN-FRAMER.Notifications.FrameGenerated'));
        }
      }
    }
    
    this.close();
  }

  /**
   * Restore the original image
   */
  async _restoreOriginal() {
    const placedToken = canvas.tokens?.get(this.token.id);
    
    if (placedToken) {
      // Placed token - update directly
      await restoreOriginalImage(placedToken);
      ui.notifications.info(game.i18n.localize('TOKEN-FRAMER.Notifications.FrameRemoved'));
    } else {
      // Prototype token - store pending restore data
      const actor = game.actors.get(this.token.actorId) || this.token.actor;
      const originalImagePath = await this.token.getFlag(MODULE_ID, 'originalImage') || this.baseImagePath;
      
      if (actor && originalImagePath) {
        // Store pending restore - will be processed in preUpdateActor hook
        PENDING_PROTOTYPE_DATA.set(actor.id, {
          restore: true,
          originalImage: originalImagePath
        });
        
        // Update the Image Path field to the original
        this._updateTokenConfigImagePath(originalImagePath);
        
        // Uncheck the enable checkbox
        if (this.tokenConfigApp) {
          const appElement = this.tokenConfigApp.element instanceof jQuery 
            ? this.tokenConfigApp.element[0] 
            : this.tokenConfigApp.element;
          
          if (appElement) {
            const enableCheckbox = appElement.querySelector(`input[name="flags.${MODULE_ID}.frameData.enabled"]`);
            if (enableCheckbox) {
              enableCheckbox.checked = false;
            }
          }
        }
        
        debugLog('Prototype token: Restore prepared, will apply on form submit');
        ui.notifications.info(game.i18n.localize('TOKEN-FRAMER.Notifications.FrameWillBeRemoved'));
      }
    }
    
    this.close();
  }

  /**
   * Update the parent TokenConfig's Image Path field
   */
  _updateTokenConfigImagePath(newPath) {
    if (!this.tokenConfigApp) return;
    
    const appElement = this.tokenConfigApp.element instanceof jQuery 
      ? this.tokenConfigApp.element[0] 
      : this.tokenConfigApp.element;
    
    if (!appElement) return;
    
    let textureInput = appElement.querySelector('input[name="texture.src"]');
    if (!textureInput) {
      textureInput = appElement.querySelector('file-picker[name="texture.src"] input');
      textureInput = textureInput || appElement.querySelector('[name="texture.src"]');
    }
    
    if (textureInput) {
      textureInput.value = newPath;
      // Trigger change event so Foundry knows the value changed
      textureInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  async _updateObject(event, formData) {
    // Not used - we handle submission via buttons
  }
}

/**
 * Render the token frame controls in the token configuration
 */
async function renderTokenFrameControls(app, html, data) {
  // v13 ApplicationV2 uses app.document, older versions use app.token
  const token = app.document || app.token;
  if (!token) {
    debugLog('No token found in app');
    return;
  }

  const frameData = await token.getFlag(MODULE_ID, 'frameData') ?? {};
  
  const templateData = {
    moduleId: MODULE_ID,
    frameEnabled: frameData.enabled ? 'checked' : ''
  };

  const rootEl = html instanceof jQuery ? html[0] : html;
  
  // Find the Image Path form-group to insert after
  const textureInput = rootEl.querySelector('[name="texture.src"]');
  if (!textureInput) {
    debugLog('Could not find texture.src input');
    return;
  }
  
  const imageFormGroup = textureInput.closest('.form-group');
  if (!imageFormGroup) {
    debugLog('Could not find Image Path form-group');
    return;
  }

  // Check if already injected
  if (rootEl.querySelector('[data-token-framer="controls"]')) {
    return;
  }

  const contents = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/frame-config.hbs`,
    templateData
  );

  const wrapper = document.createElement('div');
  wrapper.innerHTML = contents;
  const controlsElement = wrapper.firstElementChild;
  
  // Insert after the Image Path form-group
  imageFormGroup.after(controlsElement);

  // Activate listeners
  activateControlListeners(controlsElement, app, token);
  
  debugLog('Frame controls injected below Image Path');
}

/**
 * Activate event listeners for the frame controls
 */
function activateControlListeners(controlsEl, app, token) {
  // Enable checkbox - for placed tokens, save immediately; for prototype tokens, let form handle it
  const enableCheckbox = controlsEl.querySelector('.tfl-enable-checkbox');
  if (enableCheckbox) {
    enableCheckbox.addEventListener('change', async () => {
      const placedToken = canvas.tokens?.get(token.id);
      const defaults = getDefaultSettings();
      
      // Detect TVA's TokenCustomConfig (per-art configuration dialog)
      // TVA adds imgSrc and callback properties that don't exist on regular TokenConfig
      const isTVAPerArtConfig = app.imgSrc !== undefined || app.callback !== undefined;
      
      // Only save immediately for PLACED tokens in the regular TokenConfig
      // Skip immediate saves in TVA's per-art config - let TVA handle it through form submission
      // Prototype tokens will also save when the form is submitted
      if (placedToken && !isTVAPerArtConfig) {
        if (enableCheckbox.checked) {
          const currentFrameData = await placedToken.document.getFlag(MODULE_ID, 'frameData') ?? {};
          const newFrameData = {
            ...currentFrameData,
            enabled: true,
            frameImage: currentFrameData.frameImage || defaults.defaultFrameImage,
            baseScale: currentFrameData.baseScale ?? defaults.baseScale,
            frameScale: currentFrameData.frameScale ?? defaults.frameScale,
            maskRadius: currentFrameData.maskRadius ?? defaults.maskScale,
            overlayScale: currentFrameData.overlayScale ?? defaults.overlayScale,
            bgImageScale: currentFrameData.bgImageScale ?? defaults.bgImageScale
          };
          await placedToken.document.setFlag(MODULE_ID, 'frameData', newFrameData);
        } else {
          const currentFrameData = await placedToken.document.getFlag(MODULE_ID, 'frameData') ?? {};
          await placedToken.document.setFlag(MODULE_ID, 'frameData', { ...currentFrameData, enabled: false });
        }
        debugLog('Frame enabled (placed token):', enableCheckbox.checked);
      } else if (isTVAPerArtConfig) {
        // TVA per-art config - let TVA's form submission handle saving to per-art storage
        debugLog('Frame checkbox changed (TVA per-art config, TVA will handle saving):', enableCheckbox.checked);
      } else {
        // Prototype token - just log, form submission will handle saving
        debugLog('Frame checkbox changed (prototype token, will save on form submit):', enableCheckbox.checked);
      }
    });
  }

  // Configure button
  const configureButton = controlsEl.querySelector('.tfl-configure-button');
  if (configureButton) {
    configureButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      
      const dialog = new TokenFramerDialog(token, app);
      dialog.render(true);
      
      debugLog('Opened Token Framer dialog');
    });
  }
}
