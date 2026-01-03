/**
 * Token Framer - Token Configuration UI
 * Injects frame settings into the Token Configuration dialog
 * Updated for Foundry VTT v13 - uses renderTokenApplication hook
 * Updated for TVA compatibility - uses data attributes instead of fieldset wrapper
 */

import { MODULE_ID, debugLog } from './main.js';
import { applyFrameToToken, restoreOriginalImage, generateFrameForPrototype } from './frame-layer.js';

// Debounce timer for preview updates
let previewDebounceTimer = null;
const PREVIEW_DEBOUNCE_MS = 150;

/**
 * Register hooks for Token Configuration UI injection
 */
export function registerTokenConfigHooks() {
  // v13 uses renderTokenApplication for both placed tokens and prototype tokens
  Hooks.on('renderTokenApplication', renderTokenFrameSettings);
}

/**
 * Get default values from module settings
 */
function getDefaultSettings() {
  return {
    baseScale: game.settings.get(MODULE_ID, 'defaultBaseScale') ?? 0.9,
    maskRadius: game.settings.get(MODULE_ID, 'defaultMaskRadius') ?? 0.95,
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
    frameScale = 1.0,
    frameOffsetX = 0,
    frameOffsetY = 0,
    bgEnabled = false,
    bgColor = '#000000'
  } = frameData;

  if (!baseImagePath || !frameImage) {
    return null;
  }

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  const centerX = size / 2;
  const centerY = size / 2;

  try {
    // Load images
    const [baseImg, frameImg, maskImg] = await Promise.all([
      loadImage(baseImagePath),
      loadImage(frameImage),
      maskImage ? loadImage(maskImage).catch(() => null) : null
    ]);

    // Calculate base image dimensions maintaining aspect ratio
    const baseAspect = baseImg.width / baseImg.height;
    let baseDrawWidth, baseDrawHeight;
    let baseDrawY; // Vertical position for the base image
    
    // Scale offsets proportionally to preview size
    const offsetScale = size / 512; // Assuming 512 is the full-size reference
    const scaledBaseOffsetX = baseOffsetX * offsetScale;
    const scaledBaseOffsetY = baseOffsetY * offsetScale;
    const scaledMaskOffsetX = maskOffsetX * offsetScale;
    const scaledMaskOffsetY = maskOffsetY * offsetScale;
    const scaledFrameOffsetX = frameOffsetX * offsetScale;
    const scaledFrameOffsetY = frameOffsetY * offsetScale;
    
    if (baseAspect >= 1) {
      // Wider than tall or square - fit to height, center vertically
      baseDrawHeight = size * baseScale;
      baseDrawWidth = baseDrawHeight * baseAspect;
      baseDrawY = centerY - baseDrawHeight / 2 + scaledBaseOffsetY;
    } else {
      // Taller than wide (portrait) - fit to width, align to TOP
      baseDrawWidth = size * baseScale;
      baseDrawHeight = baseDrawWidth / baseAspect;
      baseDrawY = centerY - (size * baseScale / 2) + scaledBaseOffsetY;
    }
    
    // Horizontal position is always centered
    const baseDrawX = centerX - baseDrawWidth / 2 + scaledBaseOffsetX;

    // Apply mask (independent of base image settings)
    ctx.save();
    
    if (maskImg) {
      // Use custom mask with luminosity-to-alpha conversion
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
      
      // Draw mask and convert luminosity to alpha
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
      
      // Convert mask luminosity to alpha (white = visible, black = hidden)
      const maskData = maskCtx.getImageData(0, 0, size, size);
      const pixels = maskData.data;
      for (let i = 0; i < pixels.length; i += 4) {
        const luminosity = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
        pixels[i + 3] = Math.min(pixels[i + 3], luminosity);
      }
      maskCtx.putImageData(maskData, 0, 0);
      
      // Apply the alpha mask to the base image
      baseCtx.globalCompositeOperation = 'destination-in';
      baseCtx.drawImage(maskCanvas, 0, 0);
      
      // Draw the masked base to the main canvas
      ctx.drawImage(baseCanvas, 0, 0);
      
    } else {
      // Circular clip path (uses maskRadius and mask offset)
      ctx.beginPath();
      const radius = (size / 2) * maskRadius;
      ctx.arc(centerX + scaledMaskOffsetX, centerY + scaledMaskOffsetY, radius, 0, Math.PI * 2);
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

    // Draw frame overlay
    const frameSize = size * frameScale;
    ctx.drawImage(
      frameImg,
      centerX - frameSize / 2 + scaledFrameOffsetX,
      centerY - frameSize / 2 + scaledFrameOffsetY,
      frameSize,
      frameSize
    );

    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error(`${MODULE_ID} | Preview generation failed:`, err);
    return null;
  }
}

/**
 * Render the token frame settings in the token configuration
 */
async function renderTokenFrameSettings(app, html, data) {
  const token = app.token;
  if (!token) {
    debugLog('No token found in app');
    return;
  }

  const frameData = await token.getFlag(MODULE_ID, 'frameData') ?? {};
  const defaults = getDefaultSettings();
  const originalImage = await token.getFlag(MODULE_ID, 'originalImage') ?? token.texture?.src ?? '';

  const templateData = {
    moduleId: MODULE_ID,
    originalImage,
    frameEnabled: frameData.enabled ? 'checked' : '',
    frameImage: frameData.frameImage ?? defaults.defaultFrameImage,
    maskImage: frameData.maskImage ?? '',
    baseScale: frameData.baseScale ?? defaults.baseScale,
    baseOffsetX: frameData.baseOffsetX ?? 0,
    baseOffsetY: frameData.baseOffsetY ?? 0,
    maskRadius: frameData.maskRadius ?? defaults.maskRadius,
    maskScale: frameData.maskScale ?? 1.0,
    maskOffsetX: frameData.maskOffsetX ?? 0,
    maskOffsetY: frameData.maskOffsetY ?? 0,
    frameScale: frameData.frameScale ?? 1.0,
    frameOffsetX: frameData.frameOffsetX ?? 0,
    frameOffsetY: frameData.frameOffsetY ?? 0,
    bgEnabled: frameData.bgEnabled ? 'checked' : '',
    bgColor: frameData.bgColor ?? '#000000'
  };

  const rootEl = html instanceof jQuery ? html[0] : html;
  const nav = rootEl.querySelector('div[data-tab="appearance"]');
  if (!nav) {
    debugLog('Could not find appearance tab');
    return;
  }

  // Check if already injected using data attribute
  if (nav.querySelector('[data-token-framer="header"]')) {
    return;
  }

  const contents = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/frame-config.hbs`,
    templateData
  );

  const wrapper = document.createElement('div');
  wrapper.innerHTML = contents;
  while (wrapper.firstChild) {
    nav.appendChild(wrapper.firstChild);
  }

  app.setPosition({ height: 'auto' });
  activateListeners(rootEl, app, token, originalImage);
  
  debugLog('Frame config UI injected');
}

/**
 * Update the preview image
 */
async function updatePreview(rootEl, baseImagePath) {
  const previewImg = rootEl.querySelector('.tfl-preview-image');
  const previewPlaceholder = rootEl.querySelector('.tfl-preview-placeholder');
  const previewLoading = rootEl.querySelector('.tfl-preview-loading');
  
  if (!previewImg) return;

  const frameData = gatherFrameFormData(rootEl);
  
  // Check if we have minimum required data
  if (!baseImagePath || !frameData.frameImage) {
    previewImg.style.display = 'none';
    if (previewPlaceholder) previewPlaceholder.style.display = 'flex';
    if (previewLoading) previewLoading.style.display = 'none';
    return;
  }

  // Show loading state
  if (previewLoading) previewLoading.style.display = 'flex';
  if (previewPlaceholder) previewPlaceholder.style.display = 'none';

  try {
    const dataUrl = await generatePreview(baseImagePath, frameData, 200);
    
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
function debouncedPreviewUpdate(rootEl, baseImagePath) {
  if (previewDebounceTimer) {
    clearTimeout(previewDebounceTimer);
  }
  previewDebounceTimer = setTimeout(() => {
    updatePreview(rootEl, baseImagePath);
  }, PREVIEW_DEBOUNCE_MS);
}

/**
 * Check if a path is from the Token Framer cache
 */
function isFromCache(imagePath) {
  if (!imagePath) return false;
  
  // Check custom cache folder from settings
  const customCacheFolder = game.settings.get(MODULE_ID, 'cacheFolder');
  if (customCacheFolder && imagePath.includes(customCacheFolder)) {
    return true;
  }
  
  // Check default cache folder pattern
  const defaultCacheFolder = `worlds/${game.world.id}/token-framer-cache`;
  if (imagePath.includes(defaultCacheFolder)) {
    return true;
  }
  
  // Generic fallback check
  if (imagePath.includes('token-framer-cache')) {
    return true;
  }
  
  return false;
}

/**
 * Activate event listeners for the frame configuration controls
 */
function activateListeners(rootEl, app, token, originalImage) {
  // Get all Token Framer form groups using data attribute
  const tokenFramerGroups = rootEl.querySelectorAll('[data-token-framer]');
  if (tokenFramerGroups.length === 0) return;

  // Use an object to hold the base image path so it can be updated by the refresh button
  const baseImageState = {
    path: originalImage || token.texture?.src
  };

  // Base image path input - editable text field
  const originalPathInput = rootEl.querySelector('input.tfl-original-path');
  if (originalPathInput) {
    originalPathInput.addEventListener('change', () => {
      const newPath = originalPathInput.value?.trim();
      
      if (!newPath) {
        return;
      }
      
      // Check if the path is from the cache
      if (isFromCache(newPath)) {
        ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.CachedImageWarning'));
        // Reset to previous value
        originalPathInput.value = baseImageState.path;
        return;
      }
      
      // Update the base image state
      baseImageState.path = newPath;
      
      // Trigger preview update
      debouncedPreviewUpdate(rootEl, baseImageState.path);
      
      debugLog('Base image manually changed to:', newPath);
    });
  }

  // Refresh base image button - copies from Foundry's Image Path field
  const refreshButton = rootEl.querySelector('.tfl-refresh-base-button');
  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      // Get the full application element - rootEl is just the appearance tab content
      const appElement = app.element instanceof jQuery ? app.element[0] : app.element;
      
      // Get the current value from Foundry's Image Path field
      // Try multiple possible selectors for v13 compatibility
      let textureInput = appElement.querySelector('input[name="texture.src"]');
      if (!textureInput) {
        // Try alternate selectors for different Foundry versions/structures
        textureInput = appElement.querySelector('file-picker[name="texture.src"] input');
        textureInput = textureInput || appElement.querySelector('[name="texture.src"]');
      }
      
      const newPath = textureInput?.value?.trim();
      
      if (!newPath) {
        ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.NoImagePath'));
        debugLog('Could not find texture.src input. Available inputs:', 
          Array.from(appElement.querySelectorAll('input')).map(i => i.name));
        return;
      }
      
      // Check if the path is from the cache
      if (isFromCache(newPath)) {
        ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.CachedImageWarning'));
        return;
      }
      
      // Update the base image state
      baseImageState.path = newPath;
      
      // Update the original path input field
      if (originalPathInput) {
        originalPathInput.value = newPath;
      }
      
      // Trigger preview update
      debouncedPreviewUpdate(rootEl, baseImageState.path);
      
      debugLog('Base image refreshed to:', newPath);
    });
  }

  // Base image file picker button
  const originalFilePicker = rootEl.querySelector('.tfl-original-file-picker');
  if (originalFilePicker) {
    originalFilePicker.addEventListener('click', async () => {
      new foundry.applications.apps.FilePicker.implementation({
        type: 'imagevideo',
        current: originalPathInput?.value ?? '',
        callback: (path) => {
          // Check if the path is from the cache
          if (isFromCache(path)) {
            ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Notifications.CachedImageWarning'));
            return;
          }
          
          // Update the input field
          if (originalPathInput) {
            originalPathInput.value = path;
          }
          
          // Update the base image state
          baseImageState.path = path;
          
          // Trigger preview update
          debouncedPreviewUpdate(rootEl, baseImageState.path);
          
          debugLog('Base image selected via file picker:', path);
        }
      }).render();
    });
  }

  // File picker buttons (for frame and mask images)
  const filePickerButtons = rootEl.querySelectorAll('[data-token-framer] .tfl-file-picker');
  filePickerButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const targetName = button.dataset.target;
      const input = rootEl.querySelector(`input[name="${targetName}"]`);
      
      new foundry.applications.apps.FilePicker.implementation({
        type: 'imagevideo',
        current: input?.value ?? '',
        callback: (path) => {
          if (input) {
            input.value = path;
            // Trigger preview update
            debouncedPreviewUpdate(rootEl, baseImageState.path);
          }
        }
      }).render();
    });
  });

  // Range slider value display and preview update
  const rangeInputs = rootEl.querySelectorAll('[data-token-framer] input[type="range"]');
  rangeInputs.forEach(input => {
    const valueDisplay = rootEl.querySelector(`.range-value[data-for="${input.name}"]`);
    input.addEventListener('input', () => {
      if (valueDisplay) {
        valueDisplay.textContent = parseFloat(input.value).toFixed(2);
      }
      debouncedPreviewUpdate(rootEl, baseImageState.path);
    });
  });

  // Number inputs - trigger preview on change
  const numberInputs = rootEl.querySelectorAll('[data-token-framer] input[type="number"]');
  numberInputs.forEach(input => {
    input.addEventListener('input', () => {
      debouncedPreviewUpdate(rootEl, baseImageState.path);
    });
  });

  // Text inputs (for file paths) - trigger preview on change
  const textInputs = rootEl.querySelectorAll('[data-token-framer] input[type="text"]:not(.tfl-color-text)');
  textInputs.forEach(input => {
    input.addEventListener('change', () => {
      debouncedPreviewUpdate(rootEl, baseImageState.path);
    });
  });

  // Color picker and text input syncing
  const colorPicker = rootEl.querySelector(`input[name="flags.${MODULE_ID}.frameData.bgColor"]`);
  const colorText = rootEl.querySelector(`input[name="flags.${MODULE_ID}.frameData.bgColorText"]`);
  
  if (colorPicker && colorText) {
    // Sync color picker to text input
    colorPicker.addEventListener('input', () => {
      colorText.value = colorPicker.value.toUpperCase();
      debouncedPreviewUpdate(rootEl, baseImageState.path);
    });
    
    // Sync text input to color picker
    colorText.addEventListener('change', () => {
      // Validate hex color
      const hexMatch = colorText.value.match(/^#?([0-9A-Fa-f]{6})$/);
      if (hexMatch) {
        const hexColor = `#${hexMatch[1].toUpperCase()}`;
        colorText.value = hexColor;
        colorPicker.value = hexColor;
        debouncedPreviewUpdate(rootEl, baseImageState.path);
      } else {
        // Invalid - reset to picker value
        colorText.value = colorPicker.value.toUpperCase();
      }
    });
  }

  // Background enable checkbox - trigger preview on change
  const bgEnabledCheckbox = rootEl.querySelector(`input[name="flags.${MODULE_ID}.frameData.bgEnabled"]`);
  if (bgEnabledCheckbox) {
    bgEnabledCheckbox.addEventListener('change', () => {
      debouncedPreviewUpdate(rootEl, baseImageState.path);
    });
  }

  // Enable checkbox toggle
  const enableCheckbox = rootEl.querySelector(`input[name="flags.${MODULE_ID}.frameData.enabled"]`);
  const dependentFields = rootEl.querySelectorAll('[data-tfl-dependent]');
  const previewContainer = rootEl.querySelector('[data-token-framer="preview"]');
  
  function updateDependentVisibility() {
    const isEnabled = enableCheckbox?.checked ?? false;
    dependentFields.forEach(el => {
      el.classList.toggle('tfl-hidden', !isEnabled);
    });
    if (previewContainer) {
      previewContainer.classList.toggle('tfl-hidden', !isEnabled);
    }
    
    // Update preview when enabled
    if (isEnabled) {
      debouncedPreviewUpdate(rootEl, baseImageState.path);
    }
  }
  
  if (enableCheckbox) {
    enableCheckbox.addEventListener('change', updateDependentVisibility);
    updateDependentVisibility();
  }

  // Apply Frame button
  const applyButton = rootEl.querySelector('[data-token-framer="actions"] .tfl-preview-button');
  if (applyButton) {
    applyButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      
      const formData = gatherFrameFormData(rootEl);
      const placedToken = canvas.tokens?.get(token.id);
      
      if (placedToken) {
        // Placed token - update originalImage if it changed, then apply frame
        const currentOriginal = await placedToken.document.getFlag(MODULE_ID, 'originalImage');
        if (baseImageState.path !== currentOriginal) {
          await placedToken.document.setFlag(MODULE_ID, 'originalImage', baseImageState.path);
        }
        await placedToken.document.setFlag(MODULE_ID, 'frameData', formData);
        await applyFrameToToken(placedToken, true);
        debugLog('Frame applied to placed token:', placedToken.name);
      } else {
        // Prototype token - get the actor first
        const actor = game.actors.get(token.actorId) || token.actor;
        
        if (actor) {
          // Pre-generate the cached frame using actor ID for consistent filename
          const cachedPath = await generateFrameForPrototype(baseImageState.path, formData, actor.id);
          
          if (cachedPath) {
            // Update the prototype token's texture.src and flags
            await actor.update({
              'prototypeToken.texture.src': cachedPath,
              [`prototypeToken.flags.${MODULE_ID}.frameData`]: formData,
              [`prototypeToken.flags.${MODULE_ID}.cachedFramePath`]: cachedPath,
              [`prototypeToken.flags.${MODULE_ID}.originalImage`]: baseImageState.path
            });
            debugLog('Prototype token updated with cached frame:', cachedPath);
          } else {
            // Generation failed, just save the settings
            await actor.update({
              [`prototypeToken.flags.${MODULE_ID}.frameData`]: formData
            });
            debugLog('Frame settings saved (generation failed)');
          }
        } else {
          // No actor found - just set flags on token
          await token.setFlag(MODULE_ID, 'frameData', formData);
          debugLog('Frame settings saved to prototype token (no actor found)');
        }
      }
    });
  }

  // Restore Original button
  const restoreButton = rootEl.querySelector('[data-token-framer="actions"] .tfl-restore-button');
  if (restoreButton) {
    restoreButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      
      const placedToken = canvas.tokens?.get(token.id);
      
      if (placedToken) {
        await restoreOriginalImage(placedToken);
        debugLog('Base image restored for token:', placedToken.name);
      } else {
        // Prototype token - restore original texture and clear flags
        const originalImagePath = token.getFlag(MODULE_ID, 'originalImage');
        const actor = game.actors.get(token.actorId) || token.actor;
        
        if (actor && originalImagePath) {
          // Restore the original texture and clear all flags
          await actor.update({
            'prototypeToken.texture.src': originalImagePath,
            [`prototypeToken.flags.${MODULE_ID}.-=frameData`]: null,
            [`prototypeToken.flags.${MODULE_ID}.-=originalImage`]: null,
            [`prototypeToken.flags.${MODULE_ID}.-=currentCacheKey`]: null,
            [`prototypeToken.flags.${MODULE_ID}.-=cachedFramePath`]: null
          });
          debugLog('Prototype token restored to base image');
        } else {
          // Fallback: just unset flags
          await token.unsetFlag(MODULE_ID, 'frameData');
          await token.unsetFlag(MODULE_ID, 'originalImage');
          await token.unsetFlag(MODULE_ID, 'currentCacheKey');
          await token.unsetFlag(MODULE_ID, 'cachedFramePath');
          debugLog('Prototype token frame settings cleared');
        }
      }
      
      if (enableCheckbox) {
        enableCheckbox.checked = false;
        updateDependentVisibility();
      }
    });
  }

  // Initial preview if enabled and has frame image
  if (enableCheckbox?.checked) {
    const frameImageInput = rootEl.querySelector(`input[name="flags.${MODULE_ID}.frameData.frameImage"]`);
    if (frameImageInput?.value) {
      updatePreview(rootEl, baseImageState.path);
    }
  }
}

