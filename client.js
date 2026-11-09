window.__ModuleLoader__.load({
  id: 'dsh-terminal-keepalive',
  factory(require) {
    var React = require('react');
    var h = React.createElement;
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
      var scrollback = null; // null = leave whatever DSH/Host chose (do not override)
      var smoothScrollDuration = 0; // 0 = instant scroll (xterm default)
      var webgl = false; // experimental GPU (WebGL) renderer for running terminals
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
            // Client-side terminal buffer cap. >0 overrides xterm's scrollback; null keeps DSH's value.
            if (typeof parsed.scrollback === 'number' && isFinite(parsed.scrollback) && parsed.scrollback > 0) {
              scrollback = Math.floor(parsed.scrollback);
            }
            // Smooth-scroll animation length in ms. 0 disables it (xterm default).
            if (typeof parsed.smoothScrollDuration === 'number' && isFinite(parsed.smoothScrollDuration) && parsed.smoothScrollDuration >= 0) {
              smoothScrollDuration = Math.floor(parsed.smoothScrollDuration);
            }
            if (parsed.webgl === true) webgl = true;
          }
        }
      } catch (e) {
        // malformed config -> defaults
      }
      return { kinds: kinds, maxOpenTabs: maxOpenTabs, scrollback: scrollback, smoothScrollDuration: smoothScrollDuration, webgl: webgl };
    }

    // Seed the default config once so it is discoverable (DevTools -> Application ->
    // Local Storage) and editable without reading the source.
    function seedConfig() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        if (window.localStorage.getItem(CONFIG_KEY) === null) {
          window.localStorage.setItem(CONFIG_KEY, JSON.stringify({
            kinds: DEFAULT_KINDS.slice(),
            maxOpenTabs: DEFAULT_MAX_OPEN_TABS,
            scrollback: null,
            smoothScrollDuration: 0,
            webgl: false
          }));
        }
      } catch (e) {}
    }

    // Write the JSON config back to localStorage (normalized). Used by the settings card.
    function writeConfig(next) {
      try {
        var kinds = Array.isArray(next.kinds) ? next.kinds.filter(function (k) { return typeof k === 'string' && k.length > 0; }) : [];
        var max = typeof next.maxOpenTabs === 'number' && isFinite(next.maxOpenTabs) && next.maxOpenTabs >= 0
          ? Math.floor(next.maxOpenTabs) : DEFAULT_MAX_OPEN_TABS;
        var scrollback = typeof next.scrollback === 'number' && isFinite(next.scrollback) && next.scrollback > 0
          ? Math.floor(next.scrollback) : null;
        var smooth = typeof next.smoothScrollDuration === 'number' && isFinite(next.smoothScrollDuration) && next.smoothScrollDuration >= 0
          ? Math.floor(next.smoothScrollDuration) : 0;
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(CONFIG_KEY, JSON.stringify({
            kinds: kinds,
            maxOpenTabs: max,
            scrollback: scrollback,
            smoothScrollDuration: smooth,
            webgl: next.webgl === true
          }));
        }
      } catch (e) {}
    }

    // Labels for the known tab kinds; unknown configured kinds still render so saving never drops them.
    var KIND_LABELS = { terminal: '终端', files: '文件树', text: '文档预览', browser: '浏览器' };

    // The settings card rendered on this bundle's page in Settings -> Plugins
    // (slot `plugins.bundle.config`, keyed by the package name). Reads/writes the
    // same localStorage config the keep-alive logic uses, and applies immediately.
    function SettingsCard(props) {
      var initial = readConfig();
      var state = React.useState(initial.kinds);
      var kinds = state[0];
      var setKinds = state[1];
      var maxState = React.useState(String(initial.maxOpenTabs));
      var maxText = maxState[0];
      var setMaxText = maxState[1];
      var savedState = React.useState(false);
      var saved = savedState[0];
      var setSaved = savedState[1];
      var sbState = React.useState(initial.scrollback == null ? '' : String(initial.scrollback));
      var sbText = sbState[0];
      var setSbText = sbState[1];
      var smoothState = React.useState(String(initial.smoothScrollDuration || 0));
      var smoothText = smoothState[0];
      var setSmoothText = smoothState[1];
      var webglState = React.useState(initial.webgl === true);
      var webglOn = webglState[0];
      var setWebglOn = webglState[1];

      var allKinds = DEFAULT_KINDS.slice();
      var known = ['terminal', 'files', 'text', 'browser'];
      for (var i = 0; i < known.length; i++) if (allKinds.indexOf(known[i]) === -1) allKinds.push(known[i]);
      for (var j = 0; j < kinds.length; j++) if (allKinds.indexOf(kinds[j]) === -1) allKinds.push(kinds[j]);

      function toggle(kind) {
        setSaved(false);
        setKinds(function (prev) {
          var idx = prev.indexOf(kind);
          if (idx === -1) return prev.concat([kind]);
          var next = prev.slice();
          next.splice(idx, 1);
          return next;
        });
      }

      function save() {
        var max = parseInt(maxText, 10);
        if (!isFinite(max) || max < 0) max = 0;
        var sb = parseInt(sbText, 10);
        if (!isFinite(sb) || sb <= 0) sb = null; // empty / 0 -> keep DSH's scrollback
        var smooth = parseInt(smoothText, 10);
        if (!isFinite(smooth) || smooth < 0) smooth = 0;
        writeConfig({ kinds: kinds, maxOpenTabs: max, scrollback: sb, smoothScrollDuration: smooth, webgl: webglOn });
        try { if (props && typeof props.onConfigChanged === 'function') props.onConfigChanged(); } catch (e) {}
        setSaved(true);
      }

      var muted = { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' };
      var label = { fontSize: '13px', color: 'var(--dsw-alias-label-primary)', fontWeight: 500 };
      var numStyle = {
        padding: '6px 10px', fontSize: '13px', borderRadius: '6px', boxSizing: 'border-box', width: '160px',
        color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)',
        border: '0.5px solid var(--dsw-alias-border-l3)', outline: 'none'
      };

      var boxes = allKinds.map(function (kind) {
        return h('label', {
          key: kind,
          style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--dsw-alias-label-primary)' },
        }, h('input', {
          type: 'checkbox',
          checked: kinds.indexOf(kind) !== -1,
          onChange: function () { toggle(kind); },
        }), kind + (KIND_LABELS[kind] ? '（' + KIND_LABELS[kind] + '）' : ''));
      });

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '4px 0' } },
        h('div', { style: muted }, '选择切换 tab / 会话时需要保持挂载的标签类型，并设置常驻上限。改动保存后立即生效，无需重启。'),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          h('div', { style: label }, '常驻的标签类型'),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '8px' } }, boxes)),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '320px' } },
          h('label', { style: label }, '内存上限（maxOpenTabs）'),
          h('input', {
            type: 'number',
            min: 0,
            value: maxText,
            onChange: function (e) { setMaxText(e.target.value); setSaved(false); },
            style: {
              padding: '6px 10px', fontSize: '13px', borderRadius: '6px', boxSizing: 'border-box',
              color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)',
              border: '0.5px solid var(--dsw-alias-border-l3)', outline: 'none'
            }
          }),
          h('div', { style: muted }, '同一次打开的这些类型标签数超过此值时，整类不再常驻（回退到切走卸载）；0 表示不设门槛。')),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '360px' } },
          h('label', { style: label }, '终端历史行数（scrollback）'),
          h('input', {
            type: 'number',
            min: 0,
            placeholder: '留空=跟随官方（默认 1000）',
            value: sbText,
            onChange: function (e) { setSbText(e.target.value); setSaved(false); },
            style: numStyle
          }),
          h('div', { style: muted }, '仅影响浏览器里 xterm 的显示缓冲上限；调小可降低切回/滚动时的重绘与内存。留空表示沿用官方的 scrollback。')),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '360px' } },
          h('label', { style: label }, '平滑滚动时长（毫秒）'),
          h('input', {
            type: 'number',
            min: 0,
            placeholder: '0 = 关闭（瞬间跳变）',
            value: smoothText,
            onChange: function (e) { setSmoothText(e.target.value); setSaved(false); },
            style: numStyle
          }),
          h('div', { style: muted }, '给终端的滚动加动画，接近 VSCode 的丝滑手感；建议 80–150。0 表示关闭（xterm 默认）。')),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '420px' } },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } },
            h('input', {
              type: 'checkbox',
              checked: webglOn,
              onChange: function (e) { setWebglOn(e.target.checked); setSaved(false); }
            }),
            '实验：WebGL 渲染器（GPU，显著提升滚动/输出流畅度）'),
          h('div', { style: muted }, '用 GPU 渲染替代 DOM 渲染，是"滚动丝滑"的实质改善。失败/无 GPU/WebGL 上下文丢失会自动回退 DOM；只对当前可见终端挂载，数量超限会自动回退。需重启 DSH 后生效，默认关闭。')),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
          h('button', {
            type: 'button',
            onClick: save,
            style: {
              padding: '6px 16px', fontSize: '13px', borderRadius: '6px', cursor: 'pointer',
              color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)',
              border: '0.5px solid var(--dsw-alias-border-l3)'
            }
          }, '保存'),
          saved ? h('span', { style: muted }, '已保存，立即生效') : null));
    }

    // Live tuning of already-running xterm instances.
    //
    // The official terminal builds `new Terminal({...})` inside a lazy chunk and
    // exposes no service handle to it, so the only no-asar way to change a live
    // terminal's options is to reach the instance through the DOM. Each xterm
    // renders a `.xterm` node whose parent is the React element that owns the
    // terminal ref; walking that React fiber to the hook holding the Terminal
    // gives us the instance. Everything is guarded: if the internal shape ever
    // changes, tuning silently becomes a no-op instead of breaking boot.
    function createTerminalTuner() {
      var originals = typeof WeakMap === 'function' ? new WeakMap() : null; // terminal -> { scrollback }
      var elementToTerm = typeof WeakMap === 'function' ? new WeakMap() : null; // .xterm element -> terminal
      var webglAddons = typeof WeakMap === 'function' ? new WeakMap() : null; // terminal -> WebglAddon
      var webglLoading = typeof Set === 'function' ? new Set() : null;
      var webglInstances = []; // addons to dispose on unload
      var webglCount = 0;
      var WEBGL_MAX = 8; // per-page WebGL context soft cap (browser limit is ~16)
      var webglWarned = false;
      var observer = null;
      var warnedNoResolve = false;
      var noop = { refresh: function () {}, dispose: function () {} };
      try {
        if (typeof document === 'undefined' || !document.querySelectorAll || !originals || !elementToTerm) return noop;

        function fiberOf(node) {
          try {
            var keys = Object.getOwnPropertyNames(node);
            for (var i = 0; i < keys.length; i++) {
              if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) {
                return node[keys[i]];
              }
            }
          } catch (e) {}
          return null;
        }

        function looksLikeTerminal(value) {
          return !!value && typeof value === 'object'
            && typeof value.write === 'function'
            && typeof value.resize === 'function'
            && typeof value.dispose === 'function'
            && value.options && typeof value.options === 'object';
        }

        // Walk up the fiber tree from the React host node that wraps `.xterm`,
        // scanning each component's hook list for a ref whose `.current` is the
        // xterm Terminal.
        function findTerminal(xtermEl) {
          try {
            var host = xtermEl && xtermEl.parentElement;
            if (!host) return null;
            var fiber = fiberOf(host);
            var depth = 0;
            while (fiber && depth++ < 40) {
              var hook = fiber.memoizedState;
              var hop = 0;
              while (hook && hop++ < 80) {
                var ms = hook.memoizedState;
                if (ms && typeof ms === 'object') {
                  var current = ms.current;
                  if (looksLikeTerminal(current)) return current;
                }
                hook = hook.next;
              }
              fiber = fiber.return;
            }
          } catch (e) {}
          return null;
        }

        function tune(term, cfg) {
          try {
            var opts = term.options;
            if (!opts || typeof opts !== 'object') return;
            if (!originals.has(term)) originals.set(term, { scrollback: opts.scrollback });
            var orig = originals.get(term);
            // Smooth scroll: >0 animates, 0 = xterm default (instant).
            var wantSmooth = cfg.smoothScrollDuration > 0 ? cfg.smoothScrollDuration : 0;
            if (opts.smoothScrollDuration !== wantSmooth) {
              try { opts.smoothScrollDuration = wantSmooth; } catch (e) {}
            }
            // Scrollback: override only when configured; otherwise restore DSH's value.
            var wantSb = cfg.scrollback > 0 ? cfg.scrollback : (orig ? orig.scrollback : undefined);
            if (typeof wantSb === 'number' && opts.scrollback !== wantSb) {
              try { opts.scrollback = wantSb; } catch (e) {}
            }
            maybeWebgl(term, cfg);
          } catch (e) {}
        }

        // Experimental GPU renderer: lazily load the vendored @xterm/addon-webgl chunk and
        // attach it to this live terminal. Default off; falls back to DOM on any failure or
        // WebGL context loss. Only the first WEBGL_MAX terminals get a context.
        function maybeWebgl(term, cfg) {
          try {
            if (!webglAddons || !webglLoading) return;
            var existing = webglAddons.get(term);
            if (cfg.webgl !== true) {
              if (existing) {
                try { existing.dispose(); } catch (e) {}
                webglAddons.delete(term);
                webglCount = Math.max(0, webglCount - 1);
              }
              return;
            }
            if (existing || webglLoading.has(term) || webglCount >= WEBGL_MAX) return;
            if (typeof require === 'undefined' || !require || typeof require.async !== 'function') return;
            webglLoading.add(term);
            Promise.resolve(require.async('./client.webgl.js')).then(function (mod) {
              webglLoading.delete(term);
              var Addon = mod && mod.WebglAddon;
              if (!Addon) { webglWarnOnce('chunk has no WebglAddon'); return; }
              try {
                var addon = new Addon();
                if (typeof addon.onContextLoss === 'function') {
                  try {
                    addon.onContextLoss(function () {
                      try { addon.dispose(); } catch (e) {}
                      webglAddons.delete(term);
                      webglCount = Math.max(0, webglCount - 1);
                      webglWarnOnce('context lost; fell back to DOM');
                    });
                  } catch (e) {}
                }
                term.loadAddon(addon);
                webglAddons.set(term, addon);
                webglInstances.push(addon);
                webglCount += 1;
              } catch (e) {
                webglWarnOnce('activate failed: ' + (e && e.message));
              }
            }).catch(function (e) {
              webglLoading.delete(term);
              webglWarnOnce('load failed: ' + (e && e.message));
            });
          } catch (e) {}
        }

        function webglWarnOnce(detail) {
          if (webglWarned) return;
          webglWarned = true;
          try { console.warn(LOG, 'WebGL renderer unavailable (staying on DOM):', detail); } catch (e) {}
        }

        // Resolve (once, cached) and tune a single `.xterm` element.
        function tuneElement(el, cfg) {
          try {
            var term = elementToTerm.get(el);
            if (!term) {
              term = findTerminal(el);
              if (!term) return false;
              elementToTerm.set(el, term);
            }
            tune(term, cfg);
            return true;
          } catch (e) { return false; }
        }

        // Full pass over every terminal element (startup + config change). Cheap:
        // tuneElement caches the instance so repeated passes don't re-walk fibers.
        function scan() {
          var cfg = readConfig();
          var nodes;
          try { nodes = document.querySelectorAll('.xterm'); } catch (e) { return; }
          var resolved = 0;
          for (var i = 0; i < nodes.length; i++) {
            if (tuneElement(nodes[i], cfg)) resolved++;
          }
          // If the user asked for tuning but we can see terminals yet resolved none,
          // the internal React shape likely changed. Warn once, never repeatedly.
          if (!warnedNoResolve && nodes.length > 0 && resolved === 0
              && (cfg.scrollback > 0 || cfg.smoothScrollDuration > 0)) {
            warnedNoResolve = true;
            try { console.warn(LOG, 'terminal tuning: found .xterm but could not resolve its instance; DSH internals may have changed.'); } catch (e) {}
          }
        }

        // Only inspect nodes ADDED to the DOM: a terminal opens by appending its
        // `.xterm` element once, so ongoing output (mutations *inside* `.xterm`)
        // never re-triggers tuning — the observer stays off the hot path.
        function tuneWithin(node, cfg) {
          try {
            if (!node || node.nodeType !== 1) return;
            if (node.classList && node.classList.contains('xterm')) tuneElement(node, cfg);
            var inner = node.querySelectorAll ? node.querySelectorAll('.xterm') : null;
            if (inner) for (var i = 0; i < inner.length; i++) tuneElement(inner[i], cfg);
          } catch (e) {}
        }

        try {
          observer = new MutationObserver(function (records) {
            var cfg = readConfig();
            for (var r = 0; r < records.length; r++) {
              var added = records[r].addedNodes;
              for (var a = 0; a < added.length; a++) tuneWithin(added[a], cfg);
            }
          });
          observer.observe(document.documentElement || document.body || document, { childList: true, subtree: true });
        } catch (e) {
          observer = null;
        }
        scan();
        return {
          refresh: function () { try { scan(); } catch (e) {} },
          dispose: function () {
            try { if (observer) observer.disconnect(); } catch (e) {}
            try { for (var i = 0; i < webglInstances.length; i++) { try { webglInstances[i].dispose(); } catch (e) {} } } catch (e) {}
          },
        };
      } catch (e) {
        return noop;
      }
    }

    return {
      inject: ['sidebarRightTabs', 'slots'],
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
          var tuner = null; // live xterm option tuner (scrollback / smooth scroll)

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
            // Re-apply the client-side terminal options in case they changed.
            try { if (tuner) tuner.refresh(); } catch (e) {}
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

          // Live-tune running xterm instances (client-side scrollback / smooth scroll).
          // A guarded DOM bridge into the official terminal; a no-op if its internals differ.
          try {
            ctx.effect(function () {
              tuner = createTerminalTuner();
              return function () { try { if (tuner) tuner.dispose(); } catch (e) {} };
            });
          } catch (e) {
            tuner = null;
          }

          // Settings UI: a config card on this bundle's own page in Settings -> Plugins.
          // Registered lazily into the Plugins page's bundle-config slot, so a profile
          // without the plugin manager simply never shows it.
          try {
            if (ctx.slots && typeof ctx.slots.inject === 'function' && typeof ctx.slots.register === 'function') {
              ctx.effect(function () {
                return ctx.slots.inject('plugins.bundle.config', function () {
                  return ctx.slots.register({
                    name: 'plugins.bundle.config',
                    key: 'dsh-terminal-keepalive',
                    inject: function () {
                      return { onConfigChanged: function () { try { reconcile(); } catch (e) {} } };
                    }
                  }, SettingsCard);
                });
              });
            }
          } catch (e) {
            try { console.warn(LOG, 'settings card unavailable:', e); } catch (x) {}
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
