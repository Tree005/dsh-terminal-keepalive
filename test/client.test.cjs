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

test('registers a settings card into plugins.bundle.config keyed by package name', () => {
  const env = setup();
  try {
    const card = env.slots._regs.find((r) => r.opts.name === 'plugins.bundle.config');
    assert.ok(card, 'plugins.bundle.config registered');
    assert.strictEqual(card.opts.key, 'dsh-terminal-keepalive');
    assert.strictEqual(typeof card.comp, 'function');
    const injected = card.opts.inject();
    assert.strictEqual(typeof injected.onConfigChanged, 'function');
  } finally { env.dispose(); }
});

test('saving config applies immediately via onConfigChanged', async () => {
  const env = setup({ defs: [{ id: 't', kind: 'terminal' }] });
  try {
    const card = env.slots._regs.find((r) => r.opts.name === 'plugins.bundle.config');
    const injected = card.opts.inject();
    const files = { id: 'f', kind: 'files' };
    env.reg._defs.set('files', files);
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify({ kinds: ['terminal', 'files'], maxOpenTabs: 6 }));
    injected.onConfigChanged();
    await tick();
    assert.strictEqual(files.keepMounted, true);
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

test('tuner restores the original scrollback when the setting is cleared', () => {
  const term = makeFakeTerminal({ scrollback: 1000 });
  const xtermEl = makeXtermElement(term);
  withFakeDocument([xtermEl], () => {
    const env = setup({ config: { kinds: ['terminal'], scrollback: 300, smoothScrollDuration: 0 } });
    try {
      assert.strictEqual(term.options.scrollback, 300);
      const card = env.slots._regs.find((r) => r.opts.name === 'plugins.bundle.config');
      const injected = card.opts.inject();
      // Clear scrollback (null) and save -> reconcile -> tuner.refresh restores DSH's 1000.
      window.localStorage.setItem(CONFIG_KEY, JSON.stringify({ kinds: ['terminal'], maxOpenTabs: 6, scrollback: null, smoothScrollDuration: 0 }));
      injected.onConfigChanged();
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

