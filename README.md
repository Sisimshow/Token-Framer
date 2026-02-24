# Token Framer

This is a vibe-coded (read, AI slop) project made for personal use that I figured I'd put on GitHub in case anyone is interested.

This is a Foundry VTT v13 module that composites pog-style frames onto token images. A base token image is combined with a frame overlay, optional mask, background, and decoration layers to create a finished framed token, which is cached as a WebP file for performance. Designed for quick tokenization and seamless integration with Token Variant Art for on-the-fly token art switching.

## Features

- **Frame Compositing**: Automatically combines base token images with frame overlays
- **Multiple Mask Shapes**: Circle, Square, Hexagon presets, or custom mask images
- **Layered Compositing**: Background, base image, frame, pop-out, and overlay/decoration layers
- **Pop-Out Effect**: Create 3D-style tokens where part of the image pops out over the frame, with configurable arc and rotation
- **Background Options**: Solid color and/or background image support
- **Overlay/Decoration Layer**: Add badges, icons, or secondary frames on top
- **Base Over Frame**: Option to draw the base image on top of the frame
- **Live Preview**: Large 500x500 preview shows changes in real-time
- **Adjustable Settings**: Fine-tune scale and offset for all layers
- **Interactive Scale Controls**: Editable number inputs with mouse wheel scrolling
- **Local Image Upload**: Upload images directly from your computer, drag-and-drop onto the preview, or paste from clipboard
- **Quick Save**: One-click save to a preset folder, update the token image, and detach auto-framing
- **Save As**: Export the composited image as a WebP file to any location
- **Anti-Double-Framing**: Images with filenames ending in "token" are automatically skipped by auto-framing
- **Actor Sheet Integration**: Open Token Framer directly from the actor sheet header menu
- **Cached Output**: Composited images are saved as WebP files for fast loading
- **No Flash of Unframed Content**: Frame compositing happens before the token renders
- **Copy-Paste Preservation**: Copied tokens retain their current framed art
- **Token Variant Art Compatible**: Full support for per-art enable/disable configurations

## Usage

### Enabling Auto-Frame on a Token

1. Open a token's configuration (right-click a token and click the gear, or edit an actor's prototype token from the sidebar)
2. Navigate to the **Appearance** tab
3. Find the **Auto-Frame** controls below the Image Path field
4. Check **Enable** to enable automatic framing for this token
5. Click **Configure** to open the Token Framer dialog

### Opening Token Framer from an Actor Sheet

You can also open Token Framer directly from any actor sheet's header menu (the icon bar at the top of the sheet). This is useful for quickly composing a prototype token without navigating into the token configuration first.

### Token Framer Dialog

The dialog provides a large preview on the left and all frame settings on the right:

**Main Settings**
- **Base Image**: The original token image to frame. Browse from the server, upload from your computer, drag-and-drop an image onto the preview, or paste from clipboard.
- **Frame Image**: The frame overlay (PNG or WebP with transparency recommended). Also supports local upload.

**Collapsible Sections**
- **Base Image Settings**: Scale and offset for the base token image
- **Frame Settings**: Base over frame toggle, frame scale and offset
- **Mask Settings**: Shape selection (Circle/Square/Hexagon/None), custom mask image, scale and offset
- **Overlay / Decoration**: Optional image drawn on top of everything (for badges, icons, etc.)
- **Pop Out**: Create a 3D effect where part of the base image extends over the frame. Configure the arc size and rotation, with an optional preview highlight.
- **Background**: Enable solid color and/or background image behind the base

**Actions**
- **Sync Base Image from Image Path**: Pull the current image from the token's Image Path field
- **Reset to Original**: Disable framing and revert to the base image
- **Save As...**: Export the current preview as a WebP file to a folder you choose
- **Quick Save**: Save to the preset Quick Save folder, update the token's image, and detach auto-framing
- **Apply Auto-Frame**: Enable Token Framer to manage this token with automatic framing on art swaps

### Workflow Modes

Token Framer supports two main workflows:

**Auto-Frame Mode** (Apply Auto-Frame)
- Token Framer manages the token's image automatically
- When art is swapped (e.g., via Token Variant Art), the new art is automatically framed
- Best for tokens that always use the same frame settings regardless of art

**Manual / One-Off Mode** (Quick Save or Save As)
- Use Token Framer as a token composer to create a finished image
- Quick Save exports the image and updates the token in one click
- The resulting image file is independent of Token Framer — auto-framing is disabled
- Quick Save is disabled when Auto-Frame is active — disable Auto-Frame first or use Reset to Original
- Files saved this way end with `_token` in the filename, which auto-framing recognizes and skips

When Auto-Frame is enabled for a token, a green indicator badge is shown at the top of the Token Framer dialog.

### Settings Reference

