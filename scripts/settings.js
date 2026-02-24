/**
 * Token Framer - Module Settings
 * Registers global module settings
 */

import { MODULE_ID } from './main.js';
import { regenerateAllFrames } from './frame-layer.js';

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

  // Quick Save folder
  game.settings.register(MODULE_ID, 'quickSaveFolder', {
    name: 'TOKEN-FRAMER.Settings.QuickSaveFolder.Name',
    hint: 'TOKEN-FRAMER.Settings.QuickSaveFolder.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: 'assets/tokens',
    filePicker: 'folder'
  });

  // Quick Save - use token name subfolder
  game.settings.register(MODULE_ID, 'quickSaveSubfolder', {
    name: 'TOKEN-FRAMER.Settings.QuickSaveSubfolder.Name',
    hint: 'TOKEN-FRAMER.Settings.QuickSaveSubfolder.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
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
      max: 1.5,
      step: 0.05
    },
    default: 0.9
  });

  // Default frame scale
  game.settings.register(MODULE_ID, 'defaultFrameScale', {
    name: 'TOKEN-FRAMER.Settings.DefaultFrameScale.Name',
    hint: 'TOKEN-FRAMER.Settings.DefaultFrameScale.Hint',
    scope: 'world',
    config: true,
    type: Number,
    range: {
      min: 0.5,
      max: 1.5,
      step: 0.05
    },
    default: 1.0
  });

  // Default mask scale
  game.settings.register(MODULE_ID, 'defaultMaskScale', {
    name: 'TOKEN-FRAMER.Settings.DefaultMaskScale.Name',
    hint: 'TOKEN-FRAMER.Settings.DefaultMaskScale.Hint',
    scope: 'world',
    config: true,
    type: Number,
    range: {
      min: 0.5,
      max: 1.5,
      step: 0.05
    },
    default: 0.95
  });

  // Default overlay/decoration scale
  game.settings.register(MODULE_ID, 'defaultOverlayScale', {
    name: 'TOKEN-FRAMER.Settings.DefaultOverlayScale.Name',
    hint: 'TOKEN-FRAMER.Settings.DefaultOverlayScale.Hint',
    scope: 'world',
    config: true,
    type: Number,
    range: {
      min: 0.5,
      max: 1.5,
      step: 0.05
    },
    default: 1.0
  });

  // Default pop-out arc
  game.settings.register(MODULE_ID, 'defaultPopOutDegrees', {
    name: 'TOKEN-FRAMER.Settings.DefaultPopOutDegrees.Name',
    hint: 'TOKEN-FRAMER.Settings.DefaultPopOutDegrees.Hint',
    scope: 'world',
    config: true,
    type: Number,
    range: {
      min: 1,
      max: 360,
      step: 1
    },
    default: 180
  });

  // Default pop-out rotation
  game.settings.register(MODULE_ID, 'defaultPopOutRotation', {
    name: 'TOKEN-FRAMER.Settings.DefaultPopOutRotation.Name',
    hint: 'TOKEN-FRAMER.Settings.DefaultPopOutRotation.Hint',
    scope: 'world',
    config: true,
    type: Number,
    range: {
      min: -180,
      max: 180,
      step: 1
    },
    default: 0
  });

  // Default background image scale
  game.settings.register(MODULE_ID, 'defaultBgImageScale', {
    name: 'TOKEN-FRAMER.Settings.DefaultBgImageScale.Name',
    hint: 'TOKEN-FRAMER.Settings.DefaultBgImageScale.Hint',
    scope: 'world',
    config: true,
    type: Number,
    range: {
      min: 0.5,
      max: 1.5,
      step: 0.05
    },
    default: 1.0
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