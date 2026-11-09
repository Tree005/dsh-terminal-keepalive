// ModuleLoader-simulation unit tests for the client plugin.
// No browser/jsdom needed: we eval client.js with a fake `window`/ModuleLoader,
// a fake `react`, and fake `sidebarRightTabs` / `slots` / `sidebarRight` services.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8');
const CONFIG_KEY = 'dsh-terminal-keepalive.config';

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

let captured = null;
global.window = { __ModuleLoader__: { load: (mod) => { captured = mod; } }, localStorage: makeStorage() };
// eslint-disable-next-line no-eval
eval(SRC);

const fakeReact = { createElement: () => ({}), useState: (v) => [v, () => {}] };
const loadPlugin = (req) => captured.factory(req || ((name) => (name === 'react' ? fakeReact : {})));

function makeRegistry() {
  const defs = new Map();
  const listeners = new Set();
  const notify = () => { for (const f of [...listeners]) f(); };
  return {
    register(def) { defs.set(def.kind, def); notify(); return () => { defs.delete(def.kind); notify(); }; },
    get(kind) { return defs.get(kind); },
    entries() { return [...defs.values()]; },
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
    refresh() { notify(); },
    _defs: defs,
  };
}

function makeSlots() {
  const regs = [];
  return {
    inject(_name, cb) { cb(); return () => {}; },
    register(opts, comp) { regs.push({ opts, comp }); return () => {}; },
    _regs: regs,
  };
}

function makeSidebar(openTabs) {
  const listeners = new Set();
  return {
    openTabs: {
      getSnapshot: () => openTabs.v,
      subscribe: (f) => { listeners.add(f); return () => listeners.delete(f); },
    },
    emit() { for (const f of [...listeners]) f(); },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(opts = {}) {
  window.localStorage = makeStorage();
  if (opts.config !== undefined) {
    window.localStorage.setItem(CONFIG_KEY, typeof opts.config === 'string' ? opts.config : JSON.stringify(opts.config));
  }
  const reg = makeRegistry();
  for (const d of opts.defs || [{ id: 't', kind: 'terminal' }]) reg._defs.set(d.kind, d);
  const slots = makeSlots();
  const openTabs = { v: opts.openTabs || [] };
  const sidebar = opts.noSidebar ? undefined : makeSidebar(openTabs);
  const disposers = [];
  const ctx = {
    sidebarRightTabs: reg,
    slots,
    get: (name) => (name === 'sidebarRight' ? sidebar : undefined),
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); },
  };
  loadPlugin(opts.require).apply(ctx);
  return {
    reg, slots, openTabs, sidebar, ctx,
    dispose() { for (const d of disposers.reverse()) { try { d(); } catch (e) {} } },
  };
}

function terminalTabs(n) {
  return new Array(n).fill(0).map((_, i) => ({ sessionId: 's' + (i % 3), tabId: 't' + i, kind: 'terminal' }));
}

test('default config keeps terminal mounted', () => {
  const env = setup();
  try {
    assert.strictEqual(env.reg.get('terminal').keepMounted, true);
    assert.ok(JSON.parse(window.localStorage.getItem(CONFIG_KEY)));
  } finally { env.dispose(); }
});

test('configured kinds (files/text) are kept mounted too', () => {
  const env = setup({
    config: { kinds: ['terminal', 'files', 'text'], maxOpenTabs: 6 },
    defs: [{ id: 't', kind: 'terminal' }, { id: 'f', kind: 'files' }, { id: 'x', kind: 'text' }],
  });
  try {
    assert.strictEqual(env.reg.get('terminal').keepMounted, true);
    assert.strictEqual(env.reg.get('files').keepMounted, true);
    assert.strictEqual(env.reg.get('text').keepMounted, true);
  } finally { env.dispose(); }
});

