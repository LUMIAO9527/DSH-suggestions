/** Deterministic component tests with a hook/DOM adapter; no user browser state. */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

function mount(initial = {}) {
  const state = { sessionId: 'own', input: { draft: '', phase: 'plain', attachmentIds: [], queue: [] }, session: { running: false, pendingSubmissions: [] }, turn: 1, suggestion: '把第二部分也核实，列出还没有依据的结论', hold: false,
    anchorBox: { left: 100, top: 200, width: 600, height: 1 }, nativeBox: { left: 114, top: 212, width: 578, height: 24 },
    nativeStyle: { display: 'block', fontFamily: 'Arial', fontSize: '14px', lineHeight: '24px', fontWeight: '400', color: 'rgb(128, 128, 128)', opacity: '1' }, pseudoStyle: { content: 'none' }, ...initial };
  const hooks = [];
  const timers = new Map();
  const frames = new Map();
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
  let now = 1000000;
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
  const placeholder = { textContent: 'Message', getBoundingClientRect: () => state.nativeBox, style: { getPropertyValue: name => styleMap.get(name)?.value || '', getPropertyPriority: name => styleMap.get(name)?.priority || '', setProperty: (name, value, priority) => styleMap.set(name, { value, priority }), removeProperty: name => styleMap.delete(name) } };
  const editor = { isContentEditable: true, contains(node) { return node === editor || node === textNode; }, focus() { document.activeElement = editor; }, get textContent() { return state.input.draft; } };
  const textNode = { parentElement: editor };
  const composer = { parentElement: null, querySelector: selector => selector === '[contenteditable="true"]' ? editor : selector === '[data-composer-placeholder]' ? placeholder : null };
  editor.parentElement = composer;
  const anchor = { parentElement: composer, getBoundingClientRect: () => state.anchorBox };
  // Node's EventTarget does not normalize boolean capture on removal as a
  // browser does. Normalize both operations so old handlers really detach.
  class DOMEventTarget extends EventTarget {
    addEventListener(type, listener, options) { super.addEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options); }
    removeEventListener(type, listener, options) { super.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options); }
  }
  const document = Object.assign(new DOMEventTarget(), { body: {}, activeElement: editor, visibilityState: 'visible' });
  const window = Object.assign(new DOMEventTarget(), { requestAnimationFrame(fn) { const id = ++timerId; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); }, getComputedStyle(node, pseudo) { return node === anchor ? { width: '600px', height: '1px' } : pseudo ? { ...state.nativeStyle, ...state.pseudoStyle } : state.nativeStyle; }, getSelection: () => ({ rangeCount: 1, isCollapsed: true, anchorNode: textNode, anchorOffset: atEnd ? state.input.draft.length : 0, getRangeAt: () => ({ cloneRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => atEnd ? state.input.draft : '' }) }) }), __ModuleLoader__: { load(definition) {
    const plugin = definition.factory(() => React);
    plugin.apply({ slots: { inject(_name, fn) { fn(); }, register(_options, Component) { component = Component; return () => {}; } } });
  } } });
  const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
  const context = vm.createContext({ window, document, Date: class extends Date { static now() { return now; } }, localStorage: storage(), sessionStorage: storage(), AbortController, setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); }, fetch: async (_url, init) => {
    const body = JSON.parse(init.body);
    const request = { body, signal: init.signal };
    requests.push(request);
    if (body.action === 'optimize' || body.manual || state.hold) return new Promise(resolve => { request.respond = payload => resolve({ ok: true, json: async () => payload }); });
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
  async function frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); await flush(); }
  async function key(key, flags = {}) {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key, isComposing: false, keyCode: 0, repeat: false, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...flags });
    window.dispatchEvent(event); await flush(); return event;
  }
  function close() { for (const hook of hooks) hook?.cleanup?.(); timers.clear(); frames.clear(); }
  render();
  return { state, requests, changes, flush, update, tick, frame, key, visible, close, text: () => tree?.children?.[0]?.children?.[0]?.children?.[0], layout: () => tree.children[0]?.props.style, placeholderVisible: () => !styleMap.has('visibility'), setCaretEnd(value) { atEnd = value; }, advance(ms) { now += ms; }, blur() { window.dispatchEvent(new Event('blur')); } };
}

