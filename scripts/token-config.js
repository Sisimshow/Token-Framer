/**
 * Token Framer - Token Configuration UI
 * 
 * Injects frame controls (enable checkbox + configure button) into the Token Config.
 * Opens a separate dialog for frame settings to avoid prototype token form state issues.
 * Uses a pending data pattern for prototype tokens to defer saves until form submission.
 */

import { MODULE_ID, debugLog } from './main.js';
import { applyFrameToToken, restoreOriginalImage, generateFrameForPrototype, generateCacheKey } from './frame-layer.js';
import { BatchFrameDialog } from './batch-frame.js';

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

  // Add Token Framer button to actor sheet header (AppV1 sheets)
  Hooks.on('getActorSheetHeaderButtons', (app, buttons) => {
    const actor = app.document ?? app.actor;
    if (!actor?.isOwner) return;
    buttons.unshift({
      class: MODULE_ID,
      label: game.i18n.localize('TOKEN-FRAMER.Config.DialogTitle'),
      icon: 'fas fa-circle-notch',
      onclick: () => {
        const dialog = new TokenFramerDialog(actor.prototypeToken);
        dialog.render(true);
      }
    });
  });

  // Add Token Framer button to actor sheet header (AppV2 sheets)
  Hooks.on('getHeaderControlsApplicationV2', (app, controls) => {
    if (!(app.document instanceof Actor)) return;
    const actor = app.document;
    if (!actor.isOwner) return;
    if (controls.some(c => c.action === 'token-framer-open')) return;

    app.options.actions['token-framer-open'] = () => {
      const dialog = new TokenFramerDialog(actor.prototypeToken);
      dialog.render(true);
    };

    controls.push({
      icon: 'fas fa-circle-notch',
      label: game.i18n.localize('TOKEN-FRAMER.Config.DialogTitle'),
      action: 'token-framer-open'
    });
  });
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
    popOutDegrees: game.settings.get(MODULE_ID, 'defaultPopOutDegrees') ?? 180,
    popOutRotation: game.settings.get(MODULE_ID, 'defaultPopOutRotation') ?? 0,
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

function isDataUrl(path) {
  return path?.startsWith('data:');
}

