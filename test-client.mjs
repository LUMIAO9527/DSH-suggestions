/** Deterministic component tests with a hook/DOM adapter; no user browser state. */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

function mount(initial = {}) {
  const state = { sessionId: 'own', input: { draft: '', phase: 'plain', attachmentIds: [], queue: [] }, session: { running: false, pendingSubmissions: [] }, turn: 1, suggestion: '把第二部分也核实，列出还没有依据的结论', hold: false, ...initial };
  const hooks = [];
  const timers = new Map();
  const requests = [];
  const changes = [];
  const styleMap = new Map();
  let cursor = 0;
  let dirty = false;
  let effects = [];
  let component;
  let tree;
  let timerId = 0;
  let atEnd = true;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children }; },
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: initial };
      return [hooks[index].value, value => { const next = typeof value === 'function' ? value(hooks[index].value) : value; if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { current: initial }; return hooks[index]; },
    useCallback(fn, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) hooks[index] = { value: fn, deps }; return hooks[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (!same(hooks[index]?.deps, deps)) effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; }); },
  };
  const placeholder = { style: { getPropertyValue: name => styleMap.get(name)?.value || '', getPropertyPriority: name => styleMap.get(name)?.priority || '', setProperty: (name, value, priority) => styleMap.set(name, { value, priority }), removeProperty: name => styleMap.delete(name) } };
  const editor = { isContentEditable: true, contains(node) { return node === editor || node === textNode; }, focus() { document.activeElement = editor; }, get textContent() { return state.input.draft; } };
  const textNode = { parentElement: editor };
  const composer = { parentElement: null, querySelector: selector => selector === '[contenteditable="true"]' ? editor : selector === '[data-composer-placeholder]' ? placeholder : null };
  editor.parentElement = composer;
  const anchor = { parentElement: composer };
  const document = Object.assign(new EventTarget(), { body: {}, activeElement: editor, visibilityState: 'visible' });
  const window = Object.assign(new EventTarget(), { getSelection: () => ({ rangeCount: 1, isCollapsed: true, anchorNode: textNode, anchorOffset: atEnd ? state.input.draft.length : 0, getRangeAt: () => ({ cloneRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => atEnd ? state.input.draft : '' }) }) }), __ModuleLoader__: { load(definition) {
    const plugin = definition.factory(() => React);
    plugin.apply({ slots: { inject(_name, fn) { fn(); }, register(_options, Component) { component = Component; return () => {}; } } });
  } } });
  const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
  const context = vm.createContext({ window, document, localStorage: storage(), sessionStorage: storage(), AbortController, setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); }, fetch: async (_url, init) => {
    const body = JSON.parse(init.body);
    const request = { body, signal: init.signal };
    requests.push(request);
    if (body.action === 'optimize' || state.hold) return new Promise(resolve => { request.respond = payload => resolve({ ok: true, json: async () => payload }); });
    return { ok: true, json: async () => ({ ok: true, value: { status: 'ready', turn: state.turn, suggestions: [state.suggestion] } }) };
  } });
  vm.runInContext(source, context);
  const actions = { setDraft(value) { changes.push(value); state.input = { ...state.input, draft: value }; dirty = true; } };
  function render() {
    cursor = 0; effects = []; dirty = false;
    tree = component({ sessionId: state.sessionId, useInput: selector => selector(state.input), useSession: selector => selector(state.session), inputActions: actions });
    if (tree?.props.ref) tree.props.ref.current = anchor;
    const pending = effects; effects = [];
    pending.forEach(effect => effect());
  }
  async function flush() { for (let i = 0; i < 15; i++) { await Promise.resolve(); if (dirty) render(); } }
  function visible() { return tree?.props['data-dsh-suggestions'] === 'hint'; }
  async function update(values) { Object.assign(state, values); render(); await flush(); }
  async function tick() { const [id, timer] = [...timers.entries()].sort((a, b) => a[1].ms - b[1].ms)[0] || []; if (timer) { timers.delete(id); timer.fn(); } await flush(); }
  async function key(key, flags = {}) {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key, isComposing: false, keyCode: 0, repeat: false, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...flags });
    window.dispatchEvent(event); await flush(); return event;
  }
  function close() { for (const hook of hooks) hook?.cleanup?.(); timers.clear(); }
  render();
  return { state, requests, changes, flush, update, tick, key, visible, close, placeholderVisible: () => !styleMap.has('visibility'), setCaretEnd(value) { atEnd = value; } };
}

