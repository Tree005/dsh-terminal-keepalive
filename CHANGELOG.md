# Changelog

## 0.1.1

- Make the `register` wrapper idempotent (marker on the service object) so HMR / repeated apply never stacks wrappers.
- Replace the 15s polling timer with event-driven `subscribe` handling.
- Add a one-shot diagnostic warning when the target tab kind is not found (surfaces DSH API drift instead of failing silently).
- README: add a post-upgrade regression checklist and a compatibility table.

## 0.1.0

- Initial release: force `keepMounted` on the official right-sidebar `terminal` tab type so it survives tab and session switches.
