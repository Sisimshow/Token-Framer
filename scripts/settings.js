/**
 * Token Framer - Module Settings
 * Registers global module settings
 */

import { MODULE_ID } from './main.js';
import { applyFrameToToken, generateFrameForPrototype, regenerateAllFrames } from './frame-layer.js';

/**
 * Register module settings
 */
export function registerSettings() {
  game.settings.registerMenu(MODULE_ID, 'regenerateCache', {
    name: 'TOKEN-FRAMER.Settings.Regenerate.Name',
    label: 'TOKEN-FRAMER.Settings.Regenerate.Label',
    hint: 'TOKEN-FRAMER.Settings.Regenerate.Hint',
    icon: 'fas fa-sync',
    type: TokenFramerMaintenance,
    restricted: true
  });

  // Default frame image
  game.settings.register(MODULE_ID, 'defaultFrameImage', {
    name: 'TOKEN-FRAMER.Settings.DefaultFrameImage.Name',
    hint: 'TOKEN-FRAMER.Settings.DefaultFrameImage.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: 'modules/token-framer/assets/default.webp',
    filePicker: 'imagevideo'
  });

  // Cache folder location
  game.settings.register(MODULE_ID, 'cacheFolder', {
    name: 'TOKEN-FRAMER.Settings.CacheFolder.Name',
    hint: 'TOKEN-FRAMER.Settings.CacheFolder.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    filePicker: 'folder'
  });

  // Cache image resolution
  game.settings.register(MODULE_ID, 'cacheResolution', {
    name: 'TOKEN-FRAMER.Settings.CacheResolution.Name',
    hint: 'TOKEN-FRAMER.Settings.CacheResolution.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 1000
  });

  // Cache image quality
  game.settings.register(MODULE_ID, 'cacheQuality', {
    name: 'TOKEN-FRAMER.Settings.CacheQuality.Name',
    hint: 'TOKEN-FRAMER.Settings.CacheQuality.Hint',
    scope: 'world',
    config: true,
    type: Number,
    range: {
      min: 0.5,
      max: 1.0,
      step: 0.05
    },
    default: 0.95
  });

  // Default base scale for new frames
  game.settings.register(MODULE_ID, 'defaultBaseScale', {
    name: 'TOKEN-FRAMER.Settings.DefaultBaseScale.Name',
    hint: 'TOKEN-FRAMER.Settings.DefaultBaseScale.Hint',
    scope: 'world',
    config: true,
    type: Number,
    range: {
      min: 0.5,
      max: 1.0,
      step: 0.05
    },
    default: 0.9
  });

  // Default mask radius for auto-generated circular masks
  game.settings.register(MODULE_ID, 'defaultMaskRadius', {
    name: 'TOKEN-FRAMER.Settings.DefaultMaskRadius.Name',
    hint: 'TOKEN-FRAMER.Settings.DefaultMaskRadius.Hint',
    scope: 'world',
    config: true,
    type: Number,
    range: {
      min: 0.5,
      max: 1.0,
      step: 0.05
    },
    default: 0.95
  });

  // Debug mode setting
  game.settings.register(MODULE_ID, 'debugMode', {
    name: 'TOKEN-FRAMER.Settings.DebugMode.Name',
    hint: 'TOKEN-FRAMER.Settings.DebugMode.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false
  });
}

/**
 * A "Dummy" Application class.
 * This satisfies the requirement for 'registerMenu' but overrides render() 
 * to just run our function instead of opening a window.
 */
class TokenFramerMaintenance extends FormApplication {
  render() {
    regenerateAllFrames();
    return this;
  }
}