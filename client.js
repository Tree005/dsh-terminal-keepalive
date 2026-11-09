window.__ModuleLoader__.load({
  id: 'dsh-terminal-keepalive',
  factory(require) {
    var LOG = '[dsh-terminal-keepalive]';
    // Runtime configuration lives in localStorage as JSON:
    //   { "kinds": ["terminal", "files", "text"], "maxOpenTabs": 6 }
    // "kinds":      tab kinds to keep mounted across tab / session switches.
    // "maxOpenTabs": global gate. While the number of open tabs of these kinds
    //                is <= this value they stay mounted; once it grows past it,
    //                keep-alive turns off for all of these kinds until it drops
    //                back. 0 (or omitted) disables the gate (always keep-mounted).
    var CONFIG_KEY = 'dsh-terminal-keepalive.config';
    var DEFAULT_KINDS = ['terminal'];
    var DEFAULT_MAX_OPEN_TABS = 6;
    // Marker kept on the service object so HMR / repeated apply never stacks wrappers.
    var PATCH = typeof Symbol === 'function' ? Symbol.for('dsh-terminal-keepalive.register') : '__dshTerminalKeepalive';
    // Per-definition record of the value we replaced, so unload can put it back.
    var ORIG = typeof Symbol === 'function' ? Symbol.for('dsh-terminal-keepalive.original') : '__dshTerminalKeepaliveOriginal';

    // Read and validate the JSON config. Anything invalid falls back to defaults.
    function readConfig() {
      var kinds = DEFAULT_KINDS.slice();
      var maxOpenTabs = DEFAULT_MAX_OPEN_TABS;
      try {
        var raw = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(CONFIG_KEY) : null;
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.kinds)) {
              // An explicit (even empty) list wins; empty means "keep nothing mounted".
              kinds = [];
              for (var i = 0; i < parsed.kinds.length; i++) {
                var kind = parsed.kinds[i];
                if (typeof kind === 'string' && kind.length > 0) kinds.push(kind);
              }
            }
            if (typeof parsed.maxOpenTabs === 'number' && isFinite(parsed.maxOpenTabs) && parsed.maxOpenTabs >= 0) {
              maxOpenTabs = Math.floor(parsed.maxOpenTabs);
            }
          }
        }
      } catch (e) {
        // malformed config -> defaults
      }
      return { kinds: kinds, maxOpenTabs: maxOpenTabs };
    }

    // Seed the default config once so it is discoverable (DevTools -> Application ->
    // Local Storage) and editable without reading the source.
    function seedConfig() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        if (window.localStorage.getItem(CONFIG_KEY) === null) {
          window.localStorage.setItem(CONFIG_KEY, JSON.stringify({
            kinds: DEFAULT_KINDS.slice(),
            maxOpenTabs: DEFAULT_MAX_OPEN_TABS
          }));
        }
      } catch (e) {}
    }

    return {
      inject: ['sidebarRightTabs'],
      apply(ctx) {
        try {
          seedConfig();
          var svc = ctx.sidebarRightTabs;
          if (!svc || typeof svc.register !== 'function') {
            try { console.warn(LOG, 'sidebarRightTabs service unavailable; keep-alive disabled'); } catch (e) {}
            return;
          }

          // The sidebar service carries openTabs (a snapshot of every open tab across
          // sessions). Optional, and deliberately not in `inject`: without it the
          // memory gate stays open rather than the whole plugin failing to apply.
          function sidebarService() {
            try { if (typeof ctx.get === 'function') { var s = ctx.get('sidebarRight'); if (s) return s; } } catch (e) {}
            try { if (ctx.sidebarRight) return ctx.sidebarRight; } catch (e) {}
            return undefined;
          }

          var managed = []; // definitions whose keepMounted we may have changed
          var configuredKinds = []; // kinds we drove on the previous reconcile pass

          function remember(def) {
            if (def[ORIG] === undefined) {
              def[ORIG] = {
                had: Object.prototype.hasOwnProperty.call(def, 'keepMounted'),
                value: def.keepMounted
              };
              managed.push(def);
            }
            return def[ORIG];
          }

          // Drive one definition to the wanted state. Returns true when it changed.
          function setKeep(def, enabled) {
            try {
              remember(def);
              if (enabled) {
                if (def.keepMounted !== true) { def.keepMounted = true; return true; }
              } else {
                if (def.keepMounted !== false) { def.keepMounted = false; return true; }
              }
            } catch (e) {
              // never let a flag flip break client boot
            }
            return false;
          }

          // Put a definition back the way the registering plugin left it.
          function restoreKeep(def) {
            try {
              var orig = def[ORIG];
              if (orig === undefined) return false;
              if (orig.had) {
                if (def.keepMounted !== orig.value) { def.keepMounted = orig.value; return true; }
              } else if (Object.prototype.hasOwnProperty.call(def, 'keepMounted')) {
                delete def.keepMounted;
                return true;
              }
            } catch (e) {}
            return false;
          }

          // Count open tabs of the configured kinds across every session, from the
          // sidebar's own open-tab inventory (the same source the terminal plugin
          // uses to hold terminals). Returns null when it cannot be measured.
          function countOpenTabs(kinds) {
            if (!kinds.length) return 0;
            try {
              var right = sidebarService();
              var store = right && right.openTabs;
              if (!store || typeof store.getSnapshot !== 'function') return null;
              var snapshot = store.getSnapshot() || [];
              var n = 0;
              for (var i = 0; i < snapshot.length; i++) {
                var tab = snapshot[i];
                if (tab && kinds.indexOf(tab.kind) !== -1) n += 1;
              }
              return n;
            } catch (e) {
              return null;
            }
          }

          // Whether the memory gate currently allows keep-alive.
          function gateOpen(cfg) {
            if (!(cfg.maxOpenTabs > 0)) return true;
            var count = countOpenTabs(cfg.kinds);
            if (count === null) return true; // cannot measure -> do not gate
            return count <= cfg.maxOpenTabs;
          }

          // Reconcile every configured kind against the current config and gate.
          function reconcile() {
            var cfg = readConfig();
            var enabled = gateOpen(cfg);
            var changed = false;
            var i;
            for (i = 0; i < cfg.kinds.length; i++) {
              var def;
              try { def = typeof svc.get === 'function' ? svc.get(cfg.kinds[i]) : undefined; } catch (e) { def = undefined; }
              if (def && setKeep(def, enabled)) changed = true;
            }
            // Kinds we used to drive but that are no longer configured: give them back.
            for (i = 0; i < configuredKinds.length; i++) {
              if (cfg.kinds.indexOf(configuredKinds[i]) !== -1) continue;
              var stale;
              try { stale = typeof svc.get === 'function' ? svc.get(configuredKinds[i]) : undefined; } catch (e) { stale = undefined; }
              if (stale && restoreKeep(stale)) changed = true;
            }
            configuredKinds = cfg.kinds.slice();
            // Flip the visible flag even when no definition object changed but the
            // gate did: force a registry notify so already-rendered tabs re-read it.
            if (changed && typeof svc.refresh === 'function') {
              try { svc.refresh(); } catch (e) {}
            }
            return { cfg: cfg, enabled: enabled };
          }

          // Wrap register once so a definition is forced before the registry caches it.
          var created = false;
          if (svc[PATCH] === undefined) {
            var original = svc.register;
            var wrapper = function (def) {
              try {
                if (def) {
                  var cfg = readConfig();
                  if (cfg.kinds.indexOf(def.kind) !== -1) setKeep(def, gateOpen(cfg));
                }
              } catch (e) {}
              return original.call(svc, def);
            };
            try {
              svc.register = wrapper;
              svc[PATCH] = { original: original, wrapper: wrapper };
              created = true;
            } catch (e) {
              try { console.warn(LOG, 'could not wrap register(); relying on get/subscribe:', e); } catch (x) {}
            }
          }

          // First pass: fix definitions registered before this plugin applied.
          var first = reconcile();
          var seen = first.cfg.kinds.length === 0;

          function markSeen() {
            if (seen) return;
            var cfg = readConfig();
            for (var i = 0; i < cfg.kinds.length; i++) {
              var def;
              try { def = typeof svc.get === 'function' ? svc.get(cfg.kinds[i]) : undefined; } catch (e) { def = undefined; }
              if (def) return true;
            }
            return false;
          }
          if (markSeen()) seen = true;

          // Event driven: re-run whenever the registry changes (no polling timer).
          var unsub;
          try {
            if (typeof svc.subscribe === 'function') {
              unsub = svc.subscribe(function () {
                try {
                  queueMicrotask(function () { if (markSeen()) seen = true; reconcile(); });
                } catch (e) {
                  if (markSeen()) seen = true;
                  reconcile();
                }
              });
            }
          } catch (e) {
            unsub = undefined;
          }

          // Event driven: re-check the memory gate whenever the open-tab set changes.
          var unsubTabs;
          try {
            var right = sidebarService();
            var store = right && right.openTabs;
            if (store && typeof store.subscribe === 'function') {
              unsubTabs = store.subscribe(function () {
                try {
                  queueMicrotask(function () { try { reconcile(); } catch (e) {} });
                } catch (e) {
                  try { reconcile(); } catch (x) {}
                }
              });
            }
          } catch (e) {
            unsubTabs = undefined;
          }

          // One-shot diagnostic so a DSH API change fails loudly instead of silently.
          var diag = setTimeout(function () {
            if (!seen) {
              try {
                var cfg = readConfig();
                if (cfg.kinds.length) {
                  console.warn(LOG, 'tab type(s) not found; DSH may have changed its sidebar API. expected kinds:', cfg.kinds.join(','));
                }
              } catch (e) {}
            }
          }, 3000);

          ctx.effect(function () {
            return function () {
              try { clearTimeout(diag); } catch (e) {}
              try { if (unsub) unsub(); } catch (e) {}
              try { if (unsubTabs) unsubTabs(); } catch (e) {}
              // Put every definition we touched back the way its plugin left it.
              for (var i = 0; i < managed.length; i++) {
                try { restoreKeep(managed[i]); } catch (e) {}
              }
              try {
                var marker = svc[PATCH];
                if (created && marker && svc.register === marker.wrapper) {
                  svc.register = marker.original;
                  delete svc[PATCH];
                }
              } catch (e) {}
            };
          });
        } catch (e) {
          try { console.warn(LOG, 'apply failed', e); } catch (x) {}
        }
      },
    };
  },
});