test('unconfigured kind is left untouched', () => {
  const browser = { id: 'b', kind: 'browser' };
  const env = setup({ defs: [{ id: 't', kind: 'terminal' }, browser] });
  try {
    assert.strictEqual(env.reg.get('terminal').keepMounted, true);
    assert.ok(!('keepMounted' in browser));
  } finally { env.dispose(); }
});

test('memory gate closes over maxOpenTabs and reopens', async () => {
  const env = setup({ config: { kinds: ['terminal'], maxOpenTabs: 6 }, openTabs: terminalTabs(6) });
  try {
    await tick();
    assert.strictEqual(env.reg.get('terminal').keepMounted, true, '6 tabs keep mounted');
    env.openTabs.v = terminalTabs(7);
    env.sidebar.emit();
    await tick();
    assert.strictEqual(env.reg.get('terminal').keepMounted, false, '7 tabs -> gate closed');
    env.openTabs.v = terminalTabs(6);
    env.sidebar.emit();
    await tick();
    assert.strictEqual(env.reg.get('terminal').keepMounted, true, 'back to 6 -> gate open');
  } finally { env.dispose(); }
});

test('maxOpenTabs: 0 disables the gate', async () => {
  const env = setup({ config: { kinds: ['terminal'], maxOpenTabs: 0 }, openTabs: terminalTabs(50) });
  try {
    await tick();
    assert.strictEqual(env.reg.get('terminal').keepMounted, true);
  } finally { env.dispose(); }
});

test('malformed config falls back to defaults', () => {
  const env = setup({ config: '{not json' });
  try {
    assert.strictEqual(env.reg.get('terminal').keepMounted, true);
  } finally { env.dispose(); }
});

test('missing sidebarRight service leaves gate open (no crash)', () => {
  const env = setup({ noSidebar: true });
  try {
    assert.strictEqual(env.reg.get('terminal').keepMounted, true);
  } finally { env.dispose(); }
});

test('dispose restores original keepMounted', () => {
  const env = setup();
  const def = env.reg.get('terminal');
  assert.strictEqual(def.keepMounted, true);
  env.dispose();
  assert.ok(!('keepMounted' in def));
});

// --- live terminal option tuner (client-side scrollback / smooth scroll) ---

function makeFakeTerminal(initial) {
  const options = Object.assign({ scrollback: 1000, smoothScrollDuration: 0 }, initial || {});
  return { options, _addons: [], write() {}, resize() {}, dispose() {}, element: {}, loadAddon(a) { this._addons.push(a); } };
}

function makeXtermElement(term) {
  // Simulate React's fiber on the host `.screen` div: a hook list whose ref
  // holds the terminal. `findTerminal` walks this to recover the instance.
  const termHook = { memoizedState: { current: term }, next: null };
  const elHook = { memoizedState: { current: {} }, next: termHook };
  const fiber = { memoizedState: elHook, return: null };
  const host = {};
  host['__reactFiber$test'] = fiber;
  return { parentElement: host, className: 'xterm' };
}

function withFakeDocument(elements, fn, opts) {
  const prevDoc = global.document;
  const prevMO = global.MutationObserver;
  const webgl2 = !(opts && opts.noWebgl);
  global.document = {
    documentElement: {},
    body: {},
    querySelectorAll: (sel) => (sel === '.xterm' ? elements : []),
    createElement: () => ({ getContext: (t) => ((t === 'webgl2' && webgl2) ? {} : null) }),
  };
  global.MutationObserver = class { constructor() {} observe() {} disconnect() {} };
  try { return fn(); } finally {
    global.document = prevDoc;
    global.MutationObserver = prevMO;
  }
}

test('tuner applies scrollback + smoothScrollDuration to a running terminal', () => {
  const term = makeFakeTerminal();
  const xtermEl = makeXtermElement(term);
  withFakeDocument([xtermEl], () => {
    const env = setup({ config: { kinds: ['terminal'], scrollback: 300, smoothScrollDuration: 120 } });
    try {
      assert.strictEqual(term.options.scrollback, 300);
      assert.strictEqual(term.options.smoothScrollDuration, 120);
    } finally { env.dispose(); }
  });
});

