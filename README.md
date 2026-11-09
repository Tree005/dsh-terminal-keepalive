# dsh-terminal-keepalive

Keeps the **right-sidebar terminal** of DeepSeek Harness (DSH) mounted when you switch tabs or sessions, so it no longer reloads / re-flashes / stutters on the way back.

## What it fixes

DSH's official right-sidebar terminal tab type does not declare `keepMounted`, so switching to another tab (files, browser, …) unmounts the terminal body. Coming back re-creates xterm and re-attaches the host stream, which replays a full screen snapshot — the "reload + lag" you see with `claude code`, `codebuddy` and other full-screen TUIs.

This plugin flips that flag at runtime for the `terminal` tab type registered in the `sidebarRightTabs` registry. The shell process, output stream and xterm instance then survive tab/session switches; switching is just show/hide.

- No second PTY, no custom xterm, no change to `app.asar`.
- Keeps the official terminal implementation (official PTY, transport, theme, agent terminal tools).

## Install

```sh
dsh plugin --profile desktop add "file:/path/to/dsh-terminal-keepalive"
```

Then fully quit and restart DSH. A local directory install is a link, so edits are picked up on the next start.

## How it works

The DSH right-sidebar tab registry stores each tab type's definition object. `keepMounted` is read from that object when the dock decides whether to keep a tab body mounted.

`client.js` (a client-side Cordis plugin) obtains `sidebarRightTabs` and:

1. wraps `register` so any type in `KINDS` gets `keepMounted = true` before it is cached;
2. fixes any already-registered definition via `get(kind)`;
3. re-runs on registry changes and for a short poll window as a safety net.

`KINDS` currently contains only `terminal`. Add `files` / `text` there to keep file-tree and document-preview tabs mounted too.

## Compatibility

Verified on DSH Desktop `0.2.2-rc.1`. It relies on the client service `sidebarRightTabs` (`register`, `get`, `subscribe`) and the tab definition field `keepMounted`; a future DSH release that changes either may require an update.

## License

MIT
