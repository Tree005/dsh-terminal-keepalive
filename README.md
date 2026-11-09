# dsh-terminal-keepalive

Keeps the **right-sidebar terminal** of DeepSeek Harness (DSH) mounted when you switch tabs or sessions, so it no longer reloads / re-flashes / stutters on the way back.

## What it fixes

DSH's official right-sidebar terminal tab type does not declare `keepMounted`, so switching to another tab (files, browser, …) unmounts the terminal body. Coming back re-creates xterm and re-attaches the host stream, which replays a full screen snapshot — the "reload + lag" you see with `claude code`, `codebuddy` and other full-screen TUIs.

This plugin flips that flag at runtime for the configured tab kinds (default: the `terminal` tab type) registered in the `sidebarRightTabs` registry. The shell process, output stream and xterm instance then survive tab/session switches; switching becomes a plain show/hide.

- No second PTY, no custom xterm, no change to `app.asar`.
- Keeps the official terminal implementation (official PTY, transport, theme, Agent terminal tools).
- Zero runtime dependencies.

## Install

```sh
dsh plugin --profile desktop add "file:/path/to/dsh-terminal-keepalive"
```

Then fully quit and restart DSH. A local directory install is a link, so edits are picked up on the next start.

From GitHub:

```sh
# Recommended: uses git, avoids the codeload.github.com tarball host
# (which some networks reset with ECONNRESET).
dsh plugin --profile desktop add "git+https://github.com/Tree005/dsh-terminal-keepalive.git"

# Shorthand; may fail on networks that block/reset codeload.github.com.
dsh plugin --profile desktop add "github:Tree005/dsh-terminal-keepalive"
```

Restart DSH after installing.

## Configuration

**Via the GUI (easiest):** open **Settings → Plugins → 终端常驻（右栏）** and use the config card there — check the tab kinds to keep mounted and set `maxOpenTabs`. It writes the config below and applies immediately, no restart.

**Manually:** the config is a JSON object in `localStorage` under the key **`dsh-terminal-keepalive.config`**; the plugin writes a default on first run, so you can just edit it:

```
DevTools → Console:
  JSON.parse(localStorage.getItem('dsh-terminal-keepalive.config'))
  localStorage.setItem('dsh-terminal-keepalive.config', JSON.stringify({
    kinds: ['terminal', 'files', 'text'],  // tab kinds to keep mounted
    maxOpenTabs: 6                         // memory ceiling (see below)
  }))
then reload the page (Ctrl/Cmd+R) or restart DSH.
```

| Field | Default | Meaning |
|---|---|---|
| `kinds` | `["terminal"]` | Tab kinds to keep mounted. Known kinds shipped by DSH: `terminal`, `files`, `text`, `browser`, `guide`. An empty list keeps nothing mounted (plugin effectively off). |
| `maxOpenTabs` | `6` | Memory gate: while the number of open tabs of `kinds` (across all sessions) is ≤ this, they stay mounted; above it, keep-alive turns **off for all of `kinds`** until the count drops back. `0` disables the gate (always keep-mounted). |

**Why `keepMounted` is a global on/off, not a per-tab count.** The sidebar exposes `keepMounted` only as a per-kind boolean, read as `types.find(t => t.kind === tab.kind)?.keepMounted === true`. It cannot distinguish the 1st terminal tab from the 7th, so a per-instance cap is not expressible through the public API; the gate instead flips the whole kind when the total exceeds `maxOpenTabs`. A precise per-instance cap would need an upstream dockkit change.

## How it works

The DSH right-sidebar tab registry stores each tab type's definition object. `keepMounted` is read from that object when the dock decides whether to keep a tab body mounted, and that same flag also drives session-view retention (`retainTab`).

`client.js` (a client-side Cordis plugin) obtains the `sidebarRightTabs` service and:

1. wraps `register` **once** (idempotent, marked on the service object so HMR never stacks wrappers), forcing `keepMounted` on every type listed in `kinds` **before** the registry caches it;
2. forces already-registered definitions through `get(kind)` on apply;
3. re-runs on registry `subscribe` events (event-driven, no polling);
4. subscribes to `sidebarRight.openTabs` and reconciles the memory gate whenever the open-tab set changes;
5. emits one `console.warn` after 3s if a configured kind never appears, so a DSH API change fails loudly instead of silently.

Turning keep-alive off (gate) sets `keepMounted = false` and calls the registry's `refresh()` so already-rendered tabs re-read the flag and release their bodies; turning it back on restores `true`. On plugin unload every definition is put back the way its own plugin registered it.

## Compatibility

| DSH | Status |
|---|---|
| Desktop 0.2.2-rc.1 | verified working |
| newer | not yet verified — see the regression checklist below |

It relies on the client service `sidebarRightTabs` (`register`, `get`, `subscribe`, `refresh`) and the tab definition field `keepMounted`, plus the optional `sidebarRight.openTabs` snapshot for the memory gate; a future DSH release that changes these may require an update. If `sidebarRight.openTabs` is absent the gate stays open and keep-alive still works.

## Regression checklist (after a DSH upgrade)

1. Open a terminal, run `claude` / `codebuddy`, switch to Files/Browser and back → no white flash, no reload, history and process intact, input works.
2. Open two terminals and switch between them.
3. Switch session and back.
4. Open and close a terminal normally.
5. DevTools console: no `[dsh-terminal-keepalive]` warnings.
6. If broken: confirm `sidebarRightTabs`, `keepMounted` and `sidebarRight.openTabs` still exist; adjust the config or the API in `client.js`.
7. Memory gate: open more than `maxOpenTabs` terminals of the configured kinds → switching away now reloads them (keep-alive off); close back below the limit → keep-alive returns.

## License

MIT
