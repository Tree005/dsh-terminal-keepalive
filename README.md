# dsh-terminal-keepalive

Keeps the **right-sidebar terminal** of DeepSeek Harness (DSH) mounted when you switch tabs or sessions, so it no longer reloads / re-flashes / stutters on the way back.

## What it fixes

DSH's official right-sidebar terminal tab type does not declare `keepMounted`, so switching to another tab (files, browser, …) unmounts the terminal body. Coming back re-creates xterm and re-attaches the host stream, which replays a full screen snapshot — the "reload + lag" you see with `claude code`, `codebuddy` and other full-screen TUIs.

This plugin flips that flag at runtime for the `terminal` tab type registered in the `sidebarRightTabs` registry. The shell process, output stream and xterm instance then survive tab/session switches; switching becomes a plain show/hide.

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

## How it works

The DSH right-sidebar tab registry stores each tab type's definition object. `keepMounted` is read from that object when the dock decides whether to keep a tab body mounted.

`client.js` (a client-side Cordis plugin) obtains the `sidebarRightTabs` service and:

1. wraps `register` **once** (idempotent, marked on the service object so HMR never stacks wrappers), forcing `keepMounted = true` for every type in `KINDS`;
2. forces any already-registered definition through `get(kind)`;
3. re-runs on registry `subscribe` events (event-driven, no polling);
4. emits one `console.warn` after 3s if the expected kind never appears, so a DSH API change fails loudly instead of silently.

`KINDS` currently contains only `terminal`. Add `files` / `text` there to keep the file tree and document previews mounted too (note the extra memory).

## Compatibility

| DSH | Status |
|---|---|
| Desktop 0.2.2-rc.1 | verified working |
| newer | not yet verified — see the regression checklist below |

It relies on the client service `sidebarRightTabs` (`register`, `get`, `subscribe`) and the tab definition field `keepMounted`; a future DSH release that changes either may require an update.

## Regression checklist (after a DSH upgrade)

1. Open a terminal, run `claude` / `codebuddy`, switch to Files/Browser and back → no white flash, no reload, history and process intact, input works.
2. Open two terminals and switch between them.
3. Switch session and back.
4. Open and close a terminal normally.
5. DevTools console: no `[dsh-terminal-keepalive]` warnings.
6. If broken: confirm `sidebarRightTabs` and `keepMounted` still exist; adjust `KINDS` or the API in `client.js`.

## License

MIT