test('null scrollback leaves the terminal value untouched', () => {
  const term = makeFakeTerminal({ scrollback: 1000 });
  const xtermEl = makeXtermElement(term);
  withFakeDocument([xtermEl], () => {
    const env = setup({ config: { kinds: ['terminal'], scrollback: null, smoothScrollDuration: 0 } });
    try {
      assert.strictEqual(term.options.scrollback, 1000);
    } finally { env.dispose(); }
  });
});

// --- experimental WebGL renderer ---

class FakeWebglAddon {
  constructor() { this.disposed = false; }
  onContextLoss() { return () => {}; }
  dispose() { this.disposed = true; }
}

function requireWithWebgl(result) {
  const req = (name) => (name === 'react' ? fakeReact : {});
  req.async = () => Promise.resolve(result);
  return req;
}

test('webgl defaults off: chunk is not loaded / no addon attached', async () => {
  const term = makeFakeTerminal();
  const xtermEl = makeXtermElement(term);
  let env;
  withFakeDocument([xtermEl], () => { env = setup({ config: { kinds: ['terminal'] } }); });
  await tick();
  try {
    assert.strictEqual(term._addons.length, 0);
  } finally { env.dispose(); }
});

test('webgl on: lazily loads the chunk and calls loadAddon', async () => {
  const term = makeFakeTerminal();
  const xtermEl = makeXtermElement(term);
  let env;
  const req = requireWithWebgl({ WebglAddon: FakeWebglAddon });
  withFakeDocument([xtermEl], () => { env = setup({ config: { kinds: ['terminal'], webgl: true }, require: req }); });
  await tick();
  try {
    assert.strictEqual(term._addons.length, 1);
    assert.ok(term._addons[0] instanceof FakeWebglAddon);
  } finally { env.dispose(); }
});

test('webgl on but chunk load fails: no addon, no throw', async () => {
  const term = makeFakeTerminal();
  const xtermEl = makeXtermElement(term);
  let env;
  const req = (name) => (name === 'react' ? fakeReact : {});
  req.async = () => Promise.reject(new Error('boom'));
  withFakeDocument([xtermEl], () => { env = setup({ config: { kinds: ['terminal'], webgl: true }, require: req }); });
  await tick();
  try {
    assert.strictEqual(term._addons.length, 0);
  } finally { env.dispose(); }
});

test('webgl cap: at most 8 terminals get a context (attached + in-flight)', async () => {
  const terms = [];
  const els = [];
  for (let i = 0; i < 10; i++) { const t = makeFakeTerminal(); terms.push(t); els.push(makeXtermElement(t)); }
  let env;
  const req = requireWithWebgl({ WebglAddon: FakeWebglAddon });
  withFakeDocument(els, () => { env = setup({ config: { kinds: ['terminal'], webgl: true }, require: req }); });
  await tick();
  try {
    const total = terms.reduce((n, t) => n + t._addons.length, 0);
    assert.strictEqual(total, 8);
  } finally { env.dispose(); }
});

test('webgl unsupported (no webgl2): chunk never loaded, stays on DOM', async () => {
  const term = makeFakeTerminal();
  const xtermEl = makeXtermElement(term);
  let env;
  let loaded = false;
  const req = (name) => (name === 'react' ? fakeReact : {});
  req.async = () => { loaded = true; return Promise.resolve({ WebglAddon: FakeWebglAddon }); };
  withFakeDocument([xtermEl], () => { env = setup({ config: { kinds: ['terminal'], webgl: true }, require: req }); }, { noWebgl: true });
  await tick();
  try {
    assert.strictEqual(term._addons.length, 0);
    assert.strictEqual(loaded, false);
  } finally { env.dispose(); }
});

