# Changelog

## 0.6.3

- Settings page: **复制诊断** button — copies a support bundle (config + live WebGL status + user agent + timestamp) to the clipboard.
- Hardened the unit-test suite (now **34 tests**) covering config parsing edge cases, WebGL context cap boundaries, visible-only behavior, and gate transitions.
- Docs audit: README/CHANGELOG aligned with the 0.6.x reality (Settings page section, WebGL, instant-apply wording).

## 0.6.2

- Settings page UX polish: **一键推荐** (one click sets WebGL on + smooth-scroll 110), a recommendation banner (shown when WebGL2 is available; suggests enabling WebGL / raising smooth-scroll), inline **field validation** hints for invalid numbers, and **复制配置 / 粘贴导入** (copy / import the config JSON via the clipboard). Reset-to-default (恢复默认) was already present.

## 0.6.1

- Removed the duplicate config card on the plugin detail page. **Settings → 终端常驻** is now the single configuration surface (the plugin detail page no longer repeats the form); the plugin description points to it.

## 0.6.0

- **Dedicated settings page.** Registers a **Settings → 终端常驻** page (`settings.section` + `settings.section.icon`) with every option in one place — tab kinds, `maxOpenTabs`, `scrollback`, `smoothScrollDuration`, `webgl`, `maxWebgl`, `webglVisibleOnly` — plus a live WebGL status line (`supported / attached / cap`) and a **恢复默认** (reset) button. The compact card on the plugin detail page remains.
- Renamed the plugin display name from "终端常驻（右栏）" to "**终端常驻**"; the description now names the "官方右侧内置终端".

## 0.5.4

- **Visible-only WebGL (D3, opt-in, default off).** New settings checkbox `webglVisibleOnly`. When enabled, WebGL is attached only to the terminal currently on screen (tracked with an `IntersectionObserver`) and released when it is hidden (tab/session switch or panel closed), so only ~1 context is held during multi-terminal use. Off by default to keep the current always-attached, smoothest-switch behaviour. Only effective when `webgl` is on and `IntersectionObserver` is available (otherwise it falls back to always-attach).

## 0.5.3

- **Configurable WebGL cap (D2).** New settings-card field `maxWebgl`. Empty → follows the keep-alive limit `maxOpenTabs` (minimum 8), so every kept-mounted terminal can get the GPU renderer; a number sets the cap explicitly. The cap counts attached **and** in-flight loads. Lowering it does not evict already-attached terminals (it only gates new attachments). Debug: `__dshTerminalKeepalive.webglStatus().cap`.

## 0.5.2

- **WebGL status + context-loss recovery (D1).**
  - `console.info('[dsh-terminal-keepalive] WebGL renderer active')` once when the GPU renderer first attaches — makes it obvious it took effect.
  - `__dshTerminalKeepalive.webglStatus()` in the console returns `{ supported, attached, cap }` for a quick self-check (no settings-page UI yet).
  - After a transient WebGL context loss, retry re-attaching once (~1.2s later); if it loses the context again, stay on DOM. Previously a single GPU reset permanently downgraded that terminal to the DOM renderer.

## 0.5.1

