window.__ModuleLoader__.load({
  id: 'dsh-terminal-keepalive',
  factory(require) {
    // Tab kinds whose body should survive tab / session switches.
    // Add 'files' / 'text' here to also keep the file tree and document previews mounted.
    var KINDS = ['terminal'];
    var LOG = '[dsh-terminal-keepalive]';
    // Marker kept on the service object so HMR / repeated apply never stacks wrappers.
    var PATCH = typeof Symbol === 'function' ? Symbol.for('dsh-terminal-keepalive.register') : '__dshTerminalKeepalive';

    function force(def) {
      try {
        if (def && KINDS.indexOf(def.kind) !== -1 && def.keepMounted !== true) {
          def.keepMounted = true;
          return true;
        }
      } catch (e) {
        // never let a flag flip break client boot
      }
      return false;
    }

    return {
      inject: ['sidebarRightTabs'],
      apply(ctx) {
        try {
          var svc = ctx.sidebarRightTabs;
          if (!svc || typeof svc.register !== 'function') {
            try { console.warn(LOG, 'sidebarRightTabs service unavailable; keep-alive disabled'); } catch (e) {}
            return;
          }

          // Wrap register once so a definition is forced before the registry caches it.
          var created = false;
          if (svc[PATCH] === undefined) {
            var original = svc.register;
            var wrapper = function (def) {
              force(def);
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

          // Force already-registered definitions (plugin order may put us after the official one).
          function fixExisting() {
            var found = false;
            for (var i = 0; i < KINDS.length; i++) {
              var def;
              try {
                def = typeof svc.get === 'function' ? svc.get(KINDS[i]) : undefined;
              } catch (e) {
                def = undefined;
              }
              if (def) {
                found = true;
                force(def);
              }
            }
            return found;
          }

          var seen = fixExisting();

          // Event driven: re-run whenever the registry changes (no polling timer).
          var unsub;
          try {
            if (typeof svc.subscribe === 'function') {
              unsub = svc.subscribe(function () {
                try {
                  queueMicrotask(function () { if (fixExisting()) seen = true; });
                } catch (e) {
                  if (fixExisting()) seen = true;
                }
              });
            }
          } catch (e) {
            unsub = undefined;
          }

          // One-shot diagnostic so a DSH API change fails loudly instead of silently.
          var diag = setTimeout(function () {
            if (!seen) {
              try { console.warn(LOG, 'terminal tab type not found; DSH may have changed its sidebar API. expected kinds:', KINDS.join(',')); } catch (e) {}
            }
          }, 3000);

          ctx.effect(function () {
            return function () {
              try { clearTimeout(diag); } catch (e) {}
              try { if (unsub) unsub(); } catch (e) {}
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
