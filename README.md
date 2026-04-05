# Token Framer

This is a vibe-coded (read, AI slop) project made for personal use that I figured I'd put on GitHub in case anyone is interested.

A Foundry VTT v13 module that composites pog-style frames onto token images. Combine a base token image with a frame overlay, optional mask, background, and decoration layers to create a finished framed token — cached as a WebP file for performance. Designed for quick tokenization and seamless integration with Token Variant Art.

## Requirements & Installation

**Requires Foundry VTT v13 or higher.**

### Manual Installation

1. Download the latest release
2. Extract to `Data/modules/token-framer`
3. Restart Foundry VTT
4. Enable the module in your world's module settings

## Quick Start

1. Open a token's configuration (right-click a token → gear icon, or edit a prototype token from the actor sidebar)
2. Go to the **Appearance** tab
3. Find the **Auto-Frame** controls below the Image Path field
4. Check **Enable** and click **Configure**
5. Choose a frame image — the preview updates in real-time
6. Click **Apply Auto-Frame** to save

Your token is now framed. When its art changes (manually or via Token Variant Art), the new image is automatically framed with the same settings.

## Token Framer Dialog

The dialog has a large preview on the left and settings on the right.

**Base Image** — The original token image to frame. You can browse the server, upload from your computer, drag-and-drop onto the preview, or paste from clipboard.

**Frame Image** — The frame overlay (PNG or WebP with transparency recommended).