await test('plain-phase send hides old hint immediately and only a later turn can show again', async () => {
  const h = mount();
  try {
    await h.flush(); assert.equal(h.visible(), true);
    assert.equal(h.placeholderVisible(), false);
    await h.update({ input: { ...h.state.input, draft: '查第二部分' } });
    await h.update({ input: { ...h.state.input, draft: '' }, session: { running: false, pendingSubmissions: [{ requestId: 'send-1' }] } });
    assert.equal(h.state.input.phase, 'plain');
    assert.equal(h.visible(), false);
    assert.equal(h.placeholderVisible(), true);
    const count = h.requests.length;
    await h.update({ session: { running: true, pendingSubmissions: [] } });
    await h.tick(); assert.equal(h.requests.length, count);
    await h.update({ session: { running: false, pendingSubmissions: [] } });
    await h.tick(); assert.equal(h.visible(), false); // Force a stale ready response.
    assert.equal(h.requests.at(-1).body.afterTurn, 1);
    h.state.turn = 2;
    await h.tick(); assert.equal(h.visible(), true);
  } finally { h.close(); }
});

await test('late pre-send response is dropped even if the old fetch ignores cancellation', async () => {
  const h = mount({ hold: true });
  try {
    await h.flush(); const old = h.requests[0];
    await h.update({ session: { running: false, pendingSubmissions: [{ requestId: 'send-now' }] } });
    assert.equal(old.signal.aborted, true);
    old.respond({ ok: true, value: { status: 'ready', turn: 1, suggestions: ['这条旧建议不应再显示'] } });
    await h.flush(); assert.equal(h.visible(), false);
  } finally { h.close(); }
});

await test('manual draft clearing is not a send; Escape stays dismissed on later polls', async () => {
  const h = mount();
  try {
    await h.flush();
    await h.update({ input: { ...h.state.input, draft: '临时草稿' } });
    await h.update({ input: { ...h.state.input, draft: '' } });
    await h.tick(); assert.equal(h.visible(), true);
    await h.key('Escape'); assert.equal(h.visible(), false);
    await h.tick(); assert.equal(h.visible(), false);
  } finally { h.close(); }
});

await test('Tab adopts one hint into draft and IME/repeat never triggers optimization', async () => {
  const h = mount();
  try {
    await h.flush();
    await h.key('Tab', { isComposing: true }); assert.equal(h.changes.length, 0);
    await h.key('Tab'); assert.equal(h.changes[0], h.state.suggestion);
    assert.equal(h.visible(), false);
    const before = h.requests.length;
    await h.key('Tab', { repeat: true }); await h.key('Tab', { repeat: true });
    assert.equal(h.requests.length, before);
  } finally { h.close(); }
});

await test('editing or switching sessions prevents stale optimized text from overwriting a draft', async () => {
  for (const scenario of ['edit', 'session', 'send']) {
    const h = mount({ input: { draft: '整理报告', phase: 'plain', attachmentIds: [], queue: [] } });
    try {
      await h.key('Tab'); await h.key('Tab');
      assert.equal(h.requests.length, 1);
      const old = h.requests[0];
      if (scenario === 'edit') await h.update({ input: { ...h.state.input, draft: '保留我的新草稿' } });
      if (scenario === 'session') await h.update({ sessionId: 'other' });
      if (scenario === 'send') await h.update({ session: { running: false, pendingSubmissions: [{ requestId: 'submitted' }] } });
      assert.equal(old.signal.aborted, true);
      old.respond({ ok: true, value: { status: 'ready', prompt: '过期的改写' } });
      await h.flush(); assert.equal(h.changes.length, 0);
    } finally { h.close(); }
  }
});

await test('double-right requires both presses at the end, and one request stays in flight', async () => {
  const h = mount({ input: { draft: '整理报告', phase: 'plain', attachmentIds: [], queue: [] } });
  try {
    h.setCaretEnd(false); await h.key('ArrowRight'); await h.key('ArrowRight'); assert.equal(h.requests.length, 0);
    h.setCaretEnd(true); await h.key('ArrowRight'); assert.equal(h.requests.length, 0);
    await h.key('ArrowRight'); assert.equal(h.requests.length, 1);
    await h.key('Tab'); await h.key('Tab'); assert.equal(h.requests.length, 1);
    h.requests[0].respond({ ok: true, value: { status: 'ready', prompt: '请按要求整理这份报告。' } });
    await h.flush(); assert.equal(h.changes[0], '请按要求整理这份报告。');
  } finally { h.close(); }
});