/**
 * Gather frame form data from the form
 */
function gatherFrameFormData(rootEl) {
  const getValue = (name) => rootEl.querySelector(`input[name="${name}"]`)?.value ?? '';
  const getChecked = (name) => rootEl.querySelector(`input[name="${name}"]`)?.checked ?? false;
  const getNumber = (name, fallback) => parseFloat(getValue(name)) || fallback;
  const getInt = (name, fallback) => parseInt(getValue(name)) || fallback;

  return {
    enabled: getChecked(`flags.${MODULE_ID}.frameData.enabled`),
    frameImage: getValue(`flags.${MODULE_ID}.frameData.frameImage`),
    maskImage: getValue(`flags.${MODULE_ID}.frameData.maskImage`),
    baseScale: getNumber(`flags.${MODULE_ID}.frameData.baseScale`, 0.9),
    baseOffsetX: getInt(`flags.${MODULE_ID}.frameData.baseOffsetX`, 0),
    baseOffsetY: getInt(`flags.${MODULE_ID}.frameData.baseOffsetY`, 0),
    maskRadius: getNumber(`flags.${MODULE_ID}.frameData.maskRadius`, 0.95),
    maskScale: getNumber(`flags.${MODULE_ID}.frameData.maskScale`, 1.0),
    maskOffsetX: getInt(`flags.${MODULE_ID}.frameData.maskOffsetX`, 0),
    maskOffsetY: getInt(`flags.${MODULE_ID}.frameData.maskOffsetY`, 0),
    frameScale: getNumber(`flags.${MODULE_ID}.frameData.frameScale`, 1.0),
    frameOffsetX: getInt(`flags.${MODULE_ID}.frameData.frameOffsetX`, 0),
    frameOffsetY: getInt(`flags.${MODULE_ID}.frameData.frameOffsetY`, 0),
    bgEnabled: getChecked(`flags.${MODULE_ID}.frameData.bgEnabled`),
    bgColor: getValue(`flags.${MODULE_ID}.frameData.bgColor`) || '#000000'
  };
}