test('webgl cap follows maxOpenTabs when maxWebgl is empty', async () => {
  const terms = [], els = [];
  for (let i = 0; i < 12; i++) { const t = makeFakeTerminal(); terms.push(t); els.push(makeXtermElement(t)); }
  let env;
  const req = requireWithWebgl({ WebglAddon: FakeWebglAddon });
  withFakeDocument(els, () => { env = setup({ config: { kinds: ['terminal'], webgl: true, maxOpenTabs: 12 }, require: req }); });
  await tick();
  try {
    assert.strictEqual(terms.reduce((n, t) => n + t._addons.length, 0), 12);
  } finally { env.dispose(); }
});

test('webgl cap uses explicit maxWebgl when set', async () => {
  const terms = [], els = [];
  for (let i = 0; i < 10; i++) { const t = makeFakeTerminal(); terms.push(t); els.push(makeXtermElement(t)); }
  let env;
  const req = requireWithWebgl({ WebglAddon: FakeWebglAddon });
  withFakeDocument(els, () => { env = setup({ config: { kinds: ['terminal'], webgl: true, maxWebgl: 3 }, require: req }); });
  await tick();
  try {
    assert.strictEqual(terms.reduce((n, t) => n + t._addons.length, 0), 3);
  } finally { env.dispose(); }
});

function installIO() {
  const insts = [];
  const prev = global.IntersectionObserver;
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.targets = []; insts.push(this); }
    observe(el) { this.targets.push(el); }
    unobserve() {}
    disconnect() { this.targets = []; }
  };
  return { insts, restore() { global.IntersectionObserver = prev; } };
}

test('webgl visible-only: hidden stays DOM until visible, released when hidden again', async () => {
  const prevDoc = global.document, prevMO = global.MutationObserver;
  const io = installIO();
  const term = makeFakeTerminal();
  term.element = { offsetParent: null, clientWidth: 0, clientHeight: 0 }; // hidden
  const xtermEl = makeXtermElement(term);
  let env;
  const req = requireWithWebgl({ WebglAddon: FakeWebglAddon });
  global.document = {
    documentElement: {}, body: {},
    querySelectorAll: (sel) => (sel === '.xterm' ? [xtermEl] : []),
    createElement: () => ({ getContext: (t) => (t === 'webgl2' ? {} : null) }),
  };
  global.MutationObserver = class { constructor() {} observe() {} disconnect() {} };
  try {
    env = setup({ config: { kinds: ['terminal'], webgl: true, webglVisibleOnly: true }, require: req });
    await tick();
    assert.strictEqual(term._addons.length, 0, 'hidden: not attached');
    term.element.offsetParent = {}; term.element.clientWidth = 100; term.element.clientHeight = 100;
    io.insts[0].cb([{ target: xtermEl, isIntersecting: true }], io.insts[0]);
    await tick();
    assert.strictEqual(term._addons.length, 1, 'visible: attached');
    assert.strictEqual(term._addons[0].disposed, false);
    io.insts[0].cb([{ target: xtermEl, isIntersecting: false }], io.insts[0]);
    await tick();
    assert.strictEqual(term._addons[0].disposed, true, 'hidden: released to DOM');
  } finally {
    try { if (env) env.dispose(); } catch (e) {}
    io.restore();
    global.document = prevDoc; global.MutationObserver = prevMO;
  }
});

test('webgl visible-only off (default): hidden-size terminal still attaches', async () => {
  const term = makeFakeTerminal();
  term.element = { offsetParent: null, clientWidth: 0, clientHeight: 0 }; // would be "hidden"
  const xtermEl = makeXtermElement(term);
  let env;
  const req = requireWithWebgl({ WebglAddon: FakeWebglAddon });
  withFakeDocument([xtermEl], () => { env = setup({ config: { kinds: ['terminal'], webgl: true }, require: req }); });
  await tick();
  try {
    assert.strictEqual(term._addons.length, 1, 'default: visibility irrelevant, attaches');
  } finally { env.dispose(); }
});