await test('hint follows native placeholder movement, width and skin typography while visible', async () => {
  const h = mount();
  try {
    await h.flush();
    assert.equal(h.layout().left, 14); assert.equal(h.layout().top, 12); assert.equal(h.layout().width, 578);
    h.state.nativeBox = { left: 153, top: 238, width: 220, height: 32 };
    h.state.nativeStyle = { ...h.state.nativeStyle, fontSize: '18px', lineHeight: '32px' };
    await h.frame();
    assert.equal(h.layout().left, 53); assert.equal(h.layout().top, 38); assert.equal(h.layout().width, 220);
    assert.equal(h.layout().fontSize, '18px'); assert.equal(h.layout().lineHeight, '32px');
    assert.equal(h.placeholderVisible(), false);
    await h.frame(); assert.equal(h.placeholderVisible(), false);
    // A scaled card still uses its own CSS pixel coordinates.
    h.state.anchorBox = { left: 100, top: 200, width: 480, height: 0.8 };
    h.state.nativeBox = { left: 142.4, top: 230.4, width: 176, height: 25.6 };
    await h.frame();
    assert.ok(Math.abs(h.layout().left - 53) < 0.01); assert.ok(Math.abs(h.layout().top - 38) < 0.01);
    assert.equal(h.layout().width, 220);
  } finally { h.close(); }
});

await test('zero-sized native text uses the skin pseudo-element font; hidden placeholder is restored', async () => {
  const h = mount({ nativeStyle: { display: 'block', fontSize: '0px', lineHeight: '0px', opacity: '1' }, pseudoStyle: { content: '"Chief"', display: 'block', fontFamily: 'Arial', fontSize: '14px', lineHeight: '24px', color: 'rgb(123, 123, 123)', opacity: '1' } });
  try {
    await h.flush(); assert.equal(h.visible(), true);
    assert.equal(h.layout().fontSize, '14px'); assert.equal(h.layout().lineHeight, '24px');
    h.state.nativeBox = { left: 114, top: 212, width: 0, height: 0 };
    await h.frame(); assert.equal(h.visible(), false); assert.equal(h.placeholderVisible(), true);
    h.state.nativeBox = { left: 124, top: 222, width: 300, height: 24 };
    await h.frame(); assert.equal(h.visible(), true); assert.equal(h.layout().left, 24);
  } finally { h.close(); assert.equal(h.placeholderVisible(), true); }
});

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
    await h.key('Tab', { isComposing: true }); assert.equal(h.changes.length, 0); assert.equal(h.visible(), true);
    await h.key('Tab'); assert.equal(h.changes[0], h.state.suggestion);
    assert.equal(h.visible(), false);
    const before = h.requests.length;
    await h.key('Tab', { repeat: true }); await h.key('Tab', { repeat: true });
    assert.equal(h.requests.length, before);
  } finally { h.close(); }
});

await test('empty composer double Tab or double Right requests a hint without changing the draft', async () => {
  for (const key of ['Tab', 'ArrowRight']) {
    const h = mount({ suggestion: '' });
    try {
      await h.flush(); assert.equal(h.visible(), false);
      const before = h.requests.length;
      const first = await h.key(key);
      assert.equal(first.defaultPrevented, key === 'Tab');
      assert.equal(h.requests.length, before);
      h.advance(200);
      assert.equal((await h.key(key)).defaultPrevented, true);
      const request = h.requests.at(-1);
      assert.equal(request.body.action, 'suggest'); assert.equal(request.body.manual, true);
      assert.equal(request.body.fresh, true); assert.equal(request.body.sessionId, 'own');
      assert.equal(h.changes.length, 0);
      await h.key(key); await h.key(key);
      assert.equal(h.requests.length, before + 1);
      h.state.suggestion = '把第二部分也核实，列出还没有依据的结论';
      request.respond({ ok: true, value: { status: 'ready', turn: 1, suggestions: [h.state.suggestion] } });
      await h.flush(); assert.equal(h.visible(), true);
      assert.equal(h.state.input.draft, '');
      await h.key(key); assert.equal(h.changes[0], h.state.suggestion);
      const count = h.requests.length;
      await h.key(key); await h.key(key);
      assert.equal(h.requests.length, count); // Acceptance is one gesture, not draft optimization.
    } finally { h.close(); }
  }
});

