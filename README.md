# Token Framer

A Foundry VTT v13 module that composites pog-style frames onto token images. A base token image is combined with a frame overlay (and optional mask) to create a finished framed token, which is cached as a WebP file for performance. Designed for quick tokenization and seamless integration with Token Variant Art for on-the-fly token art switching.

## Features

- **Frame Compositing**: Automatically combines base token images with frame overlays
- **Custom Masks**: Use circular masks (default) or custom mask images for non-circular frames
- **Background Color**: Add a solid background color behind the base image
- **Live Preview**: Large 500x500 preview shows changes in real-time
- **Adjustable Settings**: Fine-tune scale and offset for base image, mask, and frame
- **Cached Output**: Composited images are saved as WebP files for fast loading
- **No Flash of Unframed Content**: Frame compositing happens before the token renders
- **Token Variant Art Compatible**: Full support for per-art enable/disable configurations

## Usage

### Enabling Token Framer on a Token

1. Open a token's configuration (double-click a token or edit an actor's prototype token)
2. Navigate to the **Appearance** tab
3. Find the **Token Framer** controls below the Image Path field
4. Check **Enable Frame** to enable framing for this token
5. Click **Configure** to open the Token Framer dialog

### Token Framer Dialog

The dialog provides a large preview on the left and all frame settings on the right:

1. **Base Image**: The original token image to frame. Use the **Refresh from Token** button below the preview to sync from the token's current Image Path.
2. **Frame Image**: The frame overlay (PNG or WebP with transparency recommended)
3. **Mask Image**: Optional custom mask for non-circular frames. White = visible, black = hidden. Leave empty for automatic circular masking.
4. Adjust scale and offset settings as needed using the live preview
5. Click **Apply Frame** to generate the framed token and update the Image Path
6. Click **Restore Original** to disable framing and revert to the base image

### Settings Reference

| Setting | Description |
|---------|-------------|
| **Base Image** | The original token image to frame |
| **Frame Image** | The frame overlay image (should have transparency) |
| **Mask Image** | Optional custom mask for non-circular frames |
| **Base Scale** | Scale factor for the base image (0.5 - 1.0) |
| **Base Offset** | Pixel offset for positioning the base image |
| **Mask Radius** | Radius of the circular mask when no custom mask is set |
| **Mask Scale/Offset** | Scale and position adjustments for custom masks |
| **Frame Scale/Offset** | Scale and position adjustments for the frame overlay |
| **Background Enable/Color** | Add a solid color behind the base image |

## Module Settings

Access via **Settings > Module Settings > Token Framer**:

| Setting | Default | Description |
|---------|---------|-------------|
| **Cache Folder** | `worlds/[world-id]/token-framer-cache` | Location for cached framed images |
| **Cache Image Resolution** | 1000 | Output size in pixels |
| **Cache Image Quality** | 0.95 | WebP quality (0.5 - 1.0) |
| **Default Base Scale** | 0.9 | Default scale for new frames |
| **Default Mask Radius** | 0.95 | Default circular mask radius |
| **Debug Mode** | Off | Enable console logging for troubleshooting |

## Token Variant Art Integration

Token Framer is designed to work seamlessly with [Token Variant Art](https://foundryvtt.com/packages/token-variants):

- **Automatic Framing**: When a token with framing enabled changes art via TVA, the new image is automatically framed
- **Per-Art Configuration**: Use TVA's per-art configuration (Shift+Left Click on artwork) to enable or disable Token Framer for specific art pieces
- **Non-Destructive**: TVA per-art settings are stored separately from the token's main settings

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