test('registers a dedicated settings page (settings.section) + nav icon', () => {
  const env = setup();
  try {
    const sec = env.slots._regs.find((r) => r.opts.name === 'settings.section');
    assert.ok(sec, 'settings.section registered');
    assert.strictEqual(sec.opts.id, 'dsh-terminal-keepalive');
    assert.strictEqual(typeof sec.comp, 'function');
    const icon = env.slots._regs.find((r) => r.opts.name === 'settings.section.icon');
    assert.ok(icon, 'settings.section.icon registered');
    assert.strictEqual(icon.opts.id, 'dsh-terminal-keepalive');
    assert.strictEqual(typeof icon.comp, 'function');
  } finally { env.dispose(); }
});

// --- readConfig boundary coverage ---
//
// readConfig() is private to the factory closure, so we observe its *raw*
// normalized values through the settings page: TerminalSettingsPage initialises
// its inputs straight from readConfig(), which is the only place the un-clamped
// numbers (e.g. null vs 0) are visible rather than being folded by the tuner's
// `> 0` checks.

function makeRecordingReact() {
  const nodes = [];
  const React = {
    createElement(type, props) {
      const node = { type: type, props: props || {} };
      nodes.push(node);
      return node;
    },
    useState(v) { return [v, () => {}]; },
  };
  return { React: React, nodes: nodes };
}

function readConfigViaSettings(config) {
  const rec = makeRecordingReact();
  const env = setup({ config: config, require: (name) => (name === 'react' ? rec.React : {}) });
  try {
    const sec = env.slots._regs.find((r) => r.opts.name === 'settings.section');
    assert.ok(sec, 'settings.section registered');
    sec.comp();
  } finally {
    env.dispose();
  }
  const inputs = rec.nodes.filter((n) => n.type === 'input');
  const numbers = inputs.filter((n) => n.props.type === 'number');
  const boxes = inputs.filter((n) => n.props.type === 'checkbox');
  return {
    // JSX order: maxOpenTabs, scrollback, smoothScrollDuration, maxWebgl
    maxOpenTabs: numbers[0] && numbers[0].props.value,
    scrollback: numbers[1] && numbers[1].props.value,
    smooth: numbers[2] && numbers[2].props.value,
    maxWebgl: numbers[3] && numbers[3].props.value,
    // JSX order: 4 kind boxes, then webgl, then webglVisibleOnly
    webgl: !!(boxes[4] && boxes[4].props.checked),
    webglVisibleOnly: !!(boxes[5] && boxes[5].props.checked),
    kinds: boxes.slice(0, 4).map((b) => !!b.props.checked),
  };
}

test('readConfig: maxWebgl 0 / negative collapse to null (blank field)', () => {
  assert.strictEqual(readConfigViaSettings({ maxWebgl: 0 }).maxWebgl, '');
  assert.strictEqual(readConfigViaSettings({ maxWebgl: -2 }).maxWebgl, '');
});

test('readConfig: maxWebgl floors legal values and keeps them', () => {
  assert.strictEqual(readConfigViaSettings({ maxWebgl: 3.9 }).maxWebgl, '3');
  assert.strictEqual(readConfigViaSettings({ maxWebgl: 12 }).maxWebgl, '12');
});

test('readConfig: scrollback 0 / negative collapse to null, positive kept', () => {
  assert.strictEqual(readConfigViaSettings({ scrollback: 0 }).scrollback, '');
  assert.strictEqual(readConfigViaSettings({ scrollback: -4 }).scrollback, '');
  assert.strictEqual(readConfigViaSettings({ scrollback: 300 }).scrollback, '300');
});

test('readConfig: negative smoothScrollDuration collapses to 0', () => {
  assert.strictEqual(readConfigViaSettings({ smoothScrollDuration: -30 }).smooth, '0');
  assert.strictEqual(readConfigViaSettings({ smoothScrollDuration: 120 }).smooth, '120');
});