await test('manual generation can restore an escaped hint and regenerate a cleared adopted hint', async () => {
  const h = mount();
  try {
    await h.flush(); await h.key('Escape'); assert.equal(h.visible(), false);
    await h.key('Tab'); await h.key('Tab');
    const first = h.requests.at(-1);
    assert.equal(first.body.manual, true);
    first.respond({ ok: true, value: { status: 'ready', turn: 1, suggestions: [h.state.suggestion] } });
    await h.flush(); assert.equal(h.visible(), true);
    await h.key('Tab');
    await h.update({ input: { ...h.state.input, draft: '' } });
    await h.key('ArrowRight'); await h.key('ArrowRight');
    const next = h.requests.at(-1);
    assert.equal(next.body.manual, true); assert.equal(next.body.afterTurn, undefined);
    next.respond({ ok: true, value: { status: 'ready', turn: 1, suggestions: [h.state.suggestion] } });
    await h.flush(); assert.equal(h.visible(), true);
    await h.tick(); assert.equal(h.visible(), true);
  } finally { h.close(); }
});

await test('a hint arriving between two empty-editor presses does not steal the generation gesture', async () => {
  const h = mount({ hold: true });
  try {
    await h.flush(); await h.key('Tab');
    h.state.hold = false;
    h.requests[0].respond({ ok: true, value: { status: 'ready', turn: 1, suggestions: [h.state.suggestion] } });
    await h.flush(); assert.equal(h.visible(), true);
    await h.key('Tab');
    assert.equal(h.requests.at(-1).body.manual, true);
    assert.equal(h.changes.length, 0);
  } finally { h.close(); }
});

await test('a manual suggestion cannot revive a consumed pre-send turn', async () => {
  const h = mount();
  try {
    await h.flush();
    await h.update({ session: { running: false, pendingSubmissions: [{ requestId: 'sent' }] } });
    await h.update({ session: { running: false, pendingSubmissions: [] } });
    await h.key('Tab'); await h.key('Tab');
    const request = h.requests.at(-1);
    assert.equal(request.body.manual, true); assert.equal(request.body.afterTurn, 1);
    request.respond({ ok: true, value: { status: 'ready', turn: 1, suggestions: [h.state.suggestion] } });
    await h.flush(); assert.equal(h.visible(), false);
  } finally { h.close(); }
});

await test('typing, sending, switching sessions, attachments and Escape cancel manual generation', async () => {
  for (const scenario of ['type', 'send', 'running', 'session', 'attachment', 'escape', 'phase']) {
    const h = mount({ suggestion: '' });
    try {
      await h.flush(); await h.key('Tab'); await h.key('Tab');
      const request = h.requests.at(-1);
      assert.equal(request.body.manual, true);
      if (scenario === 'type') await h.update({ input: { ...h.state.input, draft: '保留我的输入' } });
      if (scenario === 'send') await h.update({ session: { running: false, pendingSubmissions: [{ requestId: 'sent' }] } });
      if (scenario === 'running') await h.update({ session: { running: true, pendingSubmissions: [] } });
      if (scenario === 'session') await h.update({ sessionId: 'other' });
      if (scenario === 'attachment') await h.update({ input: { ...h.state.input, attachmentIds: ['new-file'] } });
      if (scenario === 'escape') await h.key('Escape');
      if (scenario === 'phase') await h.update({ input: { ...h.state.input, phase: 'submitting' } });
      assert.equal(request.signal.aborted, true, scenario);
      request.respond({ ok: true, value: { status: 'ready', turn: 1, suggestions: ['这条过期建议不应显示'] } });
      await h.flush(); assert.equal(h.visible(), false, scenario);
      assert.equal(h.changes.length, 0, scenario);
    } finally { h.close(); }
  }
});

