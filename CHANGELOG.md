# Changelog

## Unreleased

- Add CI (`.github/workflows/ci.yml`): `node --check` + `node --test` on push/PR.
- Add ModuleLoader-simulated unit tests (`test/client.test.cjs`) covering config, memory gate, settings-card registration and dispose restore.
- Add GitHub issue templates (bug report, feature request).
- README: add a Development section and CI badge (README is English).
- Docs: P4 (upstream issue/PR) dropped — the official repo has no issue tracker and omitting `keepMounted` is a deliberate memory trade-off; document tuning `terminal-controller` `scrollback`/`maxBufferedBytes` as the lever for remaining jank.

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
