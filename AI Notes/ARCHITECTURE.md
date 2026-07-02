# Architecture & Patterns

This file explains how the pieces fit together and the non-obvious patterns. Read `README.md` first for orientation.

## High-level data flow

```
       [User changes a token's image, or TVA swaps art]
                          │
                          ▼
                preUpdateToken (main.js)         ← intercepts
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
    Already-cached / "_token"   frameData.enabled=true
    file? → let it through      → STOP the update,
                                   composite + cache,
                                   re-issue with cached path
                          │
                          ▼
                  updateToken (main.js)          ← reactor
                  (only fires if settings
                   changed, not on intercept,
                   thanks to options.tokenFramerIntercepted)
```

For prototype tokens (actor-level), the same dance happens via `preUpdateActor`/`updateActor` plus the **pending-prototype-data** pattern (below).

## Module entry points (main.js)

| Hook | What it does |
|---|---|
| `init` | Registers settings. |
| `ready` | Calls `registerTokenConfigHooks()` to wire UI injection. |
| `preUpdateToken` | The Stop & Swap interceptor for placed tokens. |
| `updateToken` | Reactor — re-runs `applyFrameToToken()` if `frameData` or `originalImage` changed via something other than the interceptor. |
| `preUpdateActor` | Same idea for prototype tokens. Also drains `PENDING_PROTOTYPE_DATA` from the dialog. |
| `updateActor` | Reactor for prototype-token settings changes. |
| `createToken` | If a placed token is dropped onto a scene without an existing cache key, generate one. |
| `preCreateToken` | Copy/paste preservation: if the new token already has `flags.token-framer.frameData`, leave it alone (don't overwrite from prototype). |
| `canvasReady` | Sweeps placed tokens that have `frameData.enabled` but no `currentCacheKey` and frames them. |

## Pattern 1 — "Stop & Swap" (prevents flash of unframed image)

The problem: when art changes (TVA, file picker, manual edit), we want the new image to render *already framed*, with no FOUC.

The solution lives in `preUpdateToken`:

1. Update arrives with `changes.texture.src = "newart.webp"`.
2. We **return false** to cancel that update.
3. Asynchronously composite the framed version, write it to cache, then re-issue `document.update()` ourselves with the cached path.

To avoid an infinite loop on the re-issued update, two guard mechanisms run in parallel:

- **`UPDATE_LOCKS` (Set of token IDs)** — added before our re-issued `document.update()`, consumed by the next `preUpdateToken` for that ID. Single-use; deleted on first hit.
- **`options.tokenFramerIntercepted`** — passed as the 3rd arg to `document.update()`. The `updateToken` reactor checks for it and bails. The point of using `options` rather than a flag in the DB is *no DB write*.

You will see both mechanisms — they protect against different races. Don't simplify them away.

### Bypass exits in `preUpdateToken` (in order)

1. Not the owner → ignore.
2. `UPDATE_LOCKS` hit → consume + ignore.
3. The update is *deleting* `flags.token-framer.frameData` (Restore button) — Foundry's deletion syntax is `"-=key": null`. Let it through.
4. No texture change → ignore.
5. New texture is in the cache folder OR ends in `_token` → ignore (anti-double-framing).
6. `frameData.enabled === false` in pending changes → ignore (user just toggled off).
7. Otherwise, intercept.

## Pattern 2 — Pending prototype data

Problem: prototype tokens (actors) save through a Token Config form. If the Token Framer dialog tries to call `actor.update()` directly while the parent Token Config form is open, the form's stale state will overwrite us on submit.

Solution (in `token-config.js`):

```js
const PENDING_PROTOTYPE_DATA = new Map(); // actorId → { cachedPath, frameData, originalImage } | { restore: true, originalImage }
```

When the dialog applies/restores against a prototype token *while the parent Token Config is open*:

1. Generate the cached image (don't write).
2. Stash the result in `PENDING_PROTOTYPE_DATA.set(actor.id, …)`.
3. Update the Token Config's `texture.src` field DOM directly (so the user sees what's happening).
4. Set the enable checkbox state to match.
5. Close the dialog.

When the user clicks "Update Token" on the parent Token Config, `preUpdateActor` (in `main.js`) sees the pending entry, merges the cache path + flags into the `changes` object using `foundry.utils.setProperty`, then calls `clearPendingPrototypeData(actor.id)`.

If the dialog was opened from the actor sheet header button (no parent Token Config), it skips the pending-data dance and `actor.update()`s directly.

## Pattern 3 — Anti-double-framing

Two paths conspire to keep already-framed images from being framed again:

- **Cache folder check** — anything inside the cache folder (default `worlds/{world.id}/token-framer-cache`, or the user-configured `cacheFolder`) is treated as already framed.
- **Filename suffix** — `isAlreadyFramedFile(path)` returns true when the filename (sans extension, case-insensitive) ends in `token`. So `mychar_token.webp` is skipped. Quick Save and Batch Frame both produce `_token.webp` files, so that flow is automatically idempotent.

The `isFromCache()` helper in `token-config.js` adds an extra hardcoded `'token-framer-cache'` substring check so old cache layouts still get recognized.

## Pattern 4 — TVA (Token Variant Art) integration

Detection: TVA's per-art configuration is a `TokenCustomConfig` that injects `imgSrc` and `callback` properties onto the app. In `activateControlListeners`:

```js
const isTVAPerArtConfig = app.imgSrc !== undefined || app.callback !== undefined;
```

When `isTVAPerArtConfig` is true, the enable checkbox change handler does NOT save to the document — TVA's own form submission does. This is the magic that lets per-art TF settings co-exist with TVA per-art storage.

For the normal (non-per-art) flow, swapping art via TVA fires `preUpdateToken`, which interception kicks in the same as a manual edit.

## Cache key generation (`generateCacheKey` in frame-layer.js)

```
{baseParentFolder}_{baseFilename}_{frameFilename}_{combinedHash}_token
```

- All path components are URL-decoded (`normalizePath` via `decodeURIComponent`) before hashing.
- `combinedHash` is a 6-char hex slice of djb2 over `base + '|' + frame`. Deterministic — same inputs always produce the same key. Don't replace this with `crypto.subtle` hashes (async, slower, breaks cache stability for existing users).
- The trailing `_token` is what makes the file self-identify as "already framed" via `isAlreadyFramedFile`. Don't drop it.
- **The key intentionally excludes frame settings** (scale, offsets, mask shape, tint, etc.) — only the base and frame image *paths* are hashed. Two tokens sharing the same base+frame images but different settings will share one cache file (last write wins). This is a deliberate author decision, not an oversight — **do not "fix" this by folding settings into the key** unless explicitly asked.

## The two compositing pipelines

There are two slightly different render paths and they MUST stay in sync feature-for-feature:

| Path | Function | Purpose |
|---|---|---|
| Cache write | `compositeImage()` in `frame-layer.js` | Server-side WebP at `cacheResolution`. |
| Live preview | `generatePreview()` in `token-config.js` | In-memory PNG data URL at 200/500 px for the dialog. |

Differences:

- Both pipelines scale every layer offset by `offsetScale = size / 512` (offsets are authored against a conceptual 512px canvas). This keeps cached output visually matching the dialog preview regardless of `cacheResolution`. Both `compositeImage()` and `generatePreview()` must apply this scaling identically — this was a real bug (cache output didn't match preview) fixed in a later release; don't reintroduce the divergence by adding a new offset field to only one pipeline.
- Preview renders the optional pop-out highlight (`popOutPreview` flag); cache never does.
- Otherwise the layer order, mask logic, tint logic, and pop-out math are identical.

When you add a new layer / setting, change BOTH and adjust `_gatherFormData` to read it from the form.

## Layer compositing order (both pipelines)

Bottom → top, conditional on `baseOverFrame`:

1. **Background** (color and/or image, drawn inside the masked region only).
2. **Base image** (clipped by mask shape OR custom mask image).
3. **Frame** (with optional opacity and multiply tint).
4. *(if `baseOverFrame`, swap 2 and 3)*
5. **Overlay/decoration** (on top of frame).
6. **Pop-out** (unmasked base image, clipped to a pie wedge — drawn ABOVE the overlay so the 3D effect dominates).
7. **Pop-out preview highlight** — only in `generatePreview`, never written to cache.

## Color removal pipeline (`_applyColorRemoval` in token-config.js)

Steps in order: **threshold → edges-only (BFS flood fill from border) → grow → apply mask → feather (BFS distance from boundary) → defringe**. Feather is *spatial* boundary distance, not color distance — interior pixels matching the bg color are never partially-erased once they're past the feather radius. This was a deliberate fix; don't refactor to a color-distance gradient.

The result is a **data URL stored in `this.baseImagePath`** while the original server path is preserved in `this._originalBaseImagePath`. Because the data URL isn't a server file, **Auto-Frame is refused** for color-removed images (`_applyFrame` shows a notification telling the user to Quick Save / Save to Foundry first).

## Notification suppression

`FilePicker.upload()` triggers info notifications by default. During cache writes (especially batch ones, where you'd see N green pop-ups), `beginNotificationSuppression()` / `endNotificationSuppression()` swap `ui.notifications.info` with a no-op. The counter (`notificationSuppressionCount`) handles concurrent uploads. Always pair them in a `try/finally`.

## Two dialog classes — and why they differ

| Class | Base | Where | Why |
|---|---|---|---|
| `TokenFramerDialog` | `FormApplication` (V1) | `token-config.js` | V13 still ships V1 sheets and FilePicker integration is easier here. |
| `BatchFrameDialog` | `ApplicationV2` + `HandlebarsApplicationMixin` | `batch-frame.js` | Author's experiment with the new API. The static `actions` object on `DEFAULT_OPTIONS` wires `data-action` handlers without per-element listeners. |

Both work fine on V13. If you want to migrate `TokenFramerDialog` to ApplicationV2 to remove V14 deprecation warnings, see `FOUNDRY-V13.md` — it's a non-trivial refactor and **not** required for V13 compatibility.

## Settings menu trick

`game.settings.registerMenu` requires a class. `TokenFramerMaintenance extends FormApplication` overrides `render()` to call `regenerateAllFrames()` and never opens a window. It's a hack but a useful one — the menu button in Settings simply executes a function. Keep it.
