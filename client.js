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
      var maxWebgl = null; // null = follow maxOpenTabs (at least 8)
      var webglVisibleOnly = false; // only attach WebGL to the currently visible terminal
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
            if (typeof parsed.maxWebgl === 'number' && isFinite(parsed.maxWebgl) && parsed.maxWebgl >= 1) {
              maxWebgl = Math.floor(parsed.maxWebgl);
            }
            if (parsed.webglVisibleOnly === true) webglVisibleOnly = true;
          }
        }
      } catch (e) {
        // malformed config -> defaults
      }
      return { kinds: kinds, maxOpenTabs: maxOpenTabs, scrollback: scrollback, smoothScrollDuration: smoothScrollDuration, webgl: webgl, maxWebgl: maxWebgl, webglVisibleOnly: webglVisibleOnly };
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
            webgl: false,
            maxWebgl: null,
            webglVisibleOnly: false
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
        var maxWebgl = typeof next.maxWebgl === 'number' && isFinite(next.maxWebgl) && next.maxWebgl >= 1
          ? Math.floor(next.maxWebgl) : null;
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(CONFIG_KEY, JSON.stringify({
            kinds: kinds,
            maxOpenTabs: max,
            scrollback: scrollback,
            smoothScrollDuration: smooth,
            webgl: next.webgl === true,
            maxWebgl: maxWebgl,
            webglVisibleOnly: next.webglVisibleOnly === true
          }));
        }
      } catch (e) {}
    }

    // Labels for the known tab kinds; unknown configured kinds still render so saving never drops them.
    var KIND_LABELS = { terminal: '终端', files: '文件树', text: '文档预览', browser: '浏览器' };

    // Set to the live reconcile() during apply(), so the settings page can re-apply config.
    var requestReconcile = function () {};

    // Full settings page: Settings -> 终端常驻 (a `settings.section` entry), sharing
    // the same localStorage config as the keep-alive/tuning logic.
    function TerminalSettingsPage() {
      var initial = readConfig();
      var ks = React.useState(initial.kinds), kinds = ks[0], setKinds = ks[1];
      var mx = React.useState(String(initial.maxOpenTabs)), maxText = mx[0], setMaxText = mx[1];
      var sb = React.useState(initial.scrollback == null ? '' : String(initial.scrollback)), sbText = sb[0], setSbText = sb[1];
      var sm = React.useState(String(initial.smoothScrollDuration || 0)), smoothText = sm[0], setSmoothText = sm[1];
      var wg = React.useState(initial.webgl === true), webglOn = wg[0], setWebglOn = wg[1];
      var mw = React.useState(initial.maxWebgl == null ? '' : String(initial.maxWebgl)), mwText = mw[0], setMwText = mw[1];
      var vo = React.useState(initial.webglVisibleOnly === true), voOn = vo[0], setVoOn = vo[1];
      var sv = React.useState(false), saved = sv[0], setSaved = sv[1];

      var allKinds = DEFAULT_KINDS.slice();
      var known = ['terminal', 'files', 'text', 'browser'];
      for (var i = 0; i < known.length; i++) if (allKinds.indexOf(known[i]) === -1) allKinds.push(known[i]);
      for (var j = 0; j < kinds.length; j++) if (allKinds.indexOf(kinds[j]) === -1) allKinds.push(kinds[j]);
      function toggle(kind) {
        setSaved(false);
        setKinds(function (prev) {
          var idx = prev.indexOf(kind);
          if (idx === -1) return prev.concat([kind]);
          var n = prev.slice(); n.splice(idx, 1); return n;
        });
      }

      function save() {
        var max = parseInt(maxText, 10); if (!isFinite(max) || max < 0) max = 0;
        var sbn = parseInt(sbText, 10); if (!isFinite(sbn) || sbn <= 0) sbn = null;
        var smooth = parseInt(smoothText, 10); if (!isFinite(smooth) || smooth < 0) smooth = 0;
        var mwn = parseInt(mwText, 10); if (!isFinite(mwn) || mwn < 1) mwn = null;
        writeConfig({ kinds: kinds, maxOpenTabs: max, scrollback: sbn, smoothScrollDuration: smooth, webgl: webglOn, maxWebgl: mwn, webglVisibleOnly: voOn });
        try { requestReconcile(); } catch (e) {}
        setSaved(true);
      }
      function reset() {
        var d = { kinds: DEFAULT_KINDS.slice(), maxOpenTabs: DEFAULT_MAX_OPEN_TABS, scrollback: null, smoothScrollDuration: 0, webgl: false, maxWebgl: null, webglVisibleOnly: false };
        writeConfig(d);
        setKinds(d.kinds); setMaxText(String(d.maxOpenTabs)); setSbText(''); setSmoothText('0'); setWebglOn(false); setMwText(''); setVoOn(false);
        try { requestReconcile(); } catch (e) {}
        setSaved(true);
      }

      var status = null;
      try { if (typeof window !== 'undefined' && window.__dshTerminalKeepalive && typeof window.__dshTerminalKeepalive.webglStatus === 'function') status = window.__dshTerminalKeepalive.webglStatus(); } catch (e) {}

      var muted = { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' };
      var labelStyle = { fontSize: '13px', color: 'var(--dsw-alias-label-primary)', fontWeight: 500 };
      var numStyle = { padding: '6px 10px', fontSize: '13px', borderRadius: '6px', boxSizing: 'border-box', width: '180px', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)', border: '0.5px solid var(--dsw-alias-border-l3)', outline: 'none' };
      var section = { display: 'flex', flexDirection: 'column', gap: '8px', padding: '14px 0', borderTop: '0.5px solid var(--dsw-alias-border-l3)' };
      var boxes = allKinds.map(function (kind) {
        return h('label', { key: kind, style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } },
          h('input', { type: 'checkbox', checked: kinds.indexOf(kind) !== -1, onChange: function () { toggle(kind); } }),
          kind + (KIND_LABELS[kind] ? '（' + KIND_LABELS[kind] + '）' : ''));
      });

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0', maxWidth: '720px' } },
        h('h2', { style: { fontSize: '16px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', margin: '0 0 2px' } }, '终端常驻'),
        h('div', { style: muted }, '让官方右侧内置终端在切换标签/会话时保持挂载；并调节缓冲、滚动与渲染。保存后即时生效（WebGL 会即时拉取渲染分块）。'),
        h('div', { style: section },
          h('div', { style: labelStyle }, '常驻的标签类型'),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '8px' } }, boxes),
          h('div', { style: muted }, '切 tab / 会话时保持挂载的标签类型。')),
        h('div', { style: section },
          h('label', { style: labelStyle }, '内存上限（maxOpenTabs）'),
          h('input', { type: 'number', min: 0, value: maxText, onChange: function (e) { setMaxText(e.target.value); setSaved(false); }, style: numStyle }),
          h('div', { style: muted }, '这些类型的打开标签数超过此值时整类不再常驻；0 = 不设门槛。')),
        h('div', { style: section },
          h('label', { style: labelStyle }, '终端历史行数（scrollback）'),
          h('input', { type: 'number', min: 0, placeholder: '留空 = 跟随官方（默认 1000）', value: sbText, onChange: function (e) { setSbText(e.target.value); setSaved(false); }, style: numStyle }),
          h('div', { style: muted }, '浏览器侧 xterm 缓冲上限；留空沿用官方值。')),
        h('div', { style: section },
          h('label', { style: labelStyle }, '平滑滚动时长（毫秒）'),
          h('input', { type: 'number', min: 0, placeholder: '0 = 关闭', value: smoothText, onChange: function (e) { setSmoothText(e.target.value); setSaved(false); }, style: numStyle }),
          h('div', { style: muted }, '滚动动画时长；配合 WebGL 建议 100–130，0 = 关闭。')),
        h('div', { style: section },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } },
            h('input', { type: 'checkbox', checked: webglOn, onChange: function (e) { setWebglOn(e.target.checked); setSaved(false); } }),
            '实验：WebGL 渲染器（GPU，显著提升滚动/输出流畅度）'),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '360px' } },
            h('label', { style: labelStyle }, 'WebGL 上限（maxWebgl）'),
            h('input', { type: 'number', min: 1, placeholder: '留空 = 跟随内存上限（至少 8）', value: mwText, onChange: function (e) { setMwText(e.target.value); setSaved(false); }, style: numStyle })),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } },
            h('input', { type: 'checkbox', checked: voOn, onChange: function (e) { setVoOn(e.target.checked); setSaved(false); } }),
            'WebGL 只作用于"当前可见"终端（省显存/context，切换可能略抖动）'),
          status ? h('div', { style: muted }, 'WebGL 状态：' + (status.supported ? '支持' : '不支持/回退') + '；已挂 ' + status.attached + ' 台；上限 ' + status.cap) : null),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '6px' } },
          h('button', { type: 'button', onClick: save, style: { padding: '6px 16px', fontSize: '13px', borderRadius: '6px', cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)', border: '0.5px solid var(--dsw-alias-border-l3)' } }, '保存'),
          h('button', { type: 'button', onClick: reset, style: { padding: '6px 16px', fontSize: '13px', borderRadius: '6px', cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', background: 'transparent', border: '0.5px solid var(--dsw-alias-border-l3)' } }, '恢复默认'),
          saved ? h('span', { style: muted }, '已保存，立即生效') : null));
    }

    // Nav icon for the settings section (Settings left nav), addressed by the section id.
    function TerminalSettingsIcon(props) {
      var size = (props && props.size) || 18;
      return h('svg', { width: size, height: size, viewBox: '0 0 64 64', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 6, y: 10, width: 52, height: 44, rx: 8, stroke: 'currentColor', strokeWidth: 3 }),
        h('path', { d: 'M16 26l9 7-9 7', stroke: 'currentColor', strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }),
        h('path', { d: 'M30 40h14', stroke: 'currentColor', strokeWidth: 3.5, strokeLinecap: 'round', fill: 'none' }));
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
      var webglAddons = typeof Map === 'function' ? new Map() : null; // terminal -> WebglAddon (live)
      var webglLoading = typeof Set === 'function' ? new Set() : null;
      var webglWarned = false;
      var webglSupported; // undefined = unprobed; true/false after probing webgl2
      var webglRetried = typeof WeakSet === 'function' ? new WeakSet() : null; // terminals already retried after a context loss
      var webglActiveLogged = false;
      var visibilityObserver = null; // IntersectionObserver for visible-only mode
      var observedElements = typeof Set === 'function' ? new Set() : null;
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
        // WebGL context loss. Contexts are capped at WEBGL_MAX and released when a terminal
        // is removed, so opening/closing many terminals keeps working.
        function hasWebgl2() {
          try {
            if (typeof document === 'undefined' || !document.createElement) return false;
            var c = document.createElement('canvas');
            return !!(c.getContext && c.getContext('webgl2'));
          } catch (e) { return false; }
        }

        // WebGL context cap. An explicit maxWebgl wins; empty follows the keep-alive limit
        // (maxOpenTabs) so every kept-mounted terminal can get the GPU renderer; at least 8.
        function webglCap(cfg) {
          try {
            if (cfg && cfg.maxWebgl > 0) return cfg.maxWebgl;
            var mot = cfg && cfg.maxOpenTabs > 0 ? cfg.maxOpenTabs : 0;
            return Math.max(8, mot);
          } catch (e) { return 8; }
        }

        function isElementVisible(term) {
          try {
            var el = term && term.element;
            if (!el) return true; // unknown -> let it try
            if (el.offsetParent === null) return false;
            return el.clientWidth > 0 && el.clientHeight > 0;
          } catch (e) { return true; }
        }

        function observeElement(el) {
          try {
            if (!visibilityObserver || !observedElements) return;
            if (observedElements.has(el)) return;
            observedElements.add(el);
            visibilityObserver.observe(el);
          } catch (e) {}
        }

        // Visible-only policy: when enabled (opt-in), attach WebGL only to the terminal(s)
        // currently on screen and release when they are hidden; when disabled, drop the
        // observer and let the normal scan attach under the cap.
        function syncVisibilityPolicy(cfg) {
          var want = cfg.webgl === true && cfg.webglVisibleOnly === true;
          if (!want) {
            if (visibilityObserver) { try { visibilityObserver.disconnect(); } catch (e) {} visibilityObserver = null; }
            if (observedElements) observedElements.clear();
            return;
          }
          if (!visibilityObserver) {
            if (typeof IntersectionObserver === 'undefined') return; // unsupported -> normal attach
            try {
              visibilityObserver = new IntersectionObserver(function (entries) {
                var c = readConfig();
                for (var e = 0; e < entries.length; e++) {
                  var term = elementToTerm.get(entries[e].target);
                  if (!term) continue;
                  if (entries[e].isIntersecting) maybeWebgl(term, c);
                  else disposeWebglFor(term);
                }
              }, { threshold: 0 });
            } catch (e) { visibilityObserver = null; return; }
          }
          try {
            var nodes = document.querySelectorAll('.xterm');
            for (var i = 0; i < nodes.length; i++) observeElement(nodes[i]);
          } catch (e) {}
        }

        function disposeWebglFor(term) {
          try {
            if (!webglAddons) return;
            if (webglLoading) webglLoading.delete(term);
            var addon = webglAddons.get(term);
            if (addon) {
              try { addon.dispose(); } catch (e) {}
              webglAddons.delete(term);
            }
          } catch (e) {}
        }

        function maybeWebgl(term, cfg) {
          try {
            if (!webglAddons || !webglLoading) return;
            if (cfg.webgl !== true) { disposeWebglFor(term); return; }
            if (webglAddons.has(term) || webglLoading.has(term)) return;
            if (cfg.webglVisibleOnly === true && visibilityObserver && !isElementVisible(term)) return; // visible-only: wait until shown
            if (webglAddons.size + webglLoading.size >= webglCap(cfg)) return; // cap counts attached + in-flight
            if (webglSupported === false) return;
            if (webglSupported === undefined) {
              webglSupported = hasWebgl2();
              if (!webglSupported) { webglWarnOnce('no WebGL2 available'); return; }
            }
            if (typeof require === 'undefined' || !require || typeof require.async !== 'function') return;
            webglLoading.add(term);
            Promise.resolve(require.async('./client.webgl.js')).then(function (mod) {
              webglLoading.delete(term);
              if (cfg.webgl !== true) return; // turned off while loading
              var Addon = mod && mod.WebglAddon;
              if (!Addon) { webglWarnOnce('chunk has no WebglAddon'); return; }
              try {
                var addon = new Addon();
                if (typeof addon.onContextLoss === 'function') {
                  try {
                    addon.onContextLoss(function () {
                      try { addon.dispose(); } catch (e) {}
                      try { webglAddons.delete(term); } catch (e) {}
                      webglWarnOnce('context lost; fell back to DOM');
                      // One restart attempt after a transient GPU reset; if it loses the
                      // context again we stay on DOM (webglRetried guards against a loop).
                      try {
                        if (webglRetried && !webglRetried.has(term)) {
                          webglRetried.add(term);
                          setTimeout(function () { try { maybeWebgl(term, readConfig()); } catch (e) {} }, 1200);
                        }
                      } catch (e) {}
                    });
                  } catch (e) {}
                }
                term.loadAddon(addon);
                webglAddons.set(term, addon);
                if (!webglActiveLogged) { webglActiveLogged = true; try { console.info(LOG, 'WebGL renderer active'); } catch (e) {} }
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
            if (visibilityObserver) observeElement(el);
            tune(term, cfg);
            return true;
          } catch (e) { return false; }
        }

        // Full pass over every terminal element (startup + config change). Cheap:
        // tuneElement caches the instance so repeated passes don't re-walk fibers.
        function scan() {
          var cfg = readConfig();
          try { syncVisibilityPolicy(cfg); } catch (e) {}
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

        // A removed `.xterm` belongs to a closed terminal: release its WebGL context so the
        // cap reflects only live terminals (otherwise we'd stop attaching after N closes).
        function cleanupElement(el) {
          try { var term = elementToTerm.get(el); if (term) disposeWebglFor(term); } catch (e) {}
        }
        function cleanupWithin(node) {
          try {
            if (!node || node.nodeType !== 1) return;
            if (node.classList && node.classList.contains('xterm')) cleanupElement(node);
            var inner = node.querySelectorAll ? node.querySelectorAll('.xterm') : null;
            if (inner) for (var i = 0; i < inner.length; i++) cleanupElement(inner[i]);
          } catch (e) {}
        }

        try {
          observer = new MutationObserver(function (records) {
            var cfg = readConfig();
            for (var r = 0; r < records.length; r++) {
              var added = records[r].addedNodes;
              for (var a = 0; a < added.length; a++) tuneWithin(added[a], cfg);
              var removed = records[r].removedNodes;
              for (var m = 0; m < removed.length; m++) cleanupWithin(removed[m]);
            }
          });
          observer.observe(document.documentElement || document.body || document, { childList: true, subtree: true });
        } catch (e) {
          observer = null;
        }
        // Minimal runtime self-check hook for the console (not a settings-page UI):
        //   __dshTerminalKeepalive.webglStatus()  -> { supported, attached, cap }
        try {
          if (typeof window !== 'undefined') {
            window.__dshTerminalKeepalive = window.__dshTerminalKeepalive || {};
            window.__dshTerminalKeepalive.webglStatus = function () {
              return { supported: webglSupported, attached: webglAddons ? webglAddons.size : 0, cap: webglCap(readConfig()) };
            };
          }
        } catch (e) {}

        scan();
        return {
          refresh: function () { try { scan(); } catch (e) {} },
          dispose: function () {
            try { if (observer) observer.disconnect(); } catch (e) {}
            try { if (visibilityObserver) { visibilityObserver.disconnect(); visibilityObserver = null; } } catch (e) {}
            try { if (webglAddons) { webglAddons.forEach(function (a) { try { a.dispose(); } catch (e) {} }); webglAddons.clear(); } } catch (e) {}
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
          requestReconcile = reconcile;
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

          // Dedicated settings page in the Settings panel: Settings -> 终端常驻.
          try {
            if (ctx.slots && typeof ctx.slots.inject === 'function' && typeof ctx.slots.register === 'function') {
              ctx.effect(function () {
                return ctx.slots.inject('settings.section', function () {
                  return ctx.slots.register({ name: 'settings.section', id: 'dsh-terminal-keepalive', order: 25, label: '终端常驻' }, TerminalSettingsPage);
                });
              });
              ctx.effect(function () {
                return ctx.slots.inject('settings.section.icon', function () {
                  return ctx.slots.register({ name: 'settings.section.icon', id: 'dsh-terminal-keepalive' }, TerminalSettingsIcon);
                });
              });
            }
          } catch (e) {
            try { console.warn(LOG, 'settings section unavailable:', e); } catch (x) {}
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
