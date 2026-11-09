window.__ModuleLoader__.load({
  id: 'dsh-terminal-keepalive',
  factory(require) {
    // Tab kinds whose body should survive tab / session switches.
    var KINDS = ['terminal'];

    function force(def) {
      try {
        if (def && KINDS.indexOf(def.kind) !== -1 && def.keepMounted !== true) {
          def.keepMounted = true;
        }
      } catch (e) {
        // ignore: never let a flag flip break client boot
      }
      return def;
    }

    return {
      inject: ['sidebarRightTabs'],
      apply(ctx) {
        try {
          var svc = ctx.sidebarRightTabs;
          if (!svc || typeof svc.register !== 'function') return;

          var original = svc.register;
          var wrapper = function (def) {
            force(def);
            return original.call(svc, def);
          };
          var wrapped = false;
          try {
            svc.register = wrapper;
            wrapped = true;
          } catch (e) {
            // service may be sealed; the polling fallback below still handles it
          }

          var fixExisting = function () {
            for (var i = 0; i < KINDS.length; i++) {
              var def;
              try {
                def = typeof svc.get === 'function' ? svc.get(KINDS[i]) : undefined;
              } catch (e) {
                def = undefined;
              }
              if (def) force(def);
            }
          };

          fixExisting();

          var unsub;
          try {
            if (typeof svc.subscribe === 'function') {
              unsub = svc.subscribe(function () {
                try { queueMicrotask(fixExisting); } catch (e) { fixExisting(); }
              });
            }
          } catch (e) {
            unsub = undefined;
          }

          var timer = setInterval(fixExisting, 500);
          var stop = setTimeout(function () { clearInterval(timer); }, 15000);

          ctx.effect(function () {
            return function () {
              try { clearInterval(timer); clearTimeout(stop); } catch (e) {}
              try { if (unsub) unsub(); } catch (e) {}
              try { if (wrapped && svc.register === wrapper) svc.register = original; } catch (e) {}
            };
          });
        } catch (e) {
          try { console.warn('[dsh-terminal-keepalive] apply failed', e); } catch (x) {}
        }
      },
    };
  },
});