await test('double keys require the same key within 500 ms and the same uninterrupted editor state', async () => {
  const h = mount({ suggestion: '' });
  try {
    await h.flush();
    const count = h.requests.length;
    await h.key('Tab'); await h.key('ArrowRight'); assert.equal(h.requests.length, count);
    h.advance(501); await h.key('ArrowRight'); assert.equal(h.requests.length, count);
    h.blur(); await h.key('ArrowRight'); assert.equal(h.requests.length, count);
    await h.key('ArrowRight', { isComposing: true }); await h.key('ArrowRight'); assert.equal(h.requests.length, count);
    await h.key('ArrowRight', { repeat: true }); await h.key('ArrowRight'); assert.equal(h.requests.length, count);
    await h.key('Tab');
    await h.update({ input: { ...h.state.input, draft: '新草稿' } });
    await h.key('Tab'); assert.equal(h.requests.length, count);
    await h.key('Tab'); assert.equal(h.requests.at(-1).body.action, 'optimize');
  } finally { h.close(); }
});

await test('no-history and busy composers do not insert or send text', async () => {
  const h = mount({ suggestion: '', turn: 0 });
  try {
    await h.flush(); await h.key('Tab'); await h.key('Tab');
    h.requests.at(-1).respond({ ok: true, value: { status: 'none', turn: 0, suggestions: [] } });
    await h.flush(); assert.equal(h.visible(), false); assert.equal(h.changes.length, 0);
    await h.update({ session: { running: true, pendingSubmissions: [] } });
    const count = h.requests.length;
    await h.key('Tab'); await h.key('Tab'); await h.key('ArrowRight'); await h.key('ArrowRight');
    assert.equal(h.requests.length, count);
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

await test('double Down walks forward through offered suggestions and regenerates at the tail', async () => {
  const h = mount();
  try {
    await h.flush();
    assert.equal(h.visible(), true);
    const first = h.state.suggestion;
    assert.equal(h.text(), first);

    const count = h.requests.length;
    await h.key('ArrowDown'); assert.equal(h.requests.length, count); // One press only arms the gesture.
    h.advance(200);
    await h.key('ArrowDown');
    const second = h.requests.at(-1);
    assert.equal(second.body.action, 'suggest'); assert.equal(second.body.manual, true);
    assert.equal(second.body.sessionId, 'own');
    second.respond({ ok: true, value: { status: 'ready', turn: 2, suggestions: ['第二条建议'] } });
    await h.flush();
    assert.equal(h.text(), '第二条建议'); assert.equal(h.visible(), true);
    assert.equal(h.state.input.draft, ''); // Browsing never writes into the composer.

    await h.key('ArrowUp'); h.advance(200); await h.key('ArrowUp');
    assert.equal(h.text(), first);

    const stable = h.requests.length;
    await h.key('ArrowUp'); h.advance(200); await h.key('ArrowUp');
    assert.equal(h.requests.length, stable); assert.equal(h.text(), first);

    await h.key('ArrowDown'); h.advance(200); await h.key('ArrowDown');
    assert.equal(h.text(), '第二条建议');

    // A dismissed hint can still be browsed, and the tail asks for a new one.
    await h.key('Escape'); assert.equal(h.visible(), false);
    await h.key('ArrowDown'); h.advance(200); await h.key('ArrowDown');
    const third = h.requests.at(-1);
    assert.equal(third.body.manual, true);
    third.respond({ ok: true, value: { status: 'ready', turn: 3, suggestions: ['第三条建议'] } });
    await h.flush();
    assert.equal(h.visible(), true); assert.equal(h.text(), '第三条建议');
  } finally { h.close(); }
});

await test('repeat keys, IME composition and a draft never step the candidate list', async () => {
  const h = mount();
  try {
    await h.flush(); assert.equal(h.visible(), true);
    const count = h.requests.length;
    await h.key('ArrowDown', { isComposing: true });
    await h.key('ArrowDown');
    assert.equal(h.requests.length, count);
    h.advance(600);
    await h.key('ArrowDown', { repeat: true });
    await h.key('ArrowDown');
    assert.equal(h.requests.length, count);
    h.advance(600);
    await h.update({ input: { ...h.state.input, draft: '整理报告' } });
    await h.key('ArrowDown'); h.advance(200); await h.key('ArrowDown');
    await h.key('ArrowUp'); h.advance(200); await h.key('ArrowUp');
    assert.equal(h.requests.length, count);
    assert.equal(h.changes.length, 0);
  } finally { h.close(); }
});
