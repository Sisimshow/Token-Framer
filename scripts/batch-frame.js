/**
 * Token Framer - Batch Frame Dialog
 *
 * Applies frame settings to multiple images at once.
 * Launched from the Token Framer dialog with the current frame configuration.
 * Uses Foundry V13 ApplicationV2 API.
 */

import { MODULE_ID, debugLog } from './main.js';
import { compositeImage, beginNotificationSuppression, endNotificationSuppression } from './frame-layer.js';

const IMAGE_EXTENSIONS = /\.(webp|png|jpe?g|gif|bmp|tiff?|avif)$/i;

// Helper to get the v13 FilePicker implementation
const getFilePicker = () => foundry.applications.apps.FilePicker.implementation;

/**
 * Check if a filename indicates an already-framed file
 */
function isAlreadyFramed(filePath) {
  if (!filePath) return false;
  const filename = filePath.split('/').pop().split('?')[0];
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
  return /token$/i.test(nameWithoutExt);
}

/**
 * Extract just the filename from a path
 */
function getFilename(filePath) {
  return filePath.split('/').pop().split('?')[0];
}

/**
 * Generate output filename: strip extension, append _token.webp
 */
function outputFilename(originalName) {
  const nameWithoutExt = originalName.replace(/\.[^.]+$/, '');
  return `${nameWithoutExt}_token.webp`;
}

/**
 * Read a File object as a data URL
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
 * Build a ZIP file from an array of {name, data} entries using STORE method (no compression).
 * Returns a Blob of the ZIP file. WebP images are already compressed, so no need for deflate.
 */
function buildZip(files) {
  // CRC-32 lookup table
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c;
  }
  function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const data = file.data;
    const crc = crc32(data);

    // Local file header (30 bytes + name)
    const local = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(local);
    lv.setUint32(0, 0x04034B50, true);   // signature
    lv.setUint16(4, 20, true);            // version needed
    lv.setUint16(6, 0, true);             // flags
    lv.setUint16(8, 0, true);             // compression: STORE
    lv.setUint16(10, 0, true);            // mod time
    lv.setUint16(12, 0, true);            // mod date
    lv.setUint32(14, crc, true);          // crc-32
    lv.setUint32(18, data.length, true);  // compressed size
    lv.setUint32(22, data.length, true);  // uncompressed size
    lv.setUint16(26, nameBytes.length, true); // filename length
    lv.setUint16(28, 0, true);            // extra field length
    new Uint8Array(local, 30).set(nameBytes);

    localParts.push(new Uint8Array(local), data);

    // Central directory entry (46 bytes + name)
    const central = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(central);
    cv.setUint32(0, 0x02014B50, true);    // signature
    cv.setUint16(4, 20, true);            // version made by
    cv.setUint16(6, 20, true);            // version needed
    cv.setUint16(8, 0, true);             // flags
    cv.setUint16(10, 0, true);            // compression: STORE
    cv.setUint16(12, 0, true);            // mod time
    cv.setUint16(14, 0, true);            // mod date
    cv.setUint32(16, crc, true);          // crc-32
    cv.setUint32(20, data.length, true);  // compressed size
    cv.setUint32(24, data.length, true);  // uncompressed size
    cv.setUint16(28, nameBytes.length, true); // filename length
    cv.setUint16(30, 0, true);            // extra field length
    cv.setUint16(32, 0, true);            // comment length
    cv.setUint16(34, 0, true);            // disk number start
    cv.setUint16(36, 0, true);            // internal attrs
    cv.setUint32(38, 0, true);            // external attrs
    cv.setUint32(42, offset, true);       // local header offset
    new Uint8Array(central, 46).set(nameBytes);

    centralParts.push(new Uint8Array(central));
    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);

  // End of central directory (22 bytes)
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054B50, true);      // signature
  ev.setUint16(4, 0, true);               // disk number
  ev.setUint16(6, 0, true);               // central dir disk
  ev.setUint16(8, files.length, true);     // entries on disk
  ev.setUint16(10, files.length, true);    // total entries
  ev.setUint32(12, centralSize, true);     // central dir size
  ev.setUint32(16, offset, true);          // central dir offset
  ev.setUint16(20, 0, true);              // comment length

  return new Blob([...localParts, ...centralParts, new Uint8Array(eocd)], { type: 'application/zip' });
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Batch Frame Dialog
 * Composites multiple images with the same frame settings.
 */