**Collapsible Sections** — Additional settings for base image scale/offset, frame scale/offset, mask shape, overlay, pop-out effect, and background are available in expandable sections. See [Advanced Features](#advanced-features) for details.

**Actions:**
- **Sync Base Image from Image Path** — Pull the current image from the token's Image Path field
- **Reset to Original** — Disable framing and revert to the base image
- **Save to PC** — Download the composited image as a WebP file directly to your computer
- **Save to Foundry** — Export the composited image to a server folder you choose
- **Quick Save** — Save to the preset Quick Save folder, update the token's image, and detach auto-framing
- **Apply Auto-Frame** — Enable Token Framer to manage this token with automatic framing on art swaps

## Workflow Modes

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

## Batch Frame

Apply the current frame settings to multiple images at once. Open the Batch Frame dialog from the Token Framer dialog.

### Selecting Images

- **Select Files from Computer** — Choose images from your local machine
- **Select Server Folder** — Browse a folder on the Foundry server

Images are shown in a scrollable preview grid with checkboxes. Use **Select All** / **Select None** to toggle selections. Already-framed images (filenames ending in `_token`) are automatically excluded.

### Saving

- **Save to Foundry** — Composites the selected images at full resolution and saves them to the specified Foundry server folder
- **Save to PC** — Composites the selected images and downloads them as a ZIP file to your computer

A progress bar shows the current status during processing.

## Actor Sheet Integration

You can open Token Framer directly from any actor sheet's header menu (the icon bar at the top of the sheet). This is useful for quickly composing a prototype token without navigating into the token configuration first.

## Advanced Features

### Base Image Settings

Control how the base image is composited:
- **Base Scale & Offset** — Scale (0.5–1.5) and X/Y pixel offset for the base image
- **Base Opacity** — Fade the base image from fully transparent to fully opaque
- **Brightness & Contrast** — Adjust the base image's luminosity and contrast (1.0 = no change). Useful for darkening bright art or punching up flat colors
- **Base Over Frame** — Draw the base image on top of the frame instead of behind it (see Frame Settings)

### Frame Settings

Control the frame overlay layer:
- **Frame Scale & Offset** — Scale (0.5–1.5) and X/Y pixel offset for the frame
- **Frame Opacity** — Fade the frame from fully transparent to fully opaque
- **Tint Color** — Apply a color tint to the frame using a multiply blend, which preserves light/dark detail in the frame art. Enable with the checkbox and choose a color using the swatch or hex input
- **Base Over Frame** — Toggle to draw the base image on top of the frame instead of behind it

### Mask Settings

Control the shape used to clip the base image:
- **Preset Shapes** — Circle, Square, Hexagon, or None (no mask)
- **Custom Mask Image** — Use any image as a mask (white = visible, black = hidden), overrides the shape preset
- **Mask Scale & Offset** — Fine-tune the mask size and position

### Pop-Out Effect

Create a 3D-style effect where part of the base image extends above the frame. Works best with transparent-background base images.
- **Pop Out Arc** — Size of the pop-out area in degrees (1–360)
- **Pop Out Rotation** — Rotate the pop-out area (-180 to 180, 0 = top)
- **Pop Out Offset** — Adjust the center of the pop-out wedge
- **Show Preview Highlight** — Highlights the pop-out area in yellow on the preview for easier adjustment

### Overlay / Decoration

An optional image drawn on top of everything — useful for badges, icons, or a second frame layer.
- **Overlay Scale & Offset** — Scale (0.5–1.5) and X/Y pixel offset
- **Overlay Opacity** — Fade the overlay from fully transparent to fully opaque
- **Tint Color** — Apply a color tint to the overlay using a multiply blend, same as the frame tint

### Background Color Removal

Remove a solid-color background from the base image directly within Token Framer — no external editing software needed. This is especially useful for anime/manga art with flat white or colored backgrounds.

**How to use:**
1. Click anywhere on the preview image to sample a background color (the cursor becomes a crosshair). The color removal checkbox is automatically enabled.
2. Alternatively, enable the checkbox manually and pick a color using the swatch or hex input.
3. Adjust the sliders to refine the result:

| Control | Description |
|---------|-------------|
| **Color Threshold** | How similar a pixel must be to the target color to be removed. 0 = exact match only, higher = more forgiving. Start around 20–40. |
| **Feather** | Softens the removal edge by making pixels just outside the boundary gradually transparent instead of hard-cut. Good for anti-aliased edges. |
| **Grow** | Expands the removed area by N pixels to eat into remaining color fringe at the boundary. |
| **Defringe** | Shifts border pixels' colors away from the removed background color to clean up color halos left behind. |
| **Edges Only (Flood Fill)** | Only removes matching pixels connected to the image border, like a paint-bucket fill from the outside in. Safer for art with interior areas that match the background color. |

Color removal is non-destructive — the original image is preserved in memory and used as the source each time you change a setting. Unchecking the **Enable Color Removal** checkbox instantly restores the original.

> **Tip:** For best results, enable **Edges Only**, set a moderate threshold (25–40), then fine-tune Feather (1–3) and Defringe (10–20) to clean up the edge.

### Background

- **Solid Color** — Enable a background color behind the base image (use the color picker on the preview to sample colors)
- **Background Image** — Optional image for the background layer, with its own scale and offset

### Scale & Offset Controls

All layers (base, frame, mask, overlay, pop-out, background) have independent scale (0.5–1.5) and pixel offset (X/Y) controls. Number inputs support mouse wheel scrolling for quick adjustments.

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
| **Default BG Removal: Color Threshold** | 25 | Default color threshold for background removal |
| **Default BG Removal: Feather** | 2 | Default feather distance (pixels) for removal edges |
| **Default BG Removal: Grow** | 1 | Default pixel expansion beyond the color-matched boundary |
| **Default BG Removal: Defringe** | 15 | Default defringe strength for color halo cleanup |
| **Default BG Removal: Edges Only** | Off | Default for flood-fill-from-border removal mode |
| **Debug Mode** | Off | Enable console logging for troubleshooting |
| **Regenerate Cache** | — | Regenerate cached images for all actors/tokens in the world |

## How It Works

### Stop & Swap

Token Framer uses a "Stop & Swap" pattern to prevent a flash of the unframed image:

1. When a token's image changes, the update is intercepted
2. A framed version is composited and cached as a WebP file
3. The token is updated with the cached image path instead
4. The token renders with the frame already applied

### Layer Compositing Order

The final image is built from these layers (bottom to top):

1. **Background** (color and/or image, only visible through the mask)
2. **Base Image** (masked by the selected shape or custom mask)
3. **Frame** (the frame overlay)
4. **Overlay/Decoration** (badges, icons, or secondary frames)
5. **Pop Out** (unmasked base image clipped to a pie wedge, creating a 3D effect)

If **Base Image Over Frame** is enabled, the base image is drawn after the frame instead of before it.

### Anti-Double-Framing

Images with filenames ending in "token" (case-insensitive, before the extension) are automatically recognized as already-framed and skipped by auto-framing. This applies to:
- Images saved via Quick Save (which append `_token` to filenames)
- Images saved via Batch Frame
- Manually prepared images following the same naming convention

## License

MIT License

## Author

Sisimshow