test('readConfig: webgl / webglVisibleOnly only true for boolean true (strings ignored)', () => {
  const s = readConfigViaSettings({ webgl: 'true', webglVisibleOnly: 'true' });
  assert.strictEqual(s.webgl, false);
  assert.strictEqual(s.webglVisibleOnly, false);
  const one = readConfigViaSettings({ webgl: '1', webglVisibleOnly: '1' });
  assert.strictEqual(one.webgl, false);
  assert.strictEqual(one.webglVisibleOnly, false);
  const t = readConfigViaSettings({ webgl: true, webglVisibleOnly: true });
  assert.strictEqual(t.webgl, true);
  assert.strictEqual(t.webglVisibleOnly, true);
});

test('readConfig: empty + malformed JSON fall back to defaults', () => {
  const d = readConfigViaSettings(undefined);
  assert.strictEqual(d.maxOpenTabs, '6');
  assert.strictEqual(d.scrollback, '');
  assert.strictEqual(d.smooth, '0');
  assert.strictEqual(d.maxWebgl, '');
  assert.strictEqual(d.webgl, false);
  assert.strictEqual(d.webglVisibleOnly, false);
  const m = readConfigViaSettings('{not json');
  assert.strictEqual(m.maxOpenTabs, '6');
  assert.strictEqual(m.scrollback, '');
  assert.strictEqual(m.maxWebgl, '');
  assert.strictEqual(m.webgl, false);
});

// --- settings.section registration details ---

test('settings.section registered at order 25 with label; icon shares the id', () => {
  const env = setup();
  try {
    const sec = env.slots._regs.find((r) => r.opts.name === 'settings.section');
    assert.ok(sec, 'settings.section registered');
    assert.strictEqual(sec.opts.id, 'dsh-terminal-keepalive');
    assert.strictEqual(sec.opts.order, 25);
    assert.strictEqual(sec.opts.label, '终端常驻');
    assert.strictEqual(typeof sec.comp, 'function');
    const icon = env.slots._regs.find((r) => r.opts.name === 'settings.section.icon');
    assert.ok(icon, 'settings.section.icon registered');
    assert.strictEqual(icon.opts.id, 'dsh-terminal-keepalive');
    assert.strictEqual(typeof icon.comp, 'function');
  } finally { env.dispose(); }
});

// --- WebGL context cap boundaries (observed through webglStatus().cap) ---

function webglCapOf(config) {
  let cap;
  withFakeDocument([], () => {
    const env = setup({ config: config });
    cap = window.__dshTerminalKeepalive.webglStatus().cap;
    env.dispose();
  });
  return cap;
}

test('webgl context cap = max(maxWebgl, maxOpenTabs, 8) boundaries', () => {
  assert.strictEqual(webglCapOf(undefined), 8, 'defaults: maxOpenTabs 6 -> at least 8');
  assert.strictEqual(webglCapOf({ maxOpenTabs: 5 }), 8, 'below 8 -> 8');
  assert.strictEqual(webglCapOf({ maxOpenTabs: 12 }), 12, 'above 8 follows maxOpenTabs');
  assert.strictEqual(webglCapOf({ maxWebgl: 3 }), 3, 'explicit maxWebgl wins');
  assert.strictEqual(webglCapOf({ maxWebgl: 0 }), 8, 'maxWebgl 0 -> null -> fallback 8');
  assert.strictEqual(webglCapOf({ maxWebgl: -1, maxOpenTabs: 12 }), 12, 'negative -> null -> follow maxOpenTabs');
  assert.strictEqual(webglCapOf({ maxWebgl: 20 }), 20, 'explicit maxWebgl above maxOpenTabs still wins');
});

test('webgl on + webgl2: require.async invoked once and loadAddon called', async () => {
  const term = makeFakeTerminal();
  const xtermEl = makeXtermElement(term);
  let env, asyncCalls = 0;
  const req = (name) => (name === 'react' ? fakeReact : {});
  req.async = (id) => {
    asyncCalls++;
    assert.strictEqual(id, './client.webgl.js');
    return Promise.resolve({ WebglAddon: FakeWebglAddon });
  };
  withFakeDocument([xtermEl], () => { env = setup({ config: { kinds: ['terminal'], webgl: true }, require: req }); });
  await tick();
  try {
    assert.strictEqual(asyncCalls, 1);
    assert.strictEqual(term._addons.length, 1);
    assert.ok(term._addons[0] instanceof FakeWebglAddon);
  } finally { env.dispose(); }
});

