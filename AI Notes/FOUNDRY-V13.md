# Foundry V13 Compatibility Notes

> **Target platform: Foundry VTT v13.** Foundry v14 is released but this module is staying on v13.
> Do not edit `module.json` to bump compatibility. Do not migrate APIs to V14-only forms.

## What `module.json` says

```json
"compatibility": {
  "minimum": "13",
  "verified": "13"
}
```

The release workflow (`.github/workflows/release.yml`) leaves these fields alone — it only rewrites `version`, `download`, and `manifest`. So whatever is committed to `module.json` ships.

## V13 APIs the code uses (and that you should keep using)

### Namespaced (`foundry.applications.*`)

| API | Used in | Notes |
|---|---|---|
| `foundry.applications.apps.FilePicker.implementation` | `frame-layer.js`, `token-config.js`, `batch-frame.js` | V13 namespaced FilePicker. There's a helper `getFilePicker()` at the top of each file that returns it. **Use this, not the bare global `FilePicker`.** |
| `foundry.applications.api.ApplicationV2` | `batch-frame.js` | `BatchFrameDialog` extends this. |
| `foundry.applications.api.HandlebarsApplicationMixin` | `batch-frame.js` | Mixed into ApplicationV2 to use `static PARTS`. |
| `foundry.applications.handlebars.renderTemplate` | `token-config.js` (`renderTokenFrameControls`) | V13 namespaced renderer. The legacy global `renderTemplate` still works in V13 but not V14; we already use the namespaced one. Keep it. |
| `foundry.utils.mergeObject` | `token-config.js` (`TokenFramerDialog.defaultOptions`) | Standard. |
| `foundry.utils.deepClone` | `main.js` | Standard. |
| `foundry.utils.setProperty` | `main.js` | For deep merging the pending-prototype-data into `changes`. |

### Hooks

| Hook | Used in | Compat note |
|---|---|---|
| `init`, `ready` | `main.js` | Standard. |
| `preUpdateToken`, `updateToken`, `preUpdateActor`, `updateActor`, `createToken`, `preCreateToken`, `canvasReady` | `main.js` | Standard document hooks. Stable across V13/V14. |
| `renderTokenApplication` | `token-config.js` (`registerTokenConfigHooks`) | **V13 unified hook.** In V12 you had `renderTokenConfig` (placed) and `renderPrototypeTokenConfig` (prototype) separately. V13 unified them. The handler does `app.document || app.token` to handle either ApplicationV2 or legacy V1. Keep this defensive lookup. |
| `getActorSheetHeaderButtons` | `token-config.js` | **V1 actor-sheet hook.** Adds the Token Framer button to AppV1 actor sheets. Still works in V13. May be removed in V14. |
| `getHeaderControlsApplicationV2` | `token-config.js` | **AppV2 actor-sheet hook.** Adds the same button to AppV2 sheets. We register both so we cover both sheet flavors. |

### V1-era APIs that are still fine on V13

These have V14 deprecations or alternatives, but **DO NOT migrate them just to silence V14 warnings**. The refactors are non-trivial and break things on V13.

| V1 API | Used in | V14 replacement (if/when we migrate) | Notes |
|---|---|---|---|
| `FormApplication` | `token-config.js` (`TokenFramerDialog`, `TokenFramerMaintenance`) | `foundry.applications.api.ApplicationV2` + `HandlebarsApplicationMixin` | The dialog is ~1500 lines of listeners + form gathering. Migrating it is a big rewrite. **Don't.** |
| `Dialog.confirm({...})` | `frame-layer.js` (`regenerateAllFrames`) | `foundry.applications.api.DialogV2.confirm({...})` | Single use. Trivial migration the day we *do* upgrade to V14, but not today. |
| `super.activateListeners(html)` with jQuery `html` | `token-config.js` | AppV2 uses `_onRender(context, options)` and a raw HTMLElement | The V1 dialog deals with `html instanceof jQuery` defensively — the `rootEl = html[0] || html` pattern in places like `renderTokenFrameControls`. Keep the defensiveness. |

### Non-Foundry APIs (browser / PIXI)

| API | Used in | Note |
|---|---|---|
| `PIXI.Assets.cache.has`, `PIXI.Assets.unload` | `frame-layer.js` | V13 ships PixiJS v7, where `PIXI.Assets` is the modern resource loader. Used to clear cached textures so a regenerated frame is reloaded from disk. |
| `PIXI.Texture.removeFromCache` | `frame-layer.js` | Fallback for older Pixi paths. Keep the try/catch wrapping. |
| `window.showSaveFilePicker` | `token-config.js` (`_saveToPC`) | Native File System Access API — Electron/Chromium have it; Firefox doesn't. There's a blob-URL `<a download>` fallback. |
| `FileReader`, `URL.createObjectURL`, `Image`, `<canvas>`, `getImageData` | Throughout | Standard. |