/**
 * Read a File/Blob as a data URL via FileReader
 */
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
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
    overlayOffsetY = 0,
    popOutEnabled = false,
    popOutDegrees = 180,
    popOutRotation = 0,
    popOutOffsetX = 0,
    popOutOffsetY = 0
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
    const scaledPopOutOffsetX = popOutOffsetX * offsetScale;
    const scaledPopOutOffsetY = popOutOffsetY * offsetScale;
    
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

    // Helper function to draw the pop-out layer (base image clipped to a pie wedge, above the frame)
    const drawPopOut = () => {
      if (!popOutEnabled || popOutDegrees <= 0) return;
      ctx.save();
      const halfAngle = (popOutDegrees / 2) * Math.PI / 180;
      const centerAngle = (popOutRotation - 90) * Math.PI / 180;
      const popCenterX = centerX + scaledPopOutOffsetX;
      const popCenterY = centerY + scaledPopOutOffsetY;
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

    // Draw pop-out preview highlight (UI-only, not saved to cache)
    if (frameData.popOutPreview && popOutEnabled && popOutDegrees > 0) {
      ctx.save();
      const halfAngle = (popOutDegrees / 2) * Math.PI / 180;
      const centerAngle = (popOutRotation - 90) * Math.PI / 180;
      const popCenterX = centerX + scaledPopOutOffsetX;
      const popCenterY = centerY + scaledPopOutOffsetY;
      ctx.beginPath();
      ctx.moveTo(popCenterX, popCenterY);
      ctx.arc(popCenterX, popCenterY, size, centerAngle - halfAngle, centerAngle + halfAngle);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 220, 50, 0.25)';
      ctx.fill();
      ctx.restore();
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
    this._localFileName = null;
    this._localUploads = new Map();
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
      overlayOffsetY: frameData.overlayOffsetY ?? 0,
      popOutEnabled: frameData.popOutEnabled ? 'checked' : '',
      popOutDegrees: frameData.popOutDegrees ?? defaults.popOutDegrees,
      popOutRotation: frameData.popOutRotation ?? defaults.popOutRotation,
      popOutOffsetX: frameData.popOutOffsetX ?? 0,
      popOutOffsetY: frameData.popOutOffsetY ?? 0,
      autoFrameEnabled: frameData.enabled ? true : false
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
            let decodedPath;
            try {
              decodedPath = decodeURIComponent(path);
            } catch (e) {
              decodedPath = path;
            }
            
            if (targetName === 'baseImage' && isFromCache(decodedPath)) {
              ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.CachedImageWarning'));
              return;
            }
            if (input) {
              if (targetName === 'baseImage') {
                this._clearLocalImage(rootEl);
                this.baseImagePath = decodedPath;
              } else if (this._localUploads.has(targetName)) {
                this._localUploads.delete(targetName);
                input.readOnly = false;
                input.title = '';
              }
              input.value = decodedPath;
              this._debouncedPreviewUpdate(rootEl);
            }
          }
        }).render();
      });
    });

    // Upload from PC buttons (all image fields)
    rootEl.querySelectorAll('.tfl-upload-button').forEach(button => {
      button.addEventListener('click', () => {
        const targetName = button.dataset.target;
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.addEventListener('change', async (event) => {
          const file = event.target.files[0];
          if (!file) return;
          if (targetName === 'baseImage') {
            this._setLocalImage(file, rootEl);
          } else {
            await this._setLocalUpload(targetName, file, rootEl);
          }
        });
        fileInput.click();
      });
    });

    // Drag-and-drop on the preview area
    const previewWrapper = rootEl.querySelector('.tfl-preview-wrapper');
    if (previewWrapper) {
      const dropOverlay = rootEl.querySelector('.tfl-drop-overlay');
      let dragCounter = 0;

      previewWrapper.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (dropOverlay) dropOverlay.classList.add('active');
      });
      previewWrapper.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
          dragCounter = 0;
          if (dropOverlay) dropOverlay.classList.remove('active');
        }
      });
      previewWrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      previewWrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        if (dropOverlay) dropOverlay.classList.remove('active');

        const file = e.dataTransfer?.files?.[0];
        if (file && file.type.startsWith('image/')) {
          this._setLocalImage(file, rootEl);
        }
      });
    }

    // Paste support on the dialog
    this._pasteHandler = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          e.stopPropagation();
          const file = item.getAsFile();
          if (file) this._setLocalImage(file, rootEl);
          break;
        }
      }
    };
    rootEl.addEventListener('paste', this._pasteHandler);

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
        
        this._clearLocalImage(rootEl);
        const baseImageInput = rootEl.querySelector('input[name="baseImage"]');
        if (baseImageInput) {
          baseImageInput.value = newPath;
        }
        this.baseImagePath = newPath;
        this._debouncedPreviewUpdate(rootEl);
        debugLog('Base image refreshed to:', newPath);
      });
    }

    // Save As button - export composited image to user-chosen location
    const saveImageButton = rootEl.querySelector('.tfl-save-image-button');
    if (saveImageButton) {
      saveImageButton.addEventListener('click', async () => {
        await this._saveImageToFile(rootEl);
      });
    }

    // Quick Save button - save to preset location and update token image
    const quickSaveButton = rootEl.querySelector('.tfl-quick-save-button');
    if (quickSaveButton) {
      quickSaveButton.addEventListener('click', async (event) => {
        event.preventDefault();
        await this._quickSave(rootEl);
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
            input.value = isDataUrl(this.baseImagePath) ? `[Uploaded: ${this._localFileName}]` : this.baseImagePath;
            return;
          }
          this._clearLocalImage(rootEl);
          this.baseImagePath = input.value;
        } else if (this._localUploads.has(input.name)) {
          this._localUploads.delete(input.name);
          input.readOnly = false;
          input.title = '';
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

    // Batch Frame button
    const batchButton = rootEl.querySelector('.tfl-batch-button');
    if (batchButton) {
      batchButton.addEventListener('click', () => {
        const frameData = this._gatherFormData(rootEl);
        delete frameData.popOutPreview;
        if (!frameData.frameImage) {
          ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.NoFrameImage'));
          return;
        }
        new BatchFrameDialog(frameData).render({force: true});
      });
    }

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
   * Set a local image from a File object (upload from PC, drag-drop, paste)
   */
  async _setLocalImage(file, rootEl) {
    if (!file || !file.type.startsWith('image/')) return;

    try {
      const dataUrl = await readFileAsDataURL(file);
      this.baseImagePath = dataUrl;
      this._localFileName = file.name;

      const baseImageInput = rootEl.querySelector('input[name="baseImage"]');
      if (baseImageInput) {
        baseImageInput.value = `[Uploaded: ${file.name}]`;
        baseImageInput.title = file.name;
        baseImageInput.readOnly = true;
      }
      this._debouncedPreviewUpdate(rootEl);
      debugLog('Local image loaded:', file.name);
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to load local image:`, err);
      ui.notifications.error(game.i18n.localize('TOKEN-FRAMER.Notifications.LocalImageFailed'));
    }
  }

  /**
   * Clear the local image state and restore the input field to editable
   */
  _clearLocalImage(rootEl) {
    this._localFileName = null;
    const baseImageInput = rootEl.querySelector('input[name="baseImage"]');
    if (baseImageInput) {
      baseImageInput.readOnly = false;
      baseImageInput.title = '';
    }
  }

  /**
   * Set a local upload for a non-base image field (frame, mask, overlay, background)
   */
  async _setLocalUpload(fieldName, file, rootEl) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      this._localUploads.set(fieldName, { dataUrl, fileName: file.name });

      const input = rootEl.querySelector(`input[name="${fieldName}"]`);
      if (input) {
        input.value = `[Uploaded: ${file.name}]`;
        input.title = file.name;
        input.readOnly = true;
      }
      this._debouncedPreviewUpdate(rootEl);
      debugLog(`Local image loaded for ${fieldName}:`, file.name);
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to load local image for ${fieldName}:`, err);
      ui.notifications.error(game.i18n.localize('TOKEN-FRAMER.Notifications.LocalImageFailed'));
    }
  }

  /**
   * Get a filesystem-friendly path for cache key generation.
   * Returns the local filename if the field has a local upload, otherwise the raw value.
   */
  _resolvePathForCacheKey(fieldName, rawValue) {
    if (fieldName === 'baseImage') {
      return this._localFileName || rawValue;
    }
    const upload = this._localUploads.get(fieldName);
    return upload ? upload.fileName : rawValue;
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
    const getValue = (name) => {
      const upload = this._localUploads.get(name);
      if (upload) return upload.dataUrl;
      return rootEl.querySelector(`input[name="${name}"]`)?.value ?? '';
    };
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
      overlayOffsetY: getInt('overlayOffsetY', 0),
      popOutEnabled: getChecked('popOutEnabled'),
      popOutDegrees: getInt('popOutDegrees', 180),
      popOutRotation: getInt('popOutRotation', 0),
      popOutOffsetX: getInt('popOutOffsetX', 0),
      popOutOffsetY: getInt('popOutOffsetY', 0),
      popOutPreview: getChecked('popOutPreview')
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
    delete frameData.popOutPreview;
    
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

      // Convert to WebP blob for better compression
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      
      const webpBlob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/webp', cacheQuality);
      });

      const basePath = this._resolvePathForCacheKey('baseImage', this.baseImagePath);
      const framePath = this._resolvePathForCacheKey('frameImage', frameData.frameImage);
      const defaultFilename = `${generateCacheKey(basePath, framePath)}.webp`;

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
   * Quick Save - save to preset location, update token image, disable auto-framing
   */
  async _quickSave(rootEl) {
    const frameData = this._gatherFormData(rootEl);
    delete frameData.popOutPreview;

    if (!this.baseImagePath) {
      ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.NoBaseImage'));
      return;
    }

    if (!frameData.frameImage) {
      ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.NoFrameImage'));
      return;
    }

    const cacheResolution = game.settings.get(MODULE_ID, 'cacheResolution') ?? 1000;
    const cacheQuality = game.settings.get(MODULE_ID, 'cacheQuality') ?? 0.95;

    try {
      const dataUrl = await generatePreview(this.baseImagePath, frameData, cacheResolution);
      if (!dataUrl) {
        ui.notifications.error(game.i18n.localize('TOKEN-FRAMER.Notifications.SaveImageFailed'));
        return;
      }

      // Convert to WebP blob
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      const cvs = document.createElement('canvas');
      cvs.width = img.width;
      cvs.height = img.height;
      cvs.getContext('2d').drawImage(img, 0, 0);
      const webpBlob = await new Promise(resolve => {
        cvs.toBlob(resolve, 'image/webp', cacheQuality);
      });

      // Build save path
      let saveFolder = game.settings.get(MODULE_ID, 'quickSaveFolder') || 'assets/tokens';
      const useSubfolder = game.settings.get(MODULE_ID, 'quickSaveSubfolder') ?? true;

      if (useSubfolder) {
        const tokenName = this.token.name || this.token.parent?.name || 'unknown';
        const safeName = tokenName.replace(/[^a-zA-Z0-9 _-]/g, '_').trim();
        saveFolder = `${saveFolder}/${safeName}`;
      }

      // Ensure folder exists
      const FilePicker = foundry.applications.apps.FilePicker.implementation;
      try {
        await FilePicker.browse('data', saveFolder);
      } catch (e) {
        try {
          await FilePicker.createDirectory('data', saveFolder);
        } catch (createErr) {
          // Try creating parent first if subfolder creation failed
          const parentFolder = saveFolder.split('/').slice(0, -1).join('/');
          try {
            await FilePicker.createDirectory('data', parentFolder);
            await FilePicker.createDirectory('data', saveFolder);
          } catch (parentErr) {
            console.error(`${MODULE_ID} | Failed to create quick save folder:`, parentErr);
            ui.notifications.error(game.i18n.localize('TOKEN-FRAMER.Notifications.SaveImageFailed'));
            return;
          }
        }
      }

      const basePath = this._resolvePathForCacheKey('baseImage', this.baseImagePath);
      const framePath = this._resolvePathForCacheKey('frameImage', frameData.frameImage);
      const filename = generateCacheKey(basePath, framePath);

      const file = new File([webpBlob], `${filename}.webp`, { type: 'image/webp' });
      const uploadResult = await FilePicker.upload('data', saveFolder, file, { notify: false });

      if (!uploadResult?.path) {
        ui.notifications.error(game.i18n.localize('TOKEN-FRAMER.Notifications.SaveImageFailed'));
        return;
      }

      const savedPath = uploadResult.path;
      debugLog('Quick Save: image saved to', savedPath);

      // Update the token's image and clear Token Framer data
      const placedToken = canvas.tokens?.get(this.token.id);

      if (placedToken) {
        await placedToken.document.update({
          'texture.src': savedPath,
          [`flags.${MODULE_ID}.-=frameData`]: null,
          [`flags.${MODULE_ID}.-=originalImage`]: null,
          [`flags.${MODULE_ID}.-=currentCacheKey`]: null,
          [`flags.${MODULE_ID}.-=cachedFramePath`]: null
        });
      } else {
        // Prototype token
        const actor = game.actors.get(this.token.actorId) || this.token.actor;
        if (actor) {
          if (this.tokenConfigApp) {
            // Token Config is open - use pending data pattern
            PENDING_PROTOTYPE_DATA.set(actor.id, {
              restore: true,
              originalImage: savedPath
            });
            this._updateTokenConfigImagePath(savedPath);

            const appElement = this.tokenConfigApp.element instanceof jQuery
              ? this.tokenConfigApp.element[0]
              : this.tokenConfigApp.element;
            if (appElement) {
              const enableCheckbox = appElement.querySelector(`input[name="flags.${MODULE_ID}.frameData.enabled"]`);
              if (enableCheckbox) enableCheckbox.checked = false;
            }
          } else {
            // No Token Config open - update actor directly
            await actor.update({
              'prototypeToken.texture.src': savedPath,
              [`prototypeToken.flags.${MODULE_ID}.-=frameData`]: null,
              [`prototypeToken.flags.${MODULE_ID}.-=originalImage`]: null,
              [`prototypeToken.flags.${MODULE_ID}.-=currentCacheKey`]: null,
              [`prototypeToken.flags.${MODULE_ID}.-=cachedFramePath`]: null
            });
          }
        }
      }

      ui.notifications.info(game.i18n.format('TOKEN-FRAMER.Notifications.QuickSaved', { path: savedPath }));
      this.close();

    } catch (err) {
      console.error(`${MODULE_ID} | Quick Save failed:`, err);
      ui.notifications.error(game.i18n.localize('TOKEN-FRAMER.Notifications.SaveImageFailed'));
    }
  }

  /**
   * Apply the frame to the token
   */
  async _applyFrame(rootEl) {
    const formData = this._gatherFormData(rootEl);
    delete formData.popOutPreview;
    
    if (!this.baseImagePath) {
      ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.NoBaseImage'));
      return;
    }
    
    if (!formData.frameImage) {
      ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.NoFrameImage'));
      return;
    }

    if (isDataUrl(this.baseImagePath) || this._localUploads.size > 0) {
      ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.LocalImageAutoFrame'));
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
      // Prototype token
      const actor = game.actors.get(this.token.actorId) || this.token.actor;
      
      if (actor) {
        const cachedPath = await generateFrameForPrototype(this.baseImagePath, formData);
        
        if (cachedPath) {
          if (this.tokenConfigApp) {
            // Token Config is open - use pending data pattern to avoid form state issues
            PENDING_PROTOTYPE_DATA.set(actor.id, {
              cachedPath: cachedPath,
              frameData: formData,
              originalImage: this.baseImagePath
            });
            this._updateTokenConfigImagePath(cachedPath);
            
            const appElement = this.tokenConfigApp.element instanceof jQuery 
              ? this.tokenConfigApp.element[0] 
              : this.tokenConfigApp.element;
            if (appElement) {
              const enableCheckbox = appElement.querySelector(`input[name="flags.${MODULE_ID}.frameData.enabled"]`);
              if (enableCheckbox && !enableCheckbox.checked) {
                enableCheckbox.checked = true;
              }
            }
            debugLog('Prototype token: Frame generated, pending data stored for actor:', actor.id);
            ui.notifications.info(game.i18n.localize('TOKEN-FRAMER.Notifications.FrameGenerated'));
          } else {
            // No Token Config open (opened from header button) - update actor directly
            const cacheKey = cachedPath.split('/').pop().replace('.webp', '').split('?')[0];
            await actor.update({
              'prototypeToken.texture.src': cachedPath,
              [`prototypeToken.flags.${MODULE_ID}.frameData`]: formData,
              [`prototypeToken.flags.${MODULE_ID}.originalImage`]: this.baseImagePath,
              [`prototypeToken.flags.${MODULE_ID}.cachedFramePath`]: cachedPath,
              [`prototypeToken.flags.${MODULE_ID}.currentCacheKey`]: cacheKey
            });
            debugLog('Prototype token: Frame applied directly to actor:', actor.name);
            ui.notifications.info(game.i18n.localize('TOKEN-FRAMER.Notifications.FrameApplied'));
          }
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
      // Prototype token
      const actor = game.actors.get(this.token.actorId) || this.token.actor;
      const originalImagePath = await this.token.getFlag(MODULE_ID, 'originalImage') || this.baseImagePath;
      
      if (actor && originalImagePath) {
        if (this.tokenConfigApp) {
          // Token Config is open - use pending data pattern
          PENDING_PROTOTYPE_DATA.set(actor.id, {
            restore: true,
            originalImage: originalImagePath
          });
          this._updateTokenConfigImagePath(originalImagePath);
          
          const appElement = this.tokenConfigApp.element instanceof jQuery 
            ? this.tokenConfigApp.element[0] 
            : this.tokenConfigApp.element;
          if (appElement) {
            const enableCheckbox = appElement.querySelector(`input[name="flags.${MODULE_ID}.frameData.enabled"]`);
            if (enableCheckbox) enableCheckbox.checked = false;
          }
          debugLog('Prototype token: Restore prepared, will apply on form submit');
          ui.notifications.info(game.i18n.localize('TOKEN-FRAMER.Notifications.FrameWillBeRemoved'));
        } else {
          // No Token Config open - update actor directly
          await actor.update({
            'prototypeToken.texture.src': originalImagePath,
            [`prototypeToken.flags.${MODULE_ID}.-=frameData`]: null,
            [`prototypeToken.flags.${MODULE_ID}.-=originalImage`]: null,
            [`prototypeToken.flags.${MODULE_ID}.-=currentCacheKey`]: null,
            [`prototypeToken.flags.${MODULE_ID}.-=cachedFramePath`]: null
          });
          debugLog('Prototype token: Restored directly on actor:', actor.name);
          ui.notifications.info(game.i18n.localize('TOKEN-FRAMER.Notifications.FrameRemoved'));
        }
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