- **WebGL robustness (no behaviour change by default).**
  - Fixed context accounting: closing a terminal now releases its WebGL context (via the mutation observer's removed-node cleanup). Previously the 8-context cap could saturate after opening/closing a handful of terminals, after which new terminals silently stayed on the DOM renderer.
  - The cap now counts **in-flight** loads too, so opening several terminals at once can't overshoot it.
  - Added a one-time `webgl2` capability probe: on machines without WebGL2 the plugin warns once and stays on the DOM renderer instead of fetching/activating the addon.
- Result: WebGL keeps working across long sessions with many open/closed terminals, and degrades cleanly where GPU/WebGL2 isn't available.

## 0.5.0

- **Experimental WebGL renderer (opt-in).** New settings-card checkbox (`webgl`, default **off**): the plugin reaches each running terminal's xterm instance and swaps the DOM renderer for the GPU (WebGL) renderer — the only real fix for the per-frame full-viewport DOM redraw that makes scrolling feel non-smooth. Shipped as a vendored `@xterm/addon-webgl@0.19.0` package-local chunk (`client.webgl.js`, same monorepo commit as the inlined xterm 6.0.0) loaded lazily via `require.async("./client.webgl.js")`. Per-terminal `onContextLoss` falls back to DOM; a soft cap of 8 concurrent WebGL contexts; chunk-load / no-GPU failures warn once and stay on DOM. Default off → behaviour unchanged until enabled.
- Config schema: `{ kinds, maxOpenTabs, scrollback, smoothScrollDuration, webgl }`.
- Note: this vendors a bundled dependency (the addon), so the plugin is no longer strictly "zero runtime deps"; it still does not modify `app.asar` and remains a normal client plugin.

## 0.4.0

- **Live terminal tuning.** The settings card now also exposes two client-side xterm options, applied to already-running terminals (and to new ones) without a restart:
  - `scrollback` — the browser-side terminal buffer cap. Lower it to cut repaint/memory cost when switching back or scrolling. Leave empty to keep DSH's value (default 1000).
  - `smoothScrollDuration` — scroll animation in ms (`0` = off, the xterm default). A value like `80–150` gives VSCode-like smooth wheel scrolling.
- Applied through a guarded DOM bridge that recovers the live xterm `Terminal` from the React fiber of each `.xterm` node; if the official internals differ it silently no-ops (with a one-shot console warning) instead of breaking boot. Both options default to "no change".
- Config schema grows to `{ kinds, maxOpenTabs, scrollback, smoothScrollDuration }` in `localStorage['dsh-terminal-keepalive.config']`.
- Add CI (`.github/workflows/ci.yml`): `node --check` + `node --test` on push/PR.
- Add ModuleLoader-simulated unit tests (`test/client.test.cjs`) covering config, memory gate, settings-card registration, dispose restore, and the live terminal tuner.
- Add GitHub issue templates (bug report, feature request).

## 0.3.0

- **Visual settings entry.** A config card now appears on the plugin's own page in **Settings → Plugins** (slot `plugins.bundle.config`, key `dsh-terminal-keepalive`): checkboxes for the tab kinds to keep mounted plus a `maxOpenTabs` number field. Saving writes the same localStorage config and applies immediately (no restart).
- Keeps the localStorage-based runtime; the card and the keep-alive logic read/write the same `dsh-terminal-keepalive.config`.

## 0.2.0

- **Configurable tab kinds.** `KINDS` is no longer hard-coded. A JSON config in `localStorage['dsh-terminal-keepalive.config']` now chooses `kinds` (e.g. `["terminal","files","text"]`), with a default written on first run.
- **Memory ceiling.** New `maxOpenTabs` global gate: when the number of open tabs of the configured kinds exceeds it, keep-alive turns off for those kinds until the count drops back (keepMounted is a per-kind boolean, so a per-instance cap is not expressible through the public API). `0` disables the gate.
- Reconcile is driven by `sidebarRight.openTabs` changes; toggling the gate calls the registry `refresh()` so already-rendered tabs re-read `keepMounted`.
- Definitions touched by the plugin are restored on unload (removes `keepMounted` if the registering plugin never set it).

## 0.1.1

- Make the `register` wrapper idempotent (marker on the service object) so HMR / repeated apply never stacks wrappers.
- Replace the 15s polling timer with event-driven `subscribe` handling.
- Add a one-shot diagnostic warning when the target tab kind is not found (surfaces DSH API drift instead of failing silently).
- README: add a post-upgrade regression checklist and a compatibility table.

## 0.1.0

- Initial release: force `keepMounted` on the official right-sidebar `terminal` tab type so it survives tab and session switches.