## V13 → V14 deprecations relevant to this module (FYI only)

If/when we eventually upgrade, these are the things that will need attention. Listed so you know what NOT to "fix" preemptively.

1. **`FormApplication` → `ApplicationV2`**. The `TokenFramerDialog` is the big one. V14 will eventually nuke V1 entirely. Plan: rewrite as `ApplicationV2 + HandlebarsApplicationMixin` (BatchFrameDialog already shows the pattern).

2. **`Dialog.confirm` → `foundry.applications.api.DialogV2.confirm`**. Trivial swap in `regenerateAllFrames()`.

3. **`getActorSheetHeaderButtons`**. AppV1-only hook. Remove the registration when V1 sheets are gone; we already support V2 via `getHeaderControlsApplicationV2`.

4. **Old global helpers** (`FilePicker`, `renderTemplate`, `Dialog`, `loadTemplates`). The code already uses namespaced forms for FilePicker and renderTemplate. Don't reintroduce the bare globals.

5. **`renderTokenApplication` → `renderTokenConfig` (AppV2)**. V14 may rename or split this hook. Keep the union-handler shape so future migration is `s/renderTokenApplication/whatever/`.

6. **`FilePicker.upload({ notify: false })`**. The notification suppression hack (`beginNotificationSuppression`) exists because `notify: false` historically didn't fully silence the notification. If V14 honors `notify: false` properly we can drop the suppression — verify before removing.

## Things that look V14 but are actually fine on V13

- `foundry.applications.apps.FilePicker.implementation` — yes, this *is* the V13 namespace. V12 used global `FilePicker`. We're correct here.
- `foundry.applications.api.ApplicationV2` — V13. ApplicationV2 was introduced in V12 but stabilized in V13.
- The `static DEFAULT_OPTIONS = { ..., actions: { name: ClassName.#privateStaticHandler } }` syntax in `BatchFrameDialog` — V13 ApplicationV2 uses this pattern. Note that the action handlers run with `this` bound to the instance (not the class), which is why they're declared `static` but use instance state.

## Build / release

`.github/workflows/release.yml` runs on a published GitHub release.

It does, in order:

1. Reads the version from the tag (`v1.6.2` → `1.6.2`).
2. Rewrites `module.json`'s `version`, `download`, `manifest` URLs (using `jq`).
3. Zips `module.json README.md assets/ lang/ scripts/ styles/ templates/` into `token-framer-{version}.zip`.
4. Uploads the zip + `module.json` as release assets via `softprops/action-gh-release@v2`.

**Implications for editing:**

- The zip excludes `.github/`, `.claude/`, `AI Notes/`, `.gitignore`, `.git/`. So adding files here in the repo is safe — they won't ship to users. But anything you add under `assets/`, `lang/`, `scripts/`, `styles/`, `templates/` (or new top-level folders) needs to be added to that `cp -r` line in `release.yml`, otherwise it'll be missing in the released zip.
- `module.json` `compatibility` is preserved through the workflow — only the three URL/version fields are rewritten. Stays at v13.

To cut a release: tag a commit `vX.Y.Z` and publish a GitHub release on it. Workflow handles the rest.

## CSS prefix

All injected DOM uses the `tfl-` prefix (Token Framer Layer). When adding new UI, follow the convention so styles in `token-framer.css` keep working without leaking globally.

## i18n

All user-facing strings live under `TOKEN-FRAMER.*` in `lang/en.json`. Use `game.i18n.localize` / `game.i18n.format` from JS and `{{localize "..."}}` in handlebars templates. There is currently only an English locale.

## Quick rules of thumb

- **New feature touching the cache?** Update both `compositeImage` (frame-layer.js) and `generatePreview` (token-config.js).
- **New form field?** Touch `frame-dialog.hbs` + `getData()` + `_gatherFormData()` + (if it has a default) `settings.js` + i18n keys.
- **New hook behavior?** Read the existing comments in `main.js` — there are `UPDATE_LOCKS`, the `tokenFramerIntercepted` options flag, and the `-=key: null` deletion-detection guard. Don't simplify them.
- **Bumping versions?** Tag the commit, push, and let the workflow do `module.json`. Do NOT bump compatibility to "14" while we're targeting V13.
- **TVA detection** (`app.imgSrc !== undefined || app.callback !== undefined`) is duck-typed — if TVA changes those property names in a future release, this breaks. Keep an eye on it.