test('webgl string "true" is not enabled: chunk never loaded', async () => {
  const term = makeFakeTerminal();
  const xtermEl = makeXtermElement(term);
  let env, loaded = false;
  const req = (name) => (name === 'react' ? fakeReact : {});
  req.async = () => { loaded = true; return Promise.resolve({ WebglAddon: FakeWebglAddon }); };
  withFakeDocument([xtermEl], () => { env = setup({ config: { kinds: ['terminal'], webgl: 'true' }, require: req }); });
  await tick();
  try {
    assert.strictEqual(loaded, false);
    assert.strictEqual(term._addons.length, 0);
  } finally { env.dispose(); }
});

test('webglVisibleOnly string "true" is not enabled: hidden terminal still attaches', async () => {
  const term = makeFakeTerminal();
  term.element = { offsetParent: null, clientWidth: 0, clientHeight: 0 }; // hidden
  const xtermEl = makeXtermElement(term);
  let env;
  const req = requireWithWebgl({ WebglAddon: FakeWebglAddon });
  withFakeDocument([xtermEl], () => {
    env = setup({ config: { kinds: ['terminal'], webgl: true, webglVisibleOnly: 'true' }, require: req });
  });
  await tick();
  try {
    assert.strictEqual(term._addons.length, 1, 'string "true" -> visible-only off -> attaches even hidden');
  } finally { env.dispose(); }
});

// --- memory gate across multiple configured kinds ---

test('memory gate closes/reopens across multiple configured kinds', async () => {
  const tabs = (nTerm, nFiles) => {
    const out = [];
    for (let i = 0; i < nTerm; i++) out.push({ kind: 'terminal', tabId: 't' + i });
    for (let i = 0; i < nFiles; i++) out.push({ kind: 'files', tabId: 'f' + i });
    return out;
  };
  const env = setup({
    config: { kinds: ['terminal', 'files'], maxOpenTabs: 3 },
    defs: [{ id: 't', kind: 'terminal' }, { id: 'f', kind: 'files' }],
    openTabs: tabs(2, 2), // total 4 > 3
  });
  try {
    await tick();
    assert.strictEqual(env.reg.get('terminal').keepMounted, false, 'over threshold -> closed');
    assert.strictEqual(env.reg.get('files').keepMounted, false, 'over threshold -> closed');
    env.openTabs.v = tabs(2, 1); // total 3 <= 3
    env.sidebar.emit();
    await tick();
    assert.strictEqual(env.reg.get('terminal').keepMounted, true, 'back under -> reopened');
    assert.strictEqual(env.reg.get('files').keepMounted, true, 'back under -> reopened');
  } finally { env.dispose(); }
});

// --- dispose restoration when the definition already had keepMounted ---

test('dispose restores a pre-existing keepMounted:false', () => {
  const env = setup({ defs: [{ id: 't', kind: 'terminal', keepMounted: false }] });
  const def = env.reg.get('terminal');
  assert.strictEqual(def.keepMounted, true, 'enabled while applied');
  env.dispose();
  assert.strictEqual(def.keepMounted, false, 'restored to original false');
});

// --- mock contract guard ---

test('makeFakeTerminal keeps loadAddon/_addons contract', () => {
  const t = makeFakeTerminal();
  assert.deepStrictEqual(t._addons, []);
  assert.strictEqual(t.options.scrollback, 1000);
  assert.strictEqual(t.options.smoothScrollDuration, 0);
  const addon = { dispose() {} };
  t.loadAddon(addon);
  assert.strictEqual(t._addons.length, 1);
  assert.strictEqual(t._addons[0], addon);
});