export class BatchFrameDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(frameData) {
    super();
    this.frameData = frameData;
    this.images = []; // {name, src, previewUrl, selected, error}
    this.outputFolder = game.settings.get(MODULE_ID, 'quickSaveFolder') || 'assets/tokens';
    this._isProcessing = false;
  }

  static DEFAULT_OPTIONS = {
    id: 'token-framer-batch-dialog-{id}',
    classes: ['token-framer-batch-app'],
    window: {
      title: 'TOKEN-FRAMER.Batch.Title',
      resizable: true
    },
    position: {
      width: 800,
      height: 650
    },
    actions: {
      serverFolder: BatchFrameDialog.#onServerFolder,
      localFiles: BatchFrameDialog.#onLocalFiles,
      selectAll: BatchFrameDialog.#onSelectAll,
      selectNone: BatchFrameDialog.#onSelectNone,
      changeSource: BatchFrameDialog.#onChangeSource,
      outputPicker: BatchFrameDialog.#onOutputPicker,
      save: BatchFrameDialog.#onSave,
      downloadZip: BatchFrameDialog.#onDownloadZip
    }
  };

  static PARTS = {
    batch: {
      template: 'modules/token-framer/templates/batch-dialog.hbs',
      scrollable: ['.tfl-batch-grid']
    }
  };

  async _prepareContext(options) {
    return { outputFolder: this.outputFolder };
  }

  // --------------------------------------------------
  // Action Handlers (data-action buttons)
  // --------------------------------------------------

  static #onServerFolder(event, target) {
    new (getFilePicker())({
      type: 'folder',
      callback: (folderPath) => this._loadServerFolder(folderPath)
    }).render(true);
  }

  static #onLocalFiles(event, target) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/*';
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this._loadLocalFiles(e.target.files);
      }
    });
    fileInput.click();
  }

  static #onSelectAll(event, target) {
    this.images.forEach(img => { if (!img.error) img.selected = true; });
    this._updateGrid();
  }

  static #onSelectNone(event, target) {
    this.images.forEach(img => img.selected = false);
    this._updateGrid();
  }

  static #onChangeSource(event, target) {
    this._resetToSourceSelection();
  }

  static #onOutputPicker(event, target) {
    new (getFilePicker())({
      type: 'folder',
      current: this.outputFolder,
      callback: (folderPath) => {
        this.outputFolder = folderPath;
        const input = this.element.querySelector('input[name="outputFolder"]');
        if (input) input.value = folderPath;
      }
    }).render(true);
  }

  static #onSave(event, target) {
    if (!this._isProcessing) this._saveSelected();
  }

  static #onDownloadZip(event, target) {
    if (!this._isProcessing) this._downloadZip();
  }

  // --------------------------------------------------
  // Image Loading
  // --------------------------------------------------

  async _loadServerFolder(folderPath) {
    try {
      const result = await getFilePicker().browse('data', folderPath);
      const files = (result.files || []).filter(f => IMAGE_EXTENSIONS.test(f) && !isAlreadyFramed(f));
      const skipped = (result.files || []).filter(f => IMAGE_EXTENSIONS.test(f) && isAlreadyFramed(f));

      if (files.length === 0) {
        ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Batch.NoImages'));
        return;
      }

      if (skipped.length > 0) {
        ui.notifications.info(game.i18n.localize('TOKEN-FRAMER.Batch.SkippedCount').replace('{count}', skipped.length));
      }

      this.images = files.map(f => ({
        name: getFilename(f),
        src: f,
        previewUrl: null,
        selected: true,
        error: false
      }));

      this._showGrid();
      await this._generatePreviews();
    } catch (err) {
      console.error(`${MODULE_ID} | Batch: Failed to browse folder`, err);
      ui.notifications.error(game.i18n.localize('TOKEN-FRAMER.Batch.BrowseFolderFailed'));
    }
  }

  async _loadLocalFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/') && !isAlreadyFramed(f.name));
    const skipped = Array.from(fileList).filter(f => f.type.startsWith('image/') && isAlreadyFramed(f.name));

    if (files.length === 0) {
      ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Batch.NoImages'));
      return;
    }

    if (skipped.length > 0) {
      ui.notifications.info(game.i18n.localize('TOKEN-FRAMER.Batch.SkippedCount').replace('{count}', skipped.length));
    }

    const images = [];
    for (const file of files) {
      try {
        const dataUrl = await readFileAsDataURL(file);
        images.push({
          name: file.name,
          src: dataUrl,
          previewUrl: null,
          selected: true,
          error: false
        });
      } catch (err) {
        debugLog(`Batch: Failed to read file ${file.name}`, err);
      }
    }

    this.images = images;
    this._showGrid();
    await this._generatePreviews();
  }

  // --------------------------------------------------
  // Grid Management
  // --------------------------------------------------

  _showGrid() {
    const el = this.element;
    el.querySelector('.tfl-batch-source').style.display = 'none';
    el.querySelector('.tfl-batch-toolbar').style.display = '';
    el.querySelector('.tfl-batch-save-button').disabled = false;
    el.querySelector('.tfl-batch-download-button').disabled = false;
    this._renderGrid();
    this._updateCount();
    this._updateGridHeight();
  }

  _resetToSourceSelection() {
    this.images.forEach(img => {
      if (img.previewUrl && img.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(img.previewUrl);
      }
    });
    this.images = [];
    const el = this.element;
    el.querySelector('.tfl-batch-source').style.display = '';
    el.querySelector('.tfl-batch-toolbar').style.display = 'none';
    el.querySelector('.tfl-batch-progress').style.display = 'none';
    el.querySelector('.tfl-batch-grid').innerHTML = '';
    el.querySelector('.tfl-batch-save-button').disabled = true;
    el.querySelector('.tfl-batch-download-button').disabled = true;
  }

  _renderGrid() {
    const grid = this.element.querySelector('.tfl-batch-grid');
    grid.innerHTML = '';

    this.images.forEach((img, index) => {
      const item = document.createElement('div');
      item.className = 'tfl-batch-item';
      item.dataset.index = index;

      const label = document.createElement('label');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'tfl-batch-checkbox';
      checkbox.checked = img.selected;
      checkbox.addEventListener('change', () => {
        img.selected = checkbox.checked;
        this._updateCount();
      });

      const thumb = document.createElement('div');
      thumb.className = 'tfl-batch-thumbnail';
      if (img.previewUrl) {
        const imgEl = document.createElement('img');
        imgEl.src = img.previewUrl;
        imgEl.alt = img.name;
        thumb.appendChild(imgEl);
      } else if (img.error) {
        thumb.innerHTML = '<i class="fas fa-exclamation-triangle tfl-batch-error-icon"></i>';
      } else {
        thumb.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tfl-batch-filename';
      nameSpan.title = img.name;
      nameSpan.textContent = img.name;

      const header = document.createElement('div');
      header.className = 'tfl-batch-item-header';
      header.appendChild(checkbox);
      header.appendChild(nameSpan);
      label.appendChild(header);
      label.appendChild(thumb);
      item.appendChild(label);
      grid.appendChild(item);
    });
  }

  _updateGrid() {
    const items = this.element.querySelectorAll('.tfl-batch-item');
    items.forEach(item => {
      const index = parseInt(item.dataset.index);
      const img = this.images[index];
      if (!img) return;
      const checkbox = item.querySelector('.tfl-batch-checkbox');
      if (checkbox) checkbox.checked = img.selected;
    });
    this._updateCount();
  }

  _updateCount() {
    const count = this.element.querySelector('.tfl-batch-count');
    if (count) {
      const selected = this.images.filter(i => i.selected).length;
      count.textContent = `${selected} / ${this.images.length} selected`;
    }
  }

  _updateThumbnail(index) {
    const item = this.element.querySelector(`.tfl-batch-item[data-index="${index}"]`);
    if (!item) return;
    const thumb = item.querySelector('.tfl-batch-thumbnail');
    if (!thumb) return;

    const img = this.images[index];
    thumb.innerHTML = '';
    if (img.previewUrl) {
      const imgEl = document.createElement('img');
      imgEl.src = img.previewUrl;
      imgEl.alt = img.name;
      thumb.appendChild(imgEl);
    } else if (img.error) {
      thumb.innerHTML = '<i class="fas fa-exclamation-triangle tfl-batch-error-icon"></i>';
    }
  }

  // --------------------------------------------------
  // Grid Height Management
  // --------------------------------------------------

  _updateGridHeight() {
    const grid = this.element.querySelector('.tfl-batch-grid');
    if (!grid) return;
    const windowContent = this.element.querySelector('.window-content');
    if (!windowContent) return;

    const contentHeight = windowContent.clientHeight;
    const toolbar = this.element.querySelector('.tfl-batch-toolbar');
    const footer = this.element.querySelector('.tfl-batch-footer');
    const progress = this.element.querySelector('.tfl-batch-progress');

    let usedHeight = 0;
    if (toolbar && toolbar.style.display !== 'none') usedHeight += toolbar.offsetHeight;
    if (footer) usedHeight += footer.offsetHeight;
    if (progress && progress.style.display !== 'none') usedHeight += progress.offsetHeight;

    grid.style.height = `${contentHeight - usedHeight}px`;
  }

  _onPosition(position) {
    this._updateGridHeight();
  }

  // --------------------------------------------------
  // Preview Generation
  // --------------------------------------------------

  async _generatePreviews() {
    this._isProcessing = true;
    const el = this.element;
    const progressEl = el.querySelector('.tfl-batch-progress');
    const fillEl = el.querySelector('.tfl-batch-progress-fill');
    const textEl = el.querySelector('.tfl-batch-progress-text');
    progressEl.style.display = '';

    for (let i = 0; i < this.images.length; i++) {
      const img = this.images[i];
      textEl.textContent = game.i18n.localize('TOKEN-FRAMER.Batch.Processing')
        .replace('{current}', i + 1).replace('{total}', this.images.length);
      fillEl.style.width = `${((i + 1) / this.images.length) * 100}%`;

      try {
        const blob = await compositeImage(img.src, this.frameData, 200, 0.8);
        img.previewUrl = URL.createObjectURL(blob);
      } catch (err) {
        debugLog(`Batch: Failed to generate preview for ${img.name}`, err);
        img.error = true;
        img.selected = false;
      }

      this._updateThumbnail(i);
    }

    progressEl.style.display = 'none';
    this._updateCount();
    this._isProcessing = false;
  }

  // --------------------------------------------------
  // Save
  // --------------------------------------------------

  async _saveSelected() {
    const selected = this.images.filter(i => i.selected && !i.error);
    if (selected.length === 0) {
      ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Batch.NoSelection'));
      return;
    }

    this._isProcessing = true;
    const el = this.element;
    const buttonRow = el.querySelector('.tfl-batch-button-row');
    const progressEl = el.querySelector('.tfl-batch-progress');
    const fillEl = el.querySelector('.tfl-batch-progress-fill');
    const textEl = el.querySelector('.tfl-batch-progress-text');
    buttonRow.style.display = 'none';
    progressEl.style.display = '';
    fillEl.style.width = '0%';

    const cacheResolution = game.settings.get(MODULE_ID, 'cacheResolution') ?? 1000;
    const cacheQuality = game.settings.get(MODULE_ID, 'cacheQuality') ?? 0.95;

    // Ensure output folder exists
    const FilePicker = getFilePicker();
    try {
      await FilePicker.browse('data', this.outputFolder);
    } catch (e) {
      try {
        await FilePicker.createDirectory('data', this.outputFolder);
      } catch (err) {
        ui.notifications.error(game.i18n.localize('TOKEN-FRAMER.Batch.CreateFolderFailed'));
        console.error(`${MODULE_ID} | Batch: Failed to create folder`, err);
        this._isProcessing = false;
        progressEl.style.display = 'none';
        buttonRow.style.display = '';
        return;
      }
    }

    beginNotificationSuppression();
    let savedCount = 0;

    for (let i = 0; i < selected.length; i++) {
      const img = selected[i];
      textEl.textContent = game.i18n.localize('TOKEN-FRAMER.Batch.Saving')
        .replace('{current}', i + 1).replace('{total}', selected.length);
      fillEl.style.width = `${((i + 1) / selected.length) * 100}%`;

      try {
        const blob = await compositeImage(img.src, this.frameData, cacheResolution, cacheQuality);
        const filename = outputFilename(img.name);
        const file = new File([blob], filename, { type: 'image/webp' });
        await FilePicker.upload('data', this.outputFolder, file, { notify: false });
        savedCount++;
      } catch (err) {
        console.error(`${MODULE_ID} | Batch: Failed to save ${img.name}`, err);
      }
    }

    endNotificationSuppression();
    progressEl.style.display = 'none';
    buttonRow.style.display = '';
    this._isProcessing = false;

    ui.notifications.info(
      game.i18n.localize('TOKEN-FRAMER.Batch.Complete')
        .replace('{count}', savedCount)
        .replace('{folder}', this.outputFolder)
    );
  }

  // --------------------------------------------------
  // Download ZIP
  // --------------------------------------------------

  async _downloadZip() {
    const selected = this.images.filter(i => i.selected && !i.error);
    if (selected.length === 0) {
      ui.notifications.warn(game.i18n.localize('TOKEN-FRAMER.Batch.NoSelection'));
      return;
    }

    this._isProcessing = true;
    const el = this.element;
    const buttonRow = el.querySelector('.tfl-batch-button-row');
    const progressEl = el.querySelector('.tfl-batch-progress');
    const fillEl = el.querySelector('.tfl-batch-progress-fill');
    const textEl = el.querySelector('.tfl-batch-progress-text');
    buttonRow.style.display = 'none';
    progressEl.style.display = '';
    fillEl.style.width = '0%';

    const cacheResolution = game.settings.get(MODULE_ID, 'cacheResolution') ?? 1000;
    const cacheQuality = game.settings.get(MODULE_ID, 'cacheQuality') ?? 0.95;

    const entries = [];
    for (let i = 0; i < selected.length; i++) {
      const img = selected[i];
      textEl.textContent = game.i18n.localize('TOKEN-FRAMER.Batch.Saving')
        .replace('{current}', i + 1).replace('{total}', selected.length);
      fillEl.style.width = `${((i + 1) / selected.length) * 100}%`;

      try {
        const blob = await compositeImage(img.src, this.frameData, cacheResolution, cacheQuality);
        const arrayBuffer = await blob.arrayBuffer();
        entries.push({ name: outputFilename(img.name), data: new Uint8Array(arrayBuffer) });
      } catch (err) {
        console.error(`${MODULE_ID} | Batch: Failed to composite ${img.name}`, err);
      }
    }

    if (entries.length > 0) {
      const zipBlob = buildZip(entries);
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'framed-tokens.zip';
      link.click();
      URL.revokeObjectURL(url);
    }

    progressEl.style.display = 'none';
    buttonRow.style.display = '';
    this._isProcessing = false;

    if (entries.length > 0) {
      ui.notifications.info(game.i18n.localize('TOKEN-FRAMER.Batch.DownloadComplete').replace('{count}', entries.length));
    }
  }

  // --------------------------------------------------
  // Cleanup
  // --------------------------------------------------

  _onClose(options) {
    this.images.forEach(img => {
      if (img.previewUrl && img.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(img.previewUrl);
      }
    });
  }
}
