# Token Framer — AI Working Notes

These notes are written for an AI assistant (or a future-you) coming back to this codebase cold. Read them before touching the code.

## What this module is

A Foundry VTT module called **Token Framer** (id: `token-framer`). It composites a base token image with a frame overlay (plus optional mask, background, overlay, pop-out wedge, color-removal) into a "pog-style" framed token, caches the result as a WebP, and points the token's `texture.src` at the cached file. Designed to play nicely with **Token Variant Art (TVA)** so that swapping art automatically re-frames the new image.

- Repo: <https://github.com/Sisimshow/Token-Framer>
- Author: Sisimshow
- License: MIT
- Current version (at time of writing): **1.6.2**

## Target platform — IMPORTANT

**Foundry VTT v13.** Foundry v14 is out but this module is *not* migrating yet.

`module.json` declares:

```json
"compatibility": { "minimum": "13", "verified": "13" }
```

**Do not bump these.** When making changes, prefer V13-compatible APIs and do not "modernize" code into V14-only patterns even if a V14 deprecation warning would fire there. See `FOUNDRY-V13.md` for the full deprecation/compat list and what NOT to refactor.

## Repository layout

```
token-framer/
├── module.json                 # Foundry manifest (v13 compat pin)
├── README.md                   # User-facing documentation
├── assets/
│   └── default.webp            # Default frame image
├── lang/
│   └── en.json                 # i18n strings (key root: "TOKEN-FRAMER.*")
├── scripts/
│   ├── main.js                 # Entry point, hook registration, "Stop & Swap"
│   ├── settings.js             # Module settings registration
│   ├── frame-layer.js          # Canvas compositing + cache I/O
│   ├── token-config.js         # Token config UI injection + TokenFramerDialog (FormApplication)
│   └── batch-frame.js          # BatchFrameDialog (ApplicationV2)
├── styles/
│   └── token-framer.css        # All UI styles (`.tfl-*` prefix)
├── templates/
│   ├── frame-config.hbs        # Small fragment injected into Token Config
│   ├── frame-dialog.hbs        # Main configurator dialog
│   └── batch-dialog.hbs        # Batch frame dialog
├── .github/workflows/release.yml   # Auto-builds zip + rewrites module.json on tag
└── AI Notes/                   # ← you are here
```

## Quick file roles

| File | Lines | Role |
|------|-------|------|
| `scripts/main.js` | ~360 | Hooks for `preUpdateToken/Actor`, `updateToken/Actor`, `createToken`, `preCreateToken`, `canvasReady`. Implements the "Stop & Swap" interception. |
| `scripts/frame-layer.js` | ~625 | Pure compositing layer — `compositeImage()`, `getFramedPathForImage()`, cache key + folder management, `regenerateAllFrames()`. |
| `scripts/token-config.js` | ~2200 | The big one. Injects the enable+configure controls into Token Config (`renderTokenApplication` hook), defines `TokenFramerDialog` (FormApplication V1), implements color-removal pipeline, save-to-PC/save-to-Foundry/quick-save, and the pending-prototype-data pattern. |
| `scripts/batch-frame.js` | ~640 | `BatchFrameDialog` — uses `foundry.applications.api.ApplicationV2` + `HandlebarsApplicationMixin`. Includes a hand-rolled CRC32+ZIP builder for the "Save as ZIP" flow. |
| `scripts/settings.js` | ~270 | Registers world/client settings and the Regenerate Cache "menu" (a sham FormApplication that just runs the function on `render`). |

## Where to start when changing things

- **UI tweak inside the configurator dialog:** `templates/frame-dialog.hbs` (markup) + `scripts/token-config.js` (`activateListeners`, `_gatherFormData`, `_updatePreview`) + `styles/token-framer.css`.
- **New compositing feature (e.g., new layer):** `scripts/frame-layer.js` `compositeImage()` AND `scripts/token-config.js` `generatePreview()` — they implement the same pipeline twice (one for cache, one for preview). Keep them in sync.
- **New module setting:** `scripts/settings.js` + `lang/en.json` under `TOKEN-FRAMER.Settings.<Key>.{Name,Hint}`.
- **Hook/lifecycle behavior:** `scripts/main.js`. Be careful — the hook ordering and the `UPDATE_LOCKS` + `tokenFramerIntercepted` options flag are load-bearing. See `ARCHITECTURE.md`.
- **Batch flow:** `scripts/batch-frame.js` + `templates/batch-dialog.hbs`.

## The other notes in this folder

- **`ARCHITECTURE.md`** — Data flow, the Stop & Swap pattern, the pending-prototype-data pattern, TVA integration, anti-double-framing, cache keys.
- **`FOUNDRY-V13.md`** — Exactly which V13 APIs the code uses, which are deprecated in V14, and what NOT to "modernize" so we stay V13-friendly.

## Vibe / tone of the codebase

The author calls it "vibe-coded (AI slop)" in the README. In practice it's reasonably tidy, well-commented, and the hot paths (Stop & Swap, prototype interception) have been deliberately worked out. Don't trash existing comments — they're load-bearing breadcrumbs explaining why-not-just-X. When in doubt, read the comment above the hook before changing the hook.
