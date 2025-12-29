# Token Framer

A Foundry VTT v13 module that composites pog-style frames onto token images. The base token image is combined with a frame overlay (and optional mask) to create a finished framed token, which is cached for performance.

## Features

- **Frame Compositing**: Automatically combines base token images with frame overlays
- **Custom Masks**: Use circular masks (default) or custom mask images for non-circular frames
- **Background Color**: Add a solid background color behind the base image
- **Live Preview**: See changes in real-time before applying
- **Adjustable Settings**: Fine-tune scale and offset for base image, mask, and frame
- **Cached Output**: Composited images are saved as WebP files for fast loading
- **Token Variant Art Compatible**: Full support for per-art configurations

## Usage

1. Open a token's configuration (double-click a token or edit an actor's prototype token)
2. Navigate to the **Appearance** tab
3. Scroll down to the **Token Frame** section
4. Check **Enable Frame** to reveal the frame settings
5. Select a **Frame Image** (PNG or WebP with transparency recommended)
6. Adjust settings as needed using the live preview
7. Click **Apply Frame** to generate the framed token

### Settings

| Setting | Description |
|---------|-------------|
| **Base Image** | The original token image to frame. Use the Refresh button to sync from the Image Path field. |
| **Frame Image** | The frame overlay image (should have transparency) |
| **Mask Image** | Optional custom mask. White = visible, black = hidden. Leave empty for circular mask. |
| **Base Scale** | Scale factor for the base image (0.5 - 1.0) |
| **Base Offset** | Pixel offset for positioning the base image |
| **Mask Radius** | Radius of the circular mask when no custom mask is set |
| **Mask Scale/Offset** | Scale and position adjustments for custom masks |
| **Frame Scale/Offset** | Scale and position adjustments for the frame overlay |
| **Background Enable/Color** | Add a solid color behind the base image |

## Module Settings

Access via **Settings > Module Settings > Token Framer**:

- **Cache Folder**: Custom location for cached images (default: `worlds/[world-id]/token-framer-cache`)
- **Cache Image Resolution**: Output size in pixels (default: 1000)
- **Cache Image Quality**: WebP quality 0.5-1.0 (default: 0.95)
- **Default Base Scale**: Default scale for new frames (default: 0.9)
- **Default Mask Radius**: Default circular mask radius (default: 0.95)
- **Debug Mode**: Enable console logging for troubleshooting

## Token Variant Art Integration

Token Framer is designed to work with [Token Variant Art](https://foundryvtt.com/packages/token-variants). When using TVA's per-art configuration feature (Shift+Left Click on artwork):

- Frame settings can be saved per artwork
- Background color settings are configurable per artwork
- Changing token art via TVA will automatically reapply the frame with the new base image

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

