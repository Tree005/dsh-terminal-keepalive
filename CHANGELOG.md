# Changelog

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