| Setting | Description |
|---------|-------------|
| **Base Image** | The original token image to frame |
| **Frame Image** | The frame overlay image (should have transparency) |
| **Base Scale** | Scale factor for the base image (0.5 - 1.5) |
| **Base Offset** | Pixel offset for positioning the base image |
| **Base Image Over Frame** | Draw the masked base image on top of the frame |
| **Frame Scale** | Scale factor for the frame overlay (0.5 - 1.5) |
| **Frame Offset** | Pixel offset for positioning the frame |
| **Mask Shape** | Preset mask shape: Circle, Square, Hexagon, or None |
| **Custom Mask Image** | Optional custom mask for complex shapes (white = visible, black = hidden) |
| **Mask Scale** | Scale of the mask shape or custom mask (0.5 - 1.5) |
| **Mask Offset** | Pixel offset for positioning the mask |
| **Overlay Image** | Optional decoration/badge drawn on top of everything |
| **Overlay Scale** | Scale factor for the overlay (0.5 - 1.5) |
| **Overlay Offset** | Pixel offset for positioning the overlay |
| **Pop Out Enable** | Enable the pop-out effect |
| **Pop Out Arc** | Size of the pop-out area in degrees (1 - 360) |
| **Pop Out Rotation** | Rotation of the pop-out area (-180 to 180, 0 = top) |
| **Pop Out Offset** | Pixel offset for the center of the pop-out wedge |
| **Pop Out Preview** | Highlight the pop-out area in yellow on the preview |
| **Background Enable** | Enable a solid color background |
| **Background Color** | Color for the solid background |
| **Background Image** | Optional image for the background layer |
| **Background Scale** | Scale factor for the background image (0.5 - 1.5) |
| **Background Offset** | Pixel offset for positioning the background image |

## Module Settings

Access via **Settings > Module Settings > Token Framer**:

| Setting | Default | Description |
|---------|---------|-------------|
| **Default Frame Image** | Built-in default | Frame image used when enabling framing for the first time |
| **Quick Save Folder** | `assets/tokens` | Folder for Quick Save images |
| **Quick Save: Use Token Name Subfolder** | On | Create a subfolder named after the token/actor |
| **Cache Folder** | `worlds/[world-id]/token-framer-cache` | Location for cached framed images |
| **Cache Image Resolution** | 1000 | Output size in pixels |
| **Cache Image Quality** | 0.95 | WebP quality (0.5 - 1.0) |
| **Default Base Scale** | 0.9 | Default scale for the base image |
| **Default Frame Scale** | 1.0 | Default scale for the frame overlay |
| **Default Mask Scale** | 0.95 | Default scale for the mask |
| **Default Overlay Scale** | 1.0 | Default scale for the overlay/decoration |
| **Default Pop Out Arc** | 180 | Default arc size for the pop-out effect |
| **Default Pop Out Rotation** | 0 | Default rotation for the pop-out effect |
| **Default Background Image Scale** | 1.0 | Default scale for the background image |
| **Debug Mode** | Off | Enable console logging for troubleshooting |

## Token Variant Art Integration

Token Framer is designed to work seamlessly with [Token Variant Art](https://foundryvtt.com/packages/token-variants):

- **Automatic Framing**: When a token with framing enabled changes art via TVA, the new image is automatically framed
- **Per-Art Configuration**: Use TVA's per-art configuration (Shift+Left Click on artwork) to enable or disable Token Framer for specific art pieces
- **Non-Destructive**: TVA per-art settings are stored separately from the token's main settings
- **Copy-Paste Preservation**: Copying a token with TVA-swapped art preserves the current framed image

### Per-Art Workflow

1. Select a token and open the TVA art browser
2. Shift+Left Click on an artwork to open per-art configuration
3. Find the Token Framer checkbox and configure as needed
4. Check the TVA checkbox next to the Token Framer setting to include it in the per-art config
5. Click **Save Config**

Now when that specific art is applied, Token Framer will respect the per-art setting.

## How It Works

Token Framer uses a "Stop & Swap" pattern to ensure framed tokens display correctly:

1. When a token's image changes, the update is intercepted
2. A framed version is composited and cached
3. The token is updated with the cached framed image path
4. The token renders with the frame already applied - no flash of the unframed image

### Layer Compositing Order

The final image is built from these layers (bottom to top):

1. **Background** (color and/or image, only visible through the mask)
2. **Base Image** (masked by the selected shape or custom mask)
3. **Frame** (the frame overlay)
4. **Pop Out** (unmasked base image clipped to a pie wedge, creating a 3D effect)
5. **Overlay/Decoration** (badges, icons, or secondary frames)

If **Base Image Over Frame** is enabled, the base image is drawn after the frame instead of before it.

### Anti-Double-Framing

Images with filenames ending in "token" (case-insensitive, before the extension) are automatically recognized as already-framed and skipped by auto-framing. This applies to:
- Images saved via Quick Save (which append `_token` to filenames)
- Manually prepared images following the same naming convention

## Requirements

- Foundry VTT v13 or higher

## Installation

### Manual Installation

1. Download the latest release
2. Extract to `Data/modules/token-framer`
3. Restart Foundry VTT
4. Enable the module in your world's module settings

## License

MIT License

## Author

Sisimshow
