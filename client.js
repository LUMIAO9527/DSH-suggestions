window.__ModuleLoader__.load({
  id: 'dsh-suggestions',
  factory(require) {
    /* settings-icon:start */
    const SETTINGS_ICON_MASK = 'url("data:image/svg+xml,' + encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" role=\"img\" aria-label=\"DSH-Suggestions\">\r\n  <path d=\"M12.5 4.5H7A3.5 3.5 0 0 0 3.5 8v7A3.5 3.5 0 0 0 7 18.5h1v3l4-3h5A3.5 3.5 0 0 0 20.5 15v-2.5\"/>\r\n  <path d=\"m18 2 1.2 3.8L23 7l-3.8 1.2L18 12l-1.2-3.8L13 7l3.8-1.2ZM7.5 11h3m-3 3.5h7\"/>\r\n</svg>\r\n") + '")';
    function installSettingsIcon(ctx) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || !ctx.effect) return;
      ctx.effect(() => {
        const mark = "dsh-suggestions", label = "DSH-Suggestions";
        const style = document.createElement('style');
        const selector = 'button[data-dsh-plugin-icon="' + mark + '"] svg';
        style.textContent = selector + '{width:16px;height:16px;flex-shrink:0;display:block;background:currentColor;mask:' + SETTINGS_ICON_MASK + ' center/contain no-repeat}' + selector + '>*{visibility:hidden}';
        document.head.appendChild(style);
        const update = () => {
          for (const button of document.querySelectorAll('[role="dialog"][data-shortcut-modal="settings"] nav button')) {
            if (button.textContent.trim() === label) button.setAttribute('data-dsh-plugin-icon', mark);
          }
        };
        const observer = new MutationObserver(update);
        observer.observe(document.body, { childList: true, subtree: true }); update();
        return () => { observer.disconnect(); style.remove(); for (const item of document.querySelectorAll('[data-dsh-plugin-icon="' + mark + '"]')) item.removeAttribute('data-dsh-plugin-icon'); };
      }, 'plugin settings glyph');
    }
    /* settings-icon:end */
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useLayoutEffect, useRef, useState } = React;
    const ENDPOINT = 'api/dsh-suggestions';
    const POLL_MS = 2500;
    const MAX_BACKOFF_MS = 15000;
    const HINT_USES_KEY = 'dsh-suggestions.hint-uses.v2';
    const MAX_CANDIDATES = 10;

    function hintUses(key) {
      try {
        const seenKey = 'dsh-suggestions.shown:' + key;
        let uses = Number(localStorage.getItem(HINT_USES_KEY) || '0') || 0;
        if (sessionStorage.getItem(seenKey) !== '1') {
          uses++;
          sessionStorage.setItem(seenKey, '1');
          localStorage.setItem(HINT_USES_KEY, String(uses));
        }
        return uses;
      } catch { return 4; }
    }

    function composerEditor(anchor) {
      const card = anchor?.closest?.('[data-composer-card]');
      if (card) return card.querySelector('[data-composer-input][contenteditable="true"]') || card.querySelector('[contenteditable="true"]');
      let parent = anchor && anchor.parentElement;
      for (let i = 0; parent && i < 7 && parent !== document.body; i++, parent = parent.parentElement) {
        const editor = parent.querySelector('[contenteditable="true"]');
        if (editor) return editor;
      }
      return null;
    }

    function composerPlaceholder(editor) {
      const card = editor?.closest?.('[data-composer-card]');
      let parent = editor?.parentElement;
      for (let i = 0; parent && parent !== document.body && i < 7; i++, parent = parent.parentElement) {
        const placeholder = parent.querySelector('[data-composer-placeholder]');
        if (placeholder) return placeholder;
        if (parent === card) break;
      }
      return null;
    }

    function placeholderLayout(anchor, placeholder) {
      if (!anchor || !placeholder) return null;
      const native = window.getComputedStyle(placeholder);
      const box = placeholder.getBoundingClientRect();
      const origin = anchor.getBoundingClientRect();
      if (native.display === 'none' || box.width <= 0 || box.height <= 0 || origin.width <= 0 || origin.height <= 0) return null;
      const anchorStyle = window.getComputedStyle(anchor);
      const scaleX = origin.width / parseFloat(anchorStyle.width);
      const scaleY = origin.height / parseFloat(anchorStyle.height);
      if (!(scaleX > 0 && scaleY > 0)) return null;
      const px = value => parseFloat(value) || 0;
      let textStyle = native;
      // Composer skins can replace zero-sized native text with ::before/::after.
      if (px(native.fontSize) === 0 || !placeholder.textContent?.trim()) {
        for (const pseudo of ['::before', '::after']) {
          const style = window.getComputedStyle(placeholder, pseudo);
          if (style.content && !['none', 'normal', '""', "''"].includes(style.content) && style.display !== 'none' && px(style.fontSize) > 0) { textStyle = style; break; }
        }
      }
      if (px(textStyle.fontSize) <= 0) return null;
      const leftInset = px(native.borderLeftWidth) + px(native.paddingLeft);
      const rightInset = px(native.borderRightWidth) + px(native.paddingRight);
      const topInset = px(native.borderTopWidth) + px(native.paddingTop);
      const layout = {
        left: (box.left - origin.left) / scaleX + leftInset,
        top: (box.top - origin.top) / scaleY + topInset,
        width: Math.max(0, box.width / scaleX - leftInset - rightInset),
      };
      if (textStyle !== native) {
        layout.left += px(textStyle.marginLeft) + px(textStyle.borderLeftWidth) + px(textStyle.paddingLeft);
        layout.top += px(textStyle.marginTop) + px(textStyle.borderTopWidth) + px(textStyle.paddingTop);
        layout.width = Math.max(0, layout.width - px(textStyle.marginLeft) - px(textStyle.marginRight) - px(textStyle.borderLeftWidth) - px(textStyle.borderRightWidth) - px(textStyle.paddingLeft) - px(textStyle.paddingRight));
      }
      for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant', 'fontFeatureSettings', 'fontVariationSettings', 'fontKerning', 'fontOpticalSizing', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textIndent', 'textTransform', 'direction', 'color']) layout[property] = textStyle[property];
      layout.opacity = String((Number(native.opacity) || 0) * (textStyle === native ? 1 : Number(textStyle.opacity) || 0));
      return layout.width > 0 ? layout : null;
    }

    function caretAtEnd(editor) {
      try {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || !selection.isCollapsed || !editor.contains(selection.anchorNode)) return false;
        const range = selection.getRangeAt(0).cloneRange();
        range.selectNodeContents(editor);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        return range.toString().length >= (editor.textContent || '').length;
      } catch { return false; }
    }

    function keycap(label) {
      return h('span', { 'aria-hidden': true, className: 'sug-keycap' }, label);
    }

    const DEFAULT_KEYS = {
      accept: { keys: ['Tab', 'ArrowRight'], presses: 1 },
      generate: { keys: ['Tab', 'ArrowRight'], presses: 2 },
      optimize: { keys: ['Tab', 'ArrowRight'], presses: 2 },
      next: { keys: ['Alt+ArrowDown'], presses: 1 },
      prev: { keys: ['Alt+ArrowUp'], presses: 1 },
    };
    function normalizeKeys(input = {}) {
      const out = {};
      for (const name of Object.keys(DEFAULT_KEYS)) {
        const value = input?.[name] ?? (['accept', 'generate', 'optimize'].includes(name) ? input?.composer : undefined);
        const structured = value && typeof value === 'object' && !Array.isArray(value);
        const bindings = structured ? value.keys : value;
        const raw = typeof bindings === 'string' ? [bindings] : Array.isArray(bindings) ? bindings : [];
        const keys = [...new Set(raw.filter(key => typeof key === 'string' && key))].slice(0, 3);
        const legacyPaging = !structured && keys.length && ['next', 'prev'].includes(name);
        out[name] = {
          keys: keys.length ? keys : [...DEFAULT_KEYS[name].keys],
          presses: structured && [1, 2].includes(value.presses) ? value.presses
            : legacyPaging ? (keys[0].includes('+') ? 1 : 2) : DEFAULT_KEYS[name].presses,
        };
      }
      return out;
    }
    function keyConflict(keys) {
      return [['next', 'prev'], ['next', 'accept'], ['next', 'generate'], ['prev', 'accept'], ['prev', 'generate']]
        .some(([a, b]) => keys[a].keys.some(key => keys[b].keys.includes(key)));
    }
    // Same shape the host stores: an optional explicit route plus effort.
    function normalizeModel(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
      const provider = typeof input.provider === 'string' ? input.provider.trim() : '';
      const model = typeof input.model === 'string' ? input.model.trim() : '';
      if (!provider || !model) return null;
      const effort = typeof input.reasoningEffort === 'string' ? input.reasoningEffort.trim() : '';
      return { provider, model, ...(effort ? { reasoningEffort: effort } : {}) };
    }
    const KEYS_EVENT = 'dsh-suggestions:keys';
    const KEY_LABELS = { Tab: 'Tab', ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', AltLeft: '左 Alt', AltRight: '右 Alt', Escape: 'Esc', Enter: 'Enter', Space: 'Space', Backspace: 'Backspace' };
    const keyLabel = binding => String(binding || '').split('+').map(code => KEY_LABELS[code] || code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ')).join('＋');
    const isChinese = language => /^zh/i.test(language || (typeof navigator !== 'undefined' ? navigator.language : ''));
    const gestureLabel = (gesture, zh = isChinese()) => (gesture.presses === 2 ? (zh ? '双击 ' : 'Double press ') : '') + gesture.keys.map(keyLabel).join(' / ');
    function keyCode(event) {
      if (event.code && event.code !== 'Unidentified') return event.code;
      if (event.key === 'AltGraph') return 'AltRight';
      if (event.key === 'Alt') return event.location === 2 ? 'AltRight' : 'AltLeft';
      return ['Tab', 'Escape', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key) ? event.key : '';
    }
    function keyBinding(event) {
      const code = keyCode(event);
      if (!code) return '';
      const modifiers = [['ctrlKey', 'Control'], ['altKey', 'Alt'], ['shiftKey', 'Shift'], ['metaKey', 'Meta']]
        .filter(([flag, name]) => event[flag] && !code.startsWith(name)).map(([, name]) => name);
      return [...modifiers, code].join('+');
    }
    const RECORDABLE_CODE = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma)|Arrow(?:Right|Left|Up|Down)|Alt(?:Left|Right)|Tab|Enter|Escape|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/;
    const normalizeCandidate = text => text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

    class CandidateDeck {
      constructor() { this.reset(); }
      reset(sessionId = '', turn = 0, revision = 0) { this.sessionId = sessionId; this.turn = turn; this.revision = revision; this.items = []; this.index = -1; }
      bind(sessionId, turn, revision) {
        if (this.sessionId !== sessionId || this.turn !== turn || this.revision !== revision) this.reset(sessionId, turn, revision);
      }
      get scope() { return `${this.sessionId}#${this.turn}#${this.revision}`; }
      get current() { return this.items[this.index]; }
      add(text) {
        if (this.items.some(item => normalizeCandidate(item) === normalizeCandidate(text))) return false;
        this.items.push(text);
        if (this.items.length > MAX_CANDIDATES) this.items.shift();
        this.index = this.items.length - 1;
        return true;
      }
      select(index) { if (index < 0 || index >= this.items.length) return undefined; this.index = index; return this.current; }
    }

    function SuggestionHint({ sessionId, useInput, useSession, inputActions }) {
      const input = useInput(state => state);
      const session = useSession(state => state);
      const runningTurn = Boolean(session?.running);
      const pendingSubmissionKey = (session?.pendingSubmissions || []).map(item => item.requestId).join('|');
      const sending = pendingSubmissionKey !== '';
      const draft = typeof input?.draft === 'string' ? input.draft : '';
      const phase = input?.phase;
      const empty = draft === '' && !(input?.attachmentIds?.length) && !(input?.queue?.length);
      const idle = phase === undefined || phase === 'plain';
      const [hint, setHint] = useState(null);
      const [dismissedKey, setDismissedKey] = useState('');
      const [showChip, setShowChip] = useState(false);
      const [layout, setLayout] = useState(null);
      const [generating, setGenerating] = useState(false);
      const [feedback, setFeedback] = useState(null);
      const anchorRef = useRef(null);
      const consumedTurnRef = useRef(0);
      const sentTurnRef = useRef(0);
      const lastTurnRef = useRef(0);
      const lastEmptyAtRef = useRef(0);
      const previousDraftRef = useRef(draft);
      const keyRef = useRef({});
      const generationRef = useRef(null);
      const optimizationRef = useRef(null);
      const deckRef = useRef(null);
      if (!deckRef.current) deckRef.current = new CandidateDeck();
      const shownRef = useRef('');
      const browsePressRef = useRef('');
      const adoptedRef = useRef(null);
      const activeRef = useRef(null);
      activeRef.current = { sessionId, draft, empty, idle, runningTurn, sending };
      const hintKey = hint ? `${hint.sessionId}#${hint.turn}#${hint.revision || 0}` : '';
      const visible = Boolean(hint?.text) && hint.sessionId === sessionId && empty && idle && !runningTurn && !sending && dismissedKey !== hintKey;
      const shouldPoll = Boolean(sessionId) && empty && idle && !runningTurn && !sending && !generating && !feedback;
      // A manual request clears the hint, so the composer would otherwise look
      // idle for up to 40 seconds. The placeholder doubles as a status line.
      const generatingLabel = (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')) ? '正在生成建议…' : 'Generating a suggestion…';
      const notices = isChinese() ? {
        none: '当前会话暂无合适建议', more: '没有新的合适建议', history: '开始对话后可生成建议', running: '回答完成后可生成建议',
        error: '建议生成失败，请重试', timeout: '建议生成超时，请重试', first: '没有更早的建议',
      } : {
        none: 'No suitable suggestion for this conversation', more: 'No new suitable suggestion', history: 'Start a conversation to get suggestions', running: 'Wait for the answer to finish',
        error: 'Could not generate a suggestion. Try again', timeout: 'Suggestion request timed out. Try again', first: 'No earlier suggestion',
      };
      const showing = visible || ((generating || feedback) && empty && idle && !runningTurn && !sending);
      useEffect(() => {
        if (!feedback) return undefined;
        const timer = setTimeout(() => {
          setFeedback(null);
          const deck = deckRef.current, active = activeRef.current;
          if (deck.current && deck.sessionId === active.sessionId && active.empty && active.idle && !active.sending && !active.runningTurn) {
            shownRef.current = deck.current; setDismissedKey('');
            setHint({ sessionId: deck.sessionId, turn: deck.turn, revision: deck.revision, text: deck.current });
          }
        }, 3500);
        return () => clearTimeout(timer);
      }, [feedback]);

      const keysRef = useRef(DEFAULT_KEYS);
      const [keys, setKeys] = useState(DEFAULT_KEYS);

      // The settings card writes through the host route; the composer reads the
      // same keys, so a saved change applies without a reload.
      useEffect(() => {
        let cancelled = false, updated = false;
        fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'config' }) })
          .then(response => response.ok ? response.json() : null)
          .then(payload => { if (!cancelled && !updated && payload?.ok && payload.value?.keys) { const next = normalizeKeys(payload.value.keys); if (JSON.stringify(keysRef.current) !== JSON.stringify(next)) keyRef.current = {}; keysRef.current = next; setKeys(next); } })
          .catch(() => {});
        const onKeys = event => { if (event?.detail) { updated = true; const next = normalizeKeys(event.detail); keyRef.current = {}; browsePressRef.current = ''; keysRef.current = next; setKeys(next); } };
        window.addEventListener(KEYS_EVENT, onKeys);
        return () => { cancelled = true; window.removeEventListener(KEYS_EVENT, onKeys); };
      }, []);

      const clearHint = useCallback(() => {
        shownRef.current = '';
        setHint(null);
      }, []);

      // Deleting an adopted suggestion brings that same candidate back without
      // another model call, and the browsing cursor stays where it was.
      const restoreAdopted = useCallback(() => {
        const adopted = adoptedRef.current;
        if (!adopted) return;
        const deck = deckRef.current;
        if (adopted.scope !== deck.scope) return;
        const index = deck.items.indexOf(adopted.text);
        if (index < 0) return;
        deck.select(index);
        shownRef.current = adopted.text;
        setDismissedKey('');
        setHint({ sessionId: deck.sessionId, turn: deck.turn, revision: deck.revision, text: adopted.text });
      }, []);

      useEffect(() => {
        consumedTurnRef.current = 0;
        sentTurnRef.current = 0;
        lastTurnRef.current = 0;
        lastEmptyAtRef.current = 0;
        previousDraftRef.current = draft;
        keyRef.current = {};
        deckRef.current.reset(sessionId);
        adoptedRef.current = null;
        setGenerating(false);
        setFeedback(null);
        browsePressRef.current = '';
        clearHint();
        setDismissedKey('');
        setShowChip(false);
        return () => {
          generationRef.current?.controller.abort();
          generationRef.current = null;
          optimizationRef.current?.controller.abort();
          optimizationRef.current = null;
        };
      }, [sessionId, clearHint]);

      // Ordinary DSH sends deliberately keep phase="plain". The synchronous
      // local submission echo, not phase or an empty draft, marks a real send.
      useEffect(() => {
        if (!sending && !runningTurn) return;
        consumedTurnRef.current = Math.max(consumedTurnRef.current, lastTurnRef.current);
        sentTurnRef.current = Math.max(sentTurnRef.current, consumedTurnRef.current);
        lastEmptyAtRef.current = Date.now();
        deckRef.current.reset(sessionId);
        adoptedRef.current = null;
        clearHint();
        optimizationRef.current?.controller.abort();
        optimizationRef.current = null;
        generationRef.current?.controller.abort();
        generationRef.current = null;
        setGenerating(false);
        setFeedback(null);
        keyRef.current = {};
        browsePressRef.current = '';
      }, [sessionId, pendingSubmissionKey, runningTurn, clearHint]);

      useEffect(() => {
        const previousDraft = previousDraftRef.current;
        if (previousDraft !== draft && (keyRef.current.mode !== 'accepted' || keyRef.current.draft !== draft)) keyRef.current = {};
        if (previousDraft.trim() && !draft.trim()) lastEmptyAtRef.current = Date.now();
        previousDraftRef.current = draft;
        if (draft.trim() || !idle) clearHint();
        else if (previousDraft.trim() && adoptedRef.current && previousDraft === adoptedRef.current.text) restoreAdopted();
        if (phase === 'submitting' || phase === 'adjudicating') {
          consumedTurnRef.current = Math.max(consumedTurnRef.current, lastTurnRef.current);
          sentTurnRef.current = Math.max(sentTurnRef.current, consumedTurnRef.current);
          lastEmptyAtRef.current = Date.now();
        }
        const pending = optimizationRef.current;
        if (pending && (pending.sessionId !== sessionId || pending.draft !== draft || !idle)) {
          pending.controller.abort();
          optimizationRef.current = null;
        }
      }, [draft, idle, phase, sessionId, clearHint, restoreAdopted]);

      useEffect(() => { if (!empty || !idle) setFeedback(null); }, [empty, idle]);

      useEffect(() => {
        const pending = generationRef.current;
        if (pending && (pending.sessionId !== sessionId || !empty || !idle)) {
          pending.controller.abort();
          generationRef.current = null;
          setGenerating(false);
        }
      }, [sessionId, empty, idle]);

      useEffect(() => {
        if (!shouldPoll) return undefined;
        let cancelled = false;
        let timer;
        let running = false;
        let controller;
        let backoff = POLL_MS;
        const schedule = delay => {
          clearTimeout(timer);
          if (!cancelled && document.visibilityState !== 'hidden') timer = setTimeout(poll, delay);
        };
        const poll = async () => {
          if (cancelled || running || document.visibilityState === 'hidden') return;
          running = true;
          controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 40000);
          try {
            const response = await fetch(ENDPOINT, {
              method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
              body: JSON.stringify({ sessionId, afterTurn: consumedTurnRef.current || undefined, fresh: Date.now() - lastEmptyAtRef.current < 20000 }),
            });
            if (!response.ok) throw new Error('suggestion request failed');
            const payload = await response.json();
            if (cancelled || activeRef.current.sessionId !== sessionId || !activeRef.current.empty || !activeRef.current.idle || activeRef.current.sending || activeRef.current.runningTurn) return;
            const value = payload?.ok ? payload.value : undefined;
            const turn = Number(value?.turn) || 0;
            const revision = Number(value?.revision) || 0;
            const deck = deckRef.current;
            const changedTurn = deck.turn > 0 && (turn !== deck.turn || revision !== deck.revision);
            if (changedTurn) { deck.reset(sessionId, turn, revision); adoptedRef.current = null; clearHint(); }
            lastTurnRef.current = Math.max(lastTurnRef.current, turn);
            if (value?.status === 'running') {
              consumedTurnRef.current = Math.max(consumedTurnRef.current, lastTurnRef.current);
              sentTurnRef.current = Math.max(sentTurnRef.current, consumedTurnRef.current);
              deckRef.current.reset(sessionId); adoptedRef.current = null;
              clearHint();
              schedule(3500);
            } else if (value?.status === 'ready' && typeof value.suggestions?.[0] === 'string' && turn > consumedTurnRef.current) {
              const text = value.suggestions[0].trim();
              lastTurnRef.current = turn;
              // Polling supplies the suggestion of a turn; it must never move the
              // cursor while a candidate is already on screen.
              if (!text) clearHint();
              else if (!shownRef.current) present(text, turn, revision);
              backoff = POLL_MS;
              schedule(5000); // Also notice turns sent from another window.
            } else {
              // A consumed-turn response is expected after adopting and then
              // clearing a draft. It must not erase a locally restored candidate.
              if (changedTurn || turn <= sentTurnRef.current || !shownRef.current) clearHint();
              backoff = Math.min(Math.round(backoff * 1.4), MAX_BACKOFF_MS);
              schedule(value?.status === 'error' ? Math.max(5000, backoff) : backoff);
            }
          } catch {
            if (!cancelled) { backoff = Math.min(backoff * 2, MAX_BACKOFF_MS); schedule(backoff); }
          } finally { clearTimeout(timeout); running = false; }
        };
        const onVisibility = () => {
          clearTimeout(timer);
          if (document.visibilityState === 'visible') poll();
        };
        document.addEventListener('visibilitychange', onVisibility);
        const sinceEmpty = Date.now() - lastEmptyAtRef.current;
        if (sinceEmpty < 1200) schedule(1200 - sinceEmpty); else poll();
        return () => { cancelled = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', onVisibility); };
      }, [sessionId, shouldPoll]);

      // The suggestion shares the composer's coordinate space. Measure its
      // placeholder when the layout changes, then let both move together.
      useLayoutEffect(() => {
        if (!showing) { setLayout(null); return undefined; }
        const anchor = anchorRef.current;
        const card = anchor?.closest?.('[data-composer-card]') ?? anchor?.parentElement;
        let frame;
        let placeholder;
        let oldVisibility = '';
        let oldPriority = '';
        let previous = '';
        const restore = () => {
          if (placeholder?.style.getPropertyValue('visibility') === 'hidden' && placeholder.style.getPropertyPriority('visibility') === 'important') {
            if (oldVisibility) placeholder.style.setProperty('visibility', oldVisibility, oldPriority);
            else placeholder.style.removeProperty('visibility');
          }
        };
        const update = () => {
          frame = undefined;
          const next = composerPlaceholder(composerEditor(anchor));
          if (next !== placeholder) {
            restore();
            if (placeholder) resize?.unobserve(placeholder);
            placeholder = next;
            oldVisibility = placeholder?.style.getPropertyValue('visibility') || '';
            oldPriority = placeholder?.style.getPropertyPriority('visibility') || '';
            if (placeholder) resize?.observe(placeholder);
          }
          const measured = placeholderLayout(anchor, placeholder);
          if (measured) {
            if (placeholder.style.getPropertyValue('visibility') !== 'hidden' || placeholder.style.getPropertyPriority('visibility') !== 'important') placeholder.style.setProperty('visibility', 'hidden', 'important');
          } else restore();
          const key = JSON.stringify(measured);
          if (key !== previous) { previous = key; setLayout(measured); }
        };
        const schedule = () => {
          if (frame === undefined) frame = window.requestAnimationFrame(update);
        };
        const resize = window.ResizeObserver ? new window.ResizeObserver(schedule) : null;
        const mutations = window.MutationObserver ? new window.MutationObserver(schedule) : null;
        if (card) {
          resize?.observe(card);
          mutations?.observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
          card.addEventListener?.('transitionend', schedule);
        }
        if (document.documentElement) mutations?.observe(document.documentElement, {
          attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme'],
        });
        window.addEventListener('resize', schedule);
        update();
        return () => {
          if (frame !== undefined) window.cancelAnimationFrame(frame);
          resize?.disconnect();
          mutations?.disconnect();
          card?.removeEventListener?.('transitionend', schedule);
          window.removeEventListener('resize', schedule);
          restore();
        };
      }, [showing, sessionId]);

      const present = useCallback((text, turn, revision = 0, newOnly = false) => {
        const trimmed = typeof text === 'string' ? text.trim() : '';
        if (!trimmed) return false;
        const deck = deckRef.current;
        deck.bind(activeRef.current.sessionId, turn, revision);
        if (!deck.add(trimmed)) {
          if (newOnly) return false;
          deck.select(deck.items.findIndex(item => normalizeCandidate(item) === normalizeCandidate(trimmed)));
        }
        shownRef.current = trimmed;
        setFeedback(null);
        setHint({ sessionId: deck.sessionId, turn, revision, text: trimmed });
        setShowChip(hintUses(`${activeRef.current.sessionId}#${turn}`) <= 3);
        return true;
      }, []);

      const accept = useCallback(() => {
        const active = activeRef.current;
        if (!visible || !hint || active.sessionId !== sessionId || !active.empty || !active.idle || active.sending || active.runningTurn) return;
        const editor = composerEditor(anchorRef.current);
        keyRef.current = { mode: 'accepted', at: Date.now(), draft: hint.text };
        inputActions.setDraft(hint.text);
        consumedTurnRef.current = Math.max(consumedTurnRef.current, hint.turn);
        adoptedRef.current = { text: hint.text, scope: deckRef.current.scope };
        clearHint();
        editor?.focus();
      }, [visible, hint, sessionId, inputActions, clearHint]);

      const generate = useCallback(async () => {
        const state = activeRef.current;
        if (!state.sessionId || !state.empty || !state.idle || state.sending || state.runningTurn || generationRef.current) return;
        const deck = deckRef.current;
        const pending = { sessionId: state.sessionId, controller: new AbortController(), previousSuggestions: [...deck.items], candidateTurn: deck.turn, candidateRevision: deck.revision };
        generationRef.current = pending;
        setGenerating(true);
        setFeedback(null);
        clearHint();
        const timeout = setTimeout(() => pending.controller.abort(), 40000);
        try {
          const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: pending.controller.signal, body: JSON.stringify({ sessionId: pending.sessionId, action: 'suggest', manual: true, fresh: true, afterTurn: sentTurnRef.current || undefined, previousSuggestions: pending.previousSuggestions, candidateTurn: pending.candidateTurn, candidateRevision: pending.candidateRevision }) });
          if (!response.ok) throw new Error('suggestion request failed');
          const payload = await response.json();
          if (!payload?.ok) throw new Error('suggestion request failed');
          const result = payload?.ok ? payload.value : undefined;
          const current = activeRef.current;
          if (pending.controller.signal.aborted || generationRef.current !== pending || current.sessionId !== pending.sessionId || !current.empty || !current.idle || current.sending || current.runningTurn) return;
          const turn = Number(result?.turn) || 0;
          const revision = Number(result?.revision) || 0;
          const deck = deckRef.current;
          if (Number.isFinite(result?.turn) && (turn !== deck.turn || revision !== deck.revision)) { deck.reset(pending.sessionId, turn, revision); adoptedRef.current = null; }
          lastTurnRef.current = Math.max(lastTurnRef.current, turn);
          if (result?.status === 'running') {
            consumedTurnRef.current = Math.max(consumedTurnRef.current, turn);
            sentTurnRef.current = Math.max(sentTurnRef.current, turn);
            deck.reset(pending.sessionId); adoptedRef.current = null;
            setFeedback({ text: notices.running });
          } else if (result?.status === 'ready' && turn > sentTurnRef.current && typeof result.suggestions?.[0] === 'string' && result.suggestions[0].trim()) {
            consumedTurnRef.current = sentTurnRef.current;
            setDismissedKey('');
            if (!present(result.suggestions[0], turn, revision, true)) setFeedback({ text: notices.more });
          } else setFeedback({ text: result?.status === 'error' ? notices.error : result?.reason === 'no-history' || turn === 0 ? notices.history : pending.previousSuggestions.length ? notices.more : notices.none });
        } catch {
          const current = activeRef.current;
          if (generationRef.current === pending && current.sessionId === pending.sessionId && current.empty && current.idle && !current.sending && !current.runningTurn) setFeedback({ text: pending.controller.signal.aborted ? notices.timeout : notices.error });
        }
        finally {
          clearTimeout(timeout);
          if (generationRef.current === pending) { generationRef.current = null; setGenerating(false); }
        }
      }, [present, clearHint, notices.none, notices.more, notices.history, notices.running, notices.error, notices.timeout]);

      const step = useCallback(direction => {
        const active = activeRef.current;
        if (!active.empty || !active.idle || active.sending || active.runningTurn) return;
        const deck = deckRef.current;
        const text = deck.select(deck.index + direction);
        if (!text) { if (direction > 0) generate(); return; }
        generationRef.current?.controller.abort(); generationRef.current = null; setGenerating(false);
        shownRef.current = text; setFeedback(null); setDismissedKey('');
        setHint({ sessionId: deck.sessionId, turn: deck.turn, revision: deck.revision, text });
      }, [generate]);

      const optimize = useCallback(async () => {
        const state = activeRef.current;
        if (!state.draft.trim() || !state.idle || !state.sessionId || state.sending || optimizationRef.current) return;
        const pending = { sessionId: state.sessionId, draft: state.draft, controller: new AbortController() };
        optimizationRef.current = pending;
        const timeout = setTimeout(() => pending.controller.abort(), 40000);
        try {
          const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: pending.controller.signal, body: JSON.stringify({ sessionId: pending.sessionId, action: 'optimize', draft: pending.draft }) });
          if (!response.ok) return;
          const payload = await response.json();
          const result = payload?.ok ? payload.value : undefined;
          const current = activeRef.current;
          if (!pending.controller.signal.aborted && optimizationRef.current === pending && current.sessionId === pending.sessionId && current.draft === pending.draft && current.idle && !current.sending && result?.status === 'ready' && typeof result.prompt === 'string' && result.prompt.trim()) {
            const editor = composerEditor(anchorRef.current);
            inputActions.setDraft(result.prompt);
            editor?.focus();
          }
        } catch { /* The original draft remains untouched on every failure. */ }
        finally { clearTimeout(timeout); if (optimizationRef.current === pending) optimizationRef.current = null; }
      }, [inputActions]);

      useEffect(() => {
        if (!sessionId) return undefined;
        const onKeyDown = event => {
          if (event.isComposing || event.keyCode === 229 || event.repeat) { keyRef.current = {}; browsePressRef.current = ''; return; }
          const code = keyCode(event);
          const editor = composerEditor(anchorRef.current);
          if (!editor || !(document.activeElement === editor || editor.contains(document.activeElement))) { keyRef.current = {}; browsePressRef.current = ''; return; }
          const current = activeRef.current;
          if (!current.idle || current.sending || current.runningTurn) { keyRef.current = {}; browsePressRef.current = ''; return; }
          const binding = keyBinding(event);
          browsePressRef.current = '';
          if (event.key === 'Escape' && (visible || generationRef.current || feedback)) {
            setDismissedKey(hintKey || `${sessionId}#${lastTurnRef.current}`);
            generationRef.current?.controller.abort();
            generationRef.current = null;
            setGenerating(false);
            setFeedback(null);
            keyRef.current = {};
            return;
          }
          const now = Date.now();
          const previous = keyRef.current;
          const configured = keysRef.current;
          const matches = action => configured[action].keys.includes(binding);
          const continuing = action => previous.action === action && previous.key === binding && previous.draft === current.draft && now - previous.at <= 500;
          let action;
          if (current.empty) {
            if (matches('next')) action = 'next';
            else if (matches('prev')) action = 'prev';
            // Finish an already-started generation gesture even if an
            // automatic suggestion appeared between the two presses.
            else if (matches('generate') && continuing('generate')) action = 'generate';
            else if (visible && matches('accept')) action = 'accept';
            else if (!visible && matches('generate')) action = 'generate';
          } else if (matches('optimize') && (code !== 'ArrowRight' || caretAtEnd(editor))) action = 'optimize';
          if (!action) {
            // A second chord starts by pressing its modifiers again. Those
            // modifier events belong to the same pending double-press gesture.
            const modifier = code.replace(/(?:Left|Right)$/, '');
            const expected = String(previous.key || '').split('+').slice(0, -1);
            const sameGesture = previous.action && previous.draft === current.draft && now - previous.at <= 500;
            if (sameGesture && ['Control', 'Alt', 'Shift', 'Meta'].includes(modifier)
              && binding.split('+').every(part => expected.includes(part.replace(/(?:Left|Right)$/, '')))) return;
            keyRef.current = {}; return;
          }
          // A second press in the same acceptance gesture must not optimize
          // the suggestion that the first press has just inserted.
          if (previous.mode === 'accepted' && previous.key === binding && previous.draft === current.draft && now - previous.at <= 500) { event.preventDefault(); event.stopPropagation(); return; }
          const complete = configured[action].presses === 1 || continuing(action);
          // An initial Right in a double-press gesture can retain native caret
          // behavior; Tab must keep focus so its second press reaches us.
          if (complete || code !== 'ArrowRight' || action === 'accept') { event.preventDefault(); event.stopPropagation(); browsePressRef.current = code; }
          keyRef.current = complete ? {} : { action, key: binding, draft: current.draft, at: now };
          if (!complete) return;
          if (action === 'accept') { accept(); keyRef.current.key = binding; }
          else if (action === 'generate') generate();
          else if (action === 'optimize') optimize();
          else step(action === 'next' ? 1 : -1);
        };
        const onKeyUp = event => {
          if (!browsePressRef.current || ![browsePressRef.current, 'AltLeft', 'AltRight'].includes(keyCode(event))) return;
          // A handled bare Alt must not hand focus to the browser/menu on release.
          event.preventDefault(); event.stopPropagation(); browsePressRef.current = '';
        };
        const resetKeys = () => { keyRef.current = {}; browsePressRef.current = ''; };
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', resetKeys);
        window.addEventListener('focusout', resetKeys, true);
        return () => { window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp, true); window.removeEventListener('blur', resetKeys); window.removeEventListener('focusout', resetKeys, true); };
      }, [sessionId, visible, hintKey, accept, generate, optimize, step, feedback]);

      const deck = deckRef.current;
      const browseButton = (direction, label) => h('button', { type: 'button', className: 'sug-browse', 'aria-label': label, title: label,
        disabled: direction < 0 ? deck.index <= 0 : generating,
        onMouseDown: event => event.preventDefault(), onClick: () => step(direction),
      }, h('svg', { width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
        h('path', { d: direction < 0 ? 'm12 5-5 5 5 5' : 'm8 5 5 5-5 5', strokeLinecap: 'round', strokeLinejoin: 'round' })));
      return h('div', { ref: anchorRef, 'data-dsh-suggestions': showing && layout ? (visible ? 'hint' : generating ? 'generating' : 'status') : 'anchor', style: showing ? { position: 'absolute', top: 0, left: 0, right: 0, height: 1, padding: 0, border: 0, pointerEvents: 'none', zIndex: 3 } : { display: 'none' } },
        showing && layout ? h('div', { 'data-dsh-suggestions-text': '', style: { ...layout, position: 'absolute', display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none', background: 'transparent', whiteSpace: 'nowrap', overflow: 'hidden' } },
          h('span', { 'aria-hidden': visible ? true : undefined, role: visible ? undefined : 'status', style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, visible ? hint.text : generating ? generatingLabel : feedback?.text),
          visible && showChip ? h('button', { type: 'button', className: 'sug-accept', 'aria-label': isChinese() ? '采用这条建议' : 'Accept this suggestion', title: gestureLabel(keys.accept), onMouseDown: event => event.preventDefault(), onClick: accept }, keycap(gestureLabel({ ...keys.accept, keys: keys.accept.keys.slice(0, 1) }))) : null,
          deck.items.length > 0 ? h('span', { 'data-dsh-suggestions-pager': '' },
            browseButton(-1, (isChinese() ? '上一条' : 'Previous') + ' (' + gestureLabel(keys.prev) + ')'),
            h('span', { 'data-dsh-suggestions-page': '' }, `${deck.index + 1}/${deck.items.length}`),
            browseButton(1, (isChinese() ? '下一条' : 'Next') + ' (' + gestureLabel(keys.next) + ')')) : null) : null,
        h('style', null, COMPOSER_CSS));
    }

    const COMPOSER_CSS = `
      [data-dsh-suggestions] .sug-accept,[data-dsh-suggestions] .sug-browse{display:inline-flex;align-items:center;justify-content:center;flex:none;box-sizing:border-box;min-height:24px;margin:0;padding:0;border:1px solid transparent;border-radius:9px;background:transparent;color:inherit;font:inherit;line-height:1;cursor:pointer;pointer-events:auto;touch-action:manipulation;transition:background .14s,opacity .14s}
      [data-dsh-suggestions] .sug-accept:hover,[data-dsh-suggestions] .sug-browse:hover:enabled{background:color-mix(in srgb,currentColor 10%,transparent)}
      [data-dsh-suggestions] :is(.sug-accept,.sug-browse):focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:1px}
      [data-dsh-suggestions] .sug-browse{width:24px}
      [data-dsh-suggestions] .sug-browse:disabled{opacity:.3;cursor:default}
      [data-dsh-suggestions] .sug-keycap{display:block;box-sizing:border-box;max-width:140px;min-width:28px;padding:3px 6px;border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:8.25px;background:color-mix(in srgb,currentColor 5%,transparent);overflow:hidden;text-overflow:ellipsis;font:inherit;font-size:10px;line-height:16px}
      [data-dsh-suggestions-pager]{display:inline-flex;align-items:center;gap:2px;flex:none;pointer-events:auto}
      [data-dsh-suggestions-page]{min-width:26px;font-size:11px;line-height:24px;text-align:center;font-variant-numeric:tabular-nums}
      @media(prefers-reduced-motion:reduce){[data-dsh-suggestions] :is(.sug-accept,.sug-browse){transition:none}}
    `;

    const SETTINGS_CSS = `
      [data-dsh-suggestions-settings]{--sug-text:var(--dsw-alias-label-primary,CanvasText);--sug-muted:var(--dsw-alias-label-secondary,var(--sug-text));--sug-subtle:var(--dsw-alias-label-tertiary,var(--sug-muted));--sug-surface:var(--dsw-alias-bg-layer-1,Canvas);--sug-field:var(--dsw-alias-bg-module-platform,var(--sug-surface));--sug-border:color-mix(in srgb,var(--sug-text) 11%,transparent);--sug-panel:color-mix(in srgb,var(--sug-field) 52%,var(--sug-surface));--sug-hover:color-mix(in srgb,var(--sug-text) 8%,var(--sug-surface));--sug-control-radius:8px;container:dsh-suggestion-settings / inline-size;box-sizing:border-box;width:100%;max-width:680px;padding:8px 0 24px;color:var(--sug-text);font:inherit;font-size:14px;line-height:1.6}
      [data-dsh-suggestions-settings] *{box-sizing:border-box}
      [data-dsh-suggestions-settings] .sug-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px 20px}
      [data-dsh-suggestions-settings] .sug-brand{display:flex;align-items:center;gap:10px;min-width:0}
      [data-dsh-suggestions-settings] .sug-brand-tile{display:grid;place-items:center;width:36px;height:36px;flex:none;border-radius:10px;background:var(--sug-field)}
      [data-dsh-suggestions-settings] .sug-brand-glyph{display:block;width:21px;height:21px;background:currentColor;mask-repeat:no-repeat;mask-position:center;mask-size:contain}
      [data-dsh-suggestions-settings] .sug-heading{margin:0;font-size:20px;font-weight:600;line-height:1.4}
      [data-dsh-suggestions-settings] .sug-features{display:flex;flex-wrap:wrap;gap:6px;min-width:0;margin:0;padding:0;list-style:none}
      [data-dsh-suggestions-settings] .sug-features li{max-width:100%;padding:2px 8px;border:1px solid var(--sug-border);border-radius:var(--sug-control-radius);background:var(--sug-panel);color:var(--sug-muted);font-size:12px;line-height:18px;overflow-wrap:anywhere}
      [data-dsh-suggestions-settings] .sug-section-heading{margin:22px 0 10px}
      [data-dsh-suggestions-settings] .sug-section-heading h3{margin:0 0 3px;font-size:14px;font-weight:600}
      [data-dsh-suggestions-settings] .sug-section-heading span{display:block;color:var(--sug-subtle);font-size:12px;line-height:1.55}
      [data-dsh-suggestions-settings] .sug-rows{padding:0 16px;border:1px solid var(--sug-border);border-radius:16px;overflow:hidden;background:var(--sug-surface)}
      [data-dsh-suggestions-settings] .sug-row{display:grid;grid-template-columns:minmax(0,1fr) clamp(200px,38cqw,256px);align-items:center;gap:16px;padding:12px 0}
      [data-dsh-suggestions-settings] .sug-row+.sug-row{border-top:1px solid var(--sug-border)}
      [data-dsh-suggestions-settings] .sug-row-title{font-weight:500;font-size:14px;line-height:1.5}
      [data-dsh-suggestions-settings] .sug-row-note{margin-top:3px;color:var(--sug-subtle);font-size:12px;line-height:1.55;max-width:32em;overflow-wrap:anywhere}
      [data-dsh-suggestions-settings] .sug-row[data-recording=true] .sug-row-note{color:var(--sug-muted)}
      [data-dsh-suggestions-settings] button{font:inherit;font-size:13px;line-height:1.4;touch-action:manipulation;cursor:pointer;transition:background .14s,border-color .14s,color .14s}
      [data-dsh-suggestions-settings] button:disabled{cursor:default;opacity:.4}
      [data-dsh-suggestions-settings] button:focus-visible{outline:2px solid var(--sug-text);outline-offset:2px}
      [data-dsh-suggestions-settings] .sug-controls{display:grid;grid-template-columns:minmax(0,1fr) 64px;align-items:center;gap:12px;min-width:0;width:100%}
      [data-dsh-suggestions-settings] .sug-summary{display:flex;align-items:center;gap:8px;min-width:0;color:var(--sug-muted)}
      [data-dsh-suggestions-settings] .sug-summary[data-recording=true]{color:var(--sug-text)}
      [data-dsh-suggestions-settings] .sug-bindings{display:flex;flex-wrap:wrap;align-items:center;gap:5px;min-width:0}
      [data-dsh-suggestions-settings] .sug-chord{display:inline-flex;flex-wrap:wrap;align-items:center;gap:3px;min-width:0;max-width:100%}
      [data-dsh-suggestions-settings] .sug-summary kbd{max-width:100%;padding:2px 6px;border:1px solid var(--sug-border);border-radius:var(--sug-control-radius);background:var(--sug-field);overflow:hidden;text-overflow:ellipsis;color:var(--sug-text)}
      [data-dsh-suggestions-settings] .sug-count{flex:none;min-width:36px;padding:3px 6px;border-radius:8px;background:var(--sug-field);color:var(--sug-subtle);font-size:11px;text-align:center;white-space:nowrap}
      [data-dsh-suggestions-settings] .sug-record{min-height:32px;width:64px;padding:5px 9px;border:1px solid var(--sug-border);border-radius:var(--sug-control-radius);background:var(--sug-field);color:var(--sug-muted)}
      [data-dsh-suggestions-settings] .sug-record:hover:enabled{background:var(--sug-hover);color:var(--sug-text)}
      [data-dsh-suggestions-settings] .sug-record[aria-pressed=true]{border-color:transparent;background:var(--sug-text);color:var(--dsw-alias-bg-base)}
      [data-dsh-suggestions-settings] .sug-record[aria-pressed=true]:hover:enabled{background:color-mix(in srgb,var(--sug-text) 86%,var(--sug-surface));color:var(--dsw-alias-bg-base)}
      [data-dsh-suggestions-settings] kbd{font:inherit;font-size:12px;font-weight:400;min-width:24px;text-align:center;white-space:nowrap}
      [data-dsh-suggestions-settings] .sug-key-separator{color:var(--sug-muted);font-size:11px}
      [data-dsh-suggestions-settings] .sug-feedback{display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--sug-muted);font-size:12px;line-height:1.6}
      [data-dsh-suggestions-settings] .sug-feedback:empty{display:none}
      [data-dsh-suggestions-settings] .sug-feedback[data-state=error]{color:var(--dsw-alias-state-error-primary,#e57676)}
      [data-dsh-suggestions-settings] .sug-retry{border:1px solid var(--sug-border);border-radius:var(--sug-control-radius);padding:4px 8px;background:var(--sug-field);color:var(--sug-text)}
      [data-dsh-suggestions-settings] .sug-field{display:flex;align-items:center;min-width:0;width:100%}
      [data-dsh-suggestions-settings] .sug-trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:36px;padding:6px 10px;border:1px solid var(--sug-border);border-radius:var(--sug-control-radius);background:var(--sug-field);color:var(--sug-text);font:inherit;font-size:13px;line-height:1.5;text-align:left}
      [data-dsh-suggestions-settings] .sug-trigger:hover:enabled{background:var(--sug-hover)}
      [data-dsh-suggestions-settings] .sug-trigger:disabled{opacity:.5;cursor:default}
      [data-dsh-suggestions-settings] .sug-trigger:focus-visible{outline:2px solid var(--sug-text);outline-offset:2px}
      [data-dsh-suggestions-settings] .sug-trigger[aria-expanded=true]{background:var(--sug-hover);border-color:color-mix(in srgb,var(--sug-text) 18%,transparent)}
      [data-dsh-suggestions-settings] .sug-trigger-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      [data-dsh-suggestions-settings] .sug-chevron{flex:none;opacity:.65;transition:transform .14s}
      [data-dsh-suggestions-settings] .sug-trigger[aria-expanded=true] .sug-chevron{transform:rotate(180deg)}
      [data-dsh-suggestions-settings] .sug-menu{position:fixed;z-index:60;display:flex;flex-direction:column;max-height:min(62vh,400px);padding:8px;border:1px solid var(--sug-border);border-radius:16px;background:var(--sug-surface);box-shadow:0 20px 48px rgba(0,0,0,.34);overflow:hidden;animation:sug-menu-in .12s ease-out}
      @keyframes sug-menu-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
      [data-dsh-suggestions-settings] .sug-menu-search{flex:none;display:flex;align-items:center;margin:2px 6px 6px;padding:8px 10px;border-bottom:1px solid var(--sug-border)}
      [data-dsh-suggestions-settings] .sug-menu-search input{flex:1;min-width:0;border:0;background:transparent;color:var(--sug-text);font:inherit;font-size:14px;line-height:1.5;outline:none}
      [data-dsh-suggestions-settings] .sug-menu-search input::placeholder{color:var(--sug-subtle)}
      [data-dsh-suggestions-settings] .sug-menu-list{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--sug-text) 26%,transparent) transparent}
      [data-dsh-suggestions-settings] .sug-menu-group{padding:10px 12px 4px;color:var(--sug-subtle);font-size:12px;line-height:1.4;letter-spacing:.02em}
      [data-dsh-suggestions-settings] .sug-menu-group:first-child{padding-top:6px}
      [data-dsh-suggestions-settings] .sug-menu-option{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:var(--sug-control-radius);background:transparent;color:var(--sug-text);font:inherit;font-size:13px;line-height:1.5;text-align:left;cursor:pointer}
      [data-dsh-suggestions-settings] .sug-menu-option[data-active=true]{background:var(--sug-hover)}
      [data-dsh-suggestions-settings] .sug-menu-option:focus-visible{outline:none;background:var(--sug-hover)}
      [data-dsh-suggestions-settings] .sug-menu-option-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      [data-dsh-suggestions-settings] .sug-menu-option .sug-check{flex:none;opacity:0}
      [data-dsh-suggestions-settings] .sug-menu-option[aria-selected=true] .sug-check{opacity:.9}
      [data-dsh-suggestions-settings] .sug-menu-empty{padding:14px 12px;color:var(--sug-subtle);font-size:13px}
      [data-dsh-suggestions-settings] .sug-inline-retry{margin-left:6px;border:1px solid var(--sug-border);border-radius:var(--sug-control-radius);padding:3px 8px;background:var(--sug-field);color:var(--sug-text);font-size:12px}
      [data-dsh-suggestions-settings] .sug-failures{color:var(--sug-subtle)}
      @container dsh-suggestion-settings (max-width:480px){
        [data-dsh-suggestions-settings] .sug-rows{padding:0 12px}
        [data-dsh-suggestions-settings] .sug-row{grid-template-columns:minmax(0,1fr);gap:8px}
        [data-dsh-suggestions-settings] .sug-record{min-height:44px}
      }
      @media(prefers-reduced-motion:reduce){[data-dsh-suggestions-settings] button{transition:none}[data-dsh-suggestions-settings] .sug-menu{animation:none}}
    `;

    function SettingsCard({ language } = {}) {
      const zh = isChinese(language);
      const TEXT = zh ? {
        title: 'DSH-Suggestions',
        features: ['后续建议', '草稿优化', '快捷键'],
        shortcuts: '快捷键',
        hint: '点击“录制”，按一次或连按两次快捷键。',
        accept: '采纳建议',
        acceptNote: '将当前建议填入草稿。',
        generate: '空框生成建议',
        generateNote: '空框无建议时，根据聊天记录生成。',
        optimize: '优化草稿',
        optimizeNote: '改写已输入的草稿；→ 需在文末。',
        single: '单击', double: '双击', record: '录制', stop: '取消', or: '或',
        wait: '再按一次可录成双击',
        unsupported: '这个按键无法用于快捷键，请换一个。',
        next: '下一条建议',
        nextNote: '到末尾时生成新建议。',
        prev: '上一条建议',
        prevNote: '返回已生成的建议。',
        press: '等待按键…',
        cancel: '按一次或连按两次快捷键，Esc 取消。',
        saving: '保存中…',
        saved: '已保存',
        loading: '正在读取快捷键…',
        loadFailed: '快捷键读取失败',
        retry: '重试',
        conflict: '翻页快捷键不能与采纳、生成或另一翻页动作共用。',
        failed: '保存失败，请重试',
        model: '生成模型',
        modelHint: '用于生成建议和优化草稿。可选模型与输入框右下角一致。',
        modelRow: '模型',
        modelNote: '「自动」跟随当前会话正在使用的模型。',
        modelAuto: '自动（跟随当前会话）',
        modelLoading: '正在读取模型列表…',
        modelLoadFailed: '模型列表读取失败，稍后可重试。',
        modelStale: '当前不可用',
        modelFailures: '暂不可用的提供方：',
        effortRow: '推理强度',
        effortNote: '「自动」使用该模型的最低强度，响应最快。',
        effortAuto: '自动（最低强度）',
        effortNone: '该模型没有可选的推理强度。',
        rejected: '这个选择当前不可用，请重新选择。',
        modelSearch: '搜索模型',
        modelEmpty: '没有匹配的模型',
      } : {
        title: 'DSH-Suggestions',
        features: ['Follow-up suggestions', 'Draft improvement', 'Shortcuts'],
        shortcuts: 'Keyboard shortcuts',
        hint: 'Click Record, then press your shortcut once or twice.',
        accept: 'Accept suggestion',
        acceptNote: 'Insert the visible suggestion into your draft.',
        generate: 'Generate in empty composer',
        generateNote: 'Generate from chat history when the composer is empty with no suggestion.',
        optimize: 'Improve draft',
        optimizeNote: 'Rewrite your draft; Right must be at the end.',
        single: 'Single', double: 'Double', record: 'Record', stop: 'Cancel', or: 'or',
        wait: 'Press again to record a double press',
        unsupported: 'This key cannot be used as a shortcut. Try another.',
        next: 'Next suggestion',
        nextNote: 'Generate a new suggestion at the end of the list.',
        prev: 'Previous suggestion',
        prevNote: 'Go back to a generated suggestion.',
        press: 'Waiting for a key…',
        cancel: 'Press once or twice. Esc cancels.',
        saving: 'Saving…',
        saved: 'Saved',
        loading: 'Loading shortcuts…',
        loadFailed: 'Could not load shortcuts',
        retry: 'Retry',
        conflict: 'Paging keys cannot also accept, generate or page in the other direction.',
        failed: 'Could not save. Try again.',
        model: 'Generation model',
        modelHint: 'Used for suggestions and draft improvements. The list matches the composer model picker.',
        modelRow: 'Model',
        modelNote: '“Auto” follows the model the current session uses.',
        modelAuto: 'Auto (follow this session)',
        modelLoading: 'Loading models…',
        modelLoadFailed: 'Could not load models. Retry later.',
        modelStale: 'currently unavailable',
        modelFailures: 'Unavailable providers: ',
        effortRow: 'Reasoning effort',
        effortNote: '“Auto” uses the lowest effort this model offers.',
        effortAuto: 'Auto (lowest effort)',
        effortNone: 'This model advertises no reasoning effort.',
        rejected: 'This choice is unavailable. Choose another.',
        modelSearch: 'Search models',
        modelEmpty: 'No matching models',
      };
      const ROWS = ['accept', 'generate', 'optimize', 'next', 'prev'].map(name => [name, TEXT[name], TEXT[name + 'Note']]);
      const [draft, setDraft] = useState(null);
      const [savedKeys, setSavedKeys] = useState(null);
      const [model, setModel] = useState(null);
      const [savedModel, setSavedModel] = useState(null);
      const [catalog, setCatalog] = useState({ status: 'loading', groups: [], failures: [] });
      const [openMenu, setOpenMenu] = useState('');
      const [menuActive, setMenuActive] = useState(0);
      const [menuSearch, setMenuSearch] = useState('');
      const [menuBox, setMenuBox] = useState(null);
      const modelButtonRef = useRef(null);
      const effortButtonRef = useRef(null);
      const menuRef = useRef(null);
      const [loading, setLoading] = useState(true);
      const [recording, setRecording] = useState('');
      const [capture, setCapture] = useState(null);
      const [status, setStatus] = useState('');
      const [busy, setBusy] = useState(false);
      const draftRef = useRef(draft);
      const savedRef = useRef(savedKeys);
      const modelRef = useRef(model);
      const savedModelRef = useRef(savedModel);
      draftRef.current = draft;
      savedRef.current = savedKeys;
      modelRef.current = model;
      savedModelRef.current = savedModel;

      const load = useCallback(async signal => {
        setLoading(true); setStatus('');
        try {
          const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'config' }), signal });
          const payload = await response.json();
          if (!response.ok || !payload?.ok || !payload.value?.keys) throw new Error('config unavailable');
          if (!signal?.aborted) { const next = normalizeKeys(payload.value.keys); const nextModel = normalizeModel(payload.value.model); setDraft(next); setSavedKeys(next); setModel(nextModel); setSavedModel(nextModel); }
        } catch {
          if (!signal?.aborted) setStatus('loadFailed');
        } finally { if (!signal?.aborted) setLoading(false); }
      }, []);

      // The catalog is the same grouped projection the composer picker renders;
      // it loads separately so a slow provider never blocks the shortcut form.
      const loadCatalog = useCallback(async signal => {
        setCatalog(current => ({ ...current, status: 'loading' }));
        try {
          const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'catalog' }), signal });
          const payload = await response.json();
          if (!response.ok || !payload?.ok) throw new Error('catalog unavailable');
          const groups = Array.isArray(payload.value?.groups) ? payload.value.groups : [];
          const failures = Array.isArray(payload.value?.failures) ? payload.value.failures : [];
          if (!signal?.aborted) setCatalog({ status: 'ready', groups, failures });
        } catch {
          if (!signal?.aborted) setCatalog({ status: 'error', groups: [], failures: [] });
        }
      }, []);

      useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        loadCatalog(controller.signal);
        return () => controller.abort();
      }, [load, loadCatalog]);

      useEffect(() => {
        const updated = event => {
          if (!event.detail) return;
          const next = normalizeKeys(event.detail);
          if (JSON.stringify(draftRef.current) === JSON.stringify(savedRef.current)) setDraft(next);
          setSavedKeys(next);
        };
        window.addEventListener(KEYS_EVENT, updated);
        return () => window.removeEventListener(KEYS_EVENT, updated);
      }, []);

      useEffect(() => {
        if (!recording) return undefined;
        let pending = null, timer, modifier;
        const consume = event => {
          event.preventDefault(); event.stopPropagation();
          event.stopImmediatePropagation?.();
        };
        const finish = () => {
          if (!pending) return;
          clearTimeout(timer);
          const next = normalizeKeys(draftRef.current || DEFAULT_KEYS);
          next[recording] = { keys: [pending.binding], presses: pending.presses };
          setDraft(next); setStatus('');
          setRecording(''); setCapture(null);
          persist(next, modelRef.current);
        };
        const startStroke = (binding, code, released = false, now = Date.now()) => {
          const doubled = pending?.binding === binding && pending.released && now - pending.at <= 500;
          clearTimeout(timer);
          pending = { binding, code, at: now, presses: doubled ? 2 : 1, released };
          setCapture({ binding, presses: pending.presses });
          if (released) { if (doubled) finish(); else timer = setTimeout(finish, Math.max(0, 500 - (Date.now() - now))); }
        };
        const onKey = event => {
          consume(event);
          if (event.key === 'Escape') { setRecording(''); return; }
          if (event.isComposing || event.keyCode === 229) { clearTimeout(timer); pending = null; modifier = null; setCapture(null); return; }
          if (event.repeat) return;
          const code = keyCode(event);
          if (['Shift', 'Control', 'Meta', 'Alt', 'AltGraph', 'CapsLock', 'Fn'].includes(event.key)) {
            modifier = event.key === 'Alt' || event.key === 'AltGraph' ? { binding: keyBinding(event), code, at: Date.now() } : null;
            if (modifier && pending?.released && pending.binding === modifier.binding && modifier.at - pending.at <= 500) clearTimeout(timer);
            return;
          }
          modifier = null;
          const binding = keyBinding(event);
          if (!binding) return;
          if (!RECORDABLE_CODE.test(code)) { setStatus('unsupported'); return; }
          startStroke(binding, code);
        };
        const onKeyUp = event => {
          consume(event);
          const code = keyCode(event);
          if (modifier?.code === code) { const stroke = modifier; modifier = null; startStroke(stroke.binding, code, true, stroke.at); }
          else if (pending?.code === code) {
            pending.released = true;
            if (pending.presses === 2) finish();
            else timer = setTimeout(finish, Math.max(0, 500 - (Date.now() - pending.at)));
          }
        };
        const cancel = () => { clearTimeout(timer); pending = null; setRecording(''); setCapture(null); };
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', cancel);
        return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true); window.removeEventListener('blur', cancel); };
      }, [recording]);

      // Every change is committed immediately; a rejected write restores the
      // last value the host acknowledged so the card never shows unsaved state.
      const persist = async (next, nextModel) => {
        if (keyConflict(next)) { setStatus('conflict'); setDraft(savedRef.current); setModel(savedModelRef.current); return; }
        setBusy(true); setStatus('');
        try {
          const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'config', keys: next, model: nextModel ?? null }) });
          const payload = await response.json();
          if (!response.ok || !payload?.ok) {
            setStatus(['model-unavailable', 'effort-unavailable', 'invalid-model'].includes(payload?.error?.code) ? 'rejected' : 'failed');
            setDraft(savedRef.current);
            setModel(savedModelRef.current);
            return;
          }
          const saved = normalizeKeys(payload.value.keys);
          const savedSelection = normalizeModel(payload.value.model);
          setDraft(saved);
          setSavedKeys(saved);
          setModel(savedSelection);
          setSavedModel(savedSelection);
          window.dispatchEvent(new CustomEvent(KEYS_EVENT, { detail: saved }));
          setStatus('saved');
        } catch {
          setStatus('failed');
          setDraft(savedRef.current);
          setModel(savedModelRef.current);
        } finally { setBusy(false); }
      };
      const keys = draft || DEFAULT_KEYS;
      const error = ['loadFailed', 'failed', 'conflict', 'unsupported', 'rejected'].includes(status);
      const message = loading ? TEXT.loading : busy ? TEXT.saving : status ? TEXT[status] : '';
      const disabled = loading || busy || savedKeys === null;
      const selectedEntry = model ? catalog.groups.find(group => group.id === model.provider)?.models.find(entry => entry.id === model.model) : undefined;
      const efforts = selectedEntry?.reasoning?.efforts || [];
      const modelUnavailable = Boolean(model) && catalog.status === 'ready' && !selectedEntry;
      const query = menuSearch.trim().toLowerCase();
      const matches = text => !query || String(text).toLowerCase().includes(query);
      const visibleGroups = catalog.groups
        .map(group => ({ ...group, models: (group.models || []).filter(entry => matches(`${group.name || group.id} ${entry.name || entry.id}`)) }))
        .filter(group => group.models.length > 0);
      const showStale = modelUnavailable && (!model || matches(`${model.provider} ${model.model}`));
      const modelNav = [
        { kind: 'auto', current: !model },
        ...(showStale ? [{ kind: 'stale', current: true }] : []),
        ...visibleGroups.flatMap(group => group.models.map(entry => ({ kind: 'model', group, entry, current: Boolean(model && model.provider === group.id && model.model === entry.id) }))),
      ];
      const effortNav = [
        { id: '', name: TEXT.effortAuto, current: !model?.reasoningEffort },
        ...efforts.map(effort => ({ id: effort.id, name: effort.name || effort.id, current: model?.reasoningEffort === effort.id })),
      ];
      // Search stays available while filtering; it must not depend on the
      // already-filtered list or typing would unmount the input.
      const searchable = 1 + catalog.groups.reduce((count, group) => count + (group.models || []).length, 0) + (modelUnavailable ? 1 : 0) > 8;
      const triggerRef = which => which === 'model' ? modelButtonRef : effortButtonRef;
      const closePicker = () => { setOpenMenu(''); setMenuSearch(''); };
      // A fixed popover is positioned against the nearest ancestor that creates
      // a containing block (transform/filter/contain), so measure that ancestor
      // instead of assuming the viewport.
      const containingBlock = element => {
        if (typeof document === 'undefined' || typeof window === 'undefined' || !element?.parentElement) return null;
        let node = element.parentElement;
        while (node && node !== document.body && node !== document.documentElement) {
          const style = window.getComputedStyle(node);
          if (style && (style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none' || /paint|layout|strict|content/.test(style.contain || ''))) return node.getBoundingClientRect();
          node = node.parentElement;
        }
        return null;
      };
      const openPicker = which => {
        setStatus('');
        setMenuSearch('');
        setOpenMenu(which);
        const items = which === 'model' ? modelNav : effortNav;
        const index = items.findIndex(item => item.current);
        setMenuActive(index < 0 ? 0 : index);
        const button = triggerRef(which).current;
        if (!button || typeof button.getBoundingClientRect !== 'function') { setMenuBox(null); return; }
        const rect = button.getBoundingClientRect();
        const origin = containingBlock(button);
        const viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280;
        const viewportHeight = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800;
        const originLeft = origin ? origin.left : 0;
        const originTop = origin ? origin.top : 0;
        const originHeight = origin ? origin.height : viewportHeight;
        const width = Math.max(Math.min(rect.width || 0, 380), 280);
        const left = Math.max(8, Math.min(rect.left - originLeft, viewportWidth - width - 8));
        const below = originHeight - (rect.bottom - originTop);
        const above = rect.top - originTop;
        setMenuBox(below < 280 && above > below
          ? { left, width, bottom: originHeight - above + 6 }
          : { left, width, top: rect.bottom - originTop + 6 });
      };
      useEffect(() => {
        if (!openMenu) return undefined;
        const onPointerDown = event => {
          const target = event.target;
          const trigger = triggerRef(openMenu).current;
          if (trigger && target && typeof trigger.contains === 'function' && trigger.contains(target)) return;
          if (menuRef.current && target && typeof menuRef.current.contains === 'function' && menuRef.current.contains(target)) return;
          closePicker();
        };
        const onViewportChange = () => closePicker();
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('pointerdown', onPointerDown, true);
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('resize', onViewportChange);
          window.addEventListener('scroll', onViewportChange, true);
        }
        return () => {
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('pointerdown', onPointerDown, true);
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('resize', onViewportChange);
            window.removeEventListener('scroll', onViewportChange, true);
          }
        };
      }, [openMenu]);
      const pickModel = item => {
        setStatus('');
        let next = null;
        if (item.kind === 'auto') next = null;
        else if (item.kind === 'stale') next = { provider: model.provider, model: model.model, ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}) };
        else {
          const keepEffort = model?.reasoningEffort && (item.entry.reasoning?.efforts || []).some(effort => effort.id === model.reasoningEffort);
          next = { provider: item.group.id, model: item.entry.id, ...(keepEffort ? { reasoningEffort: model.reasoningEffort } : {}) };
        }
        setModel(next);
        closePicker();
        persist(keys, next);
      };
      const pickEffort = item => {
        if (!model) { closePicker(); return; }
        const next = { ...model };
        delete next.reasoningEffort;
        if (item.id) next.reasoningEffort = item.id;
        setModel(next);
        closePicker();
        persist(keys, next);
      };
      const onMenuKeyDown = event => {
        if (!openMenu) return;
        if (event.key === 'Escape') { event.preventDefault?.(); closePicker(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault?.();
          const items = openMenu === 'model' ? modelNav : effortNav;
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          setMenuActive(current => items.length ? (current + delta + items.length) % items.length : 0);
          return;
        }
        if (event.key === 'Tab') { closePicker(); return; }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault?.();
          const items = openMenu === 'model' ? modelNav : effortNav;
          const item = items[Math.min(menuActive, items.length - 1)];
          if (!item) return;
          if (openMenu === 'model') pickModel(item); else pickEffort(item);
        }
      };
      const chevronIcon = () => h('svg', { className: 'sug-chevron', viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true },
        h('path', { d: 'M4 6.5 8 10l4-3.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      const checkIcon = key => h('svg', { key, className: 'sug-check', viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true },
        h('path', { d: 'm3.5 8.5 3 3 6-6.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      const menuOption = (key, label, item, pick, items) => h('button', { type: 'button', role: 'option', key, className: 'sug-menu-option', 'data-sug-option': openMenu,
        'aria-selected': Boolean(item.current), 'data-active': items.indexOf(item) === menuActive,
        onClick: () => pick(item), onMouseEnter: () => setMenuActive(items.indexOf(item)),
      }, h('span', { className: 'sug-menu-option-label' }, label), checkIcon(`${key}-check`));
      const renderModelOptions = () => {
        const nodes = [];
        let index = 0;
        nodes.push(menuOption('auto', TEXT.modelAuto, modelNav[index], pickModel, modelNav));
        index++;
        if (showStale) {
          nodes.push(menuOption('stale', `${model.provider} / ${model.model} · ${TEXT.modelStale}`, modelNav[index], pickModel, modelNav));
          index++;
        }
        for (const group of visibleGroups) {
          nodes.push(h('div', { key: `group-${group.id}`, role: 'group', 'aria-label': group.name || group.id },
            h('div', { className: 'sug-menu-group', 'aria-hidden': true }, group.name || group.id),
            group.models.map(entry => {
              const item = modelNav[index++];
              return menuOption(`m-${group.id}-${entry.id}`, entry.name || entry.id, item, pickModel, modelNav);
            })));
        }
        return nodes;
      };
      const renderEffortOptions = () => effortNav.map(item => menuOption(`e-${item.id || 'auto'}`, item.name, item, pickEffort, effortNav));
      const modelRow = () => {
        const note = catalog.status === 'loading' ? TEXT.modelLoading
          : catalog.status === 'error' ? TEXT.modelLoadFailed
            : modelUnavailable ? TEXT.modelStale
              : TEXT.modelNote;
        const label = model
          ? modelUnavailable ? `${model.provider} / ${model.model} · ${TEXT.modelStale}` : selectedEntry?.name || `${model.provider} / ${model.model}`
          : TEXT.modelAuto;
        return h('div', { className: 'sug-row', 'data-row': 'model' },
          h('div', null,
            h('div', { className: 'sug-row-title' }, TEXT.modelRow),
            h('div', { className: 'sug-row-note' },
              note,
              catalog.status === 'error' ? h('button', { type: 'button', className: 'sug-inline-retry', onClick: () => loadCatalog() }, TEXT.retry) : null,
              catalog.status === 'ready' && catalog.failures.length
                ? h('span', { className: 'sug-failures' }, ` ${TEXT.modelFailures}${catalog.failures.map(failure => failure?.name || failure?.id).join('、')}`)
                : null)),
          h('div', { className: 'sug-field' },
            h('button', { type: 'button', className: 'sug-trigger', 'data-sug-model': '',
              role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': openMenu === 'model', 'aria-label': TEXT.modelRow,
              disabled: loading || busy || catalog.status !== 'ready' || savedKeys === null,
              ref: modelButtonRef,
              onClick: () => { if (openMenu === 'model') closePicker(); else openPicker('model'); },
              onKeyDown: onMenuKeyDown,
            },
              h('span', { className: 'sug-trigger-label' }, label),
              chevronIcon())));
      };
      const effortRow = () => h('div', { className: 'sug-row', 'data-row': 'effort' },
        h('div', null,
          h('div', { className: 'sug-row-title' }, TEXT.effortRow),
          h('div', { className: 'sug-row-note' }, !model ? TEXT.effortNote : efforts.length ? TEXT.effortNote : catalog.status === 'loading' ? TEXT.modelLoading : TEXT.effortNone)),
        h('div', { className: 'sug-field' },
          h('button', { type: 'button', className: 'sug-trigger', 'data-sug-effort': '',
            role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': openMenu === 'effort', 'aria-label': TEXT.effortRow,
            disabled: loading || busy || !model || !efforts.length,
            ref: effortButtonRef,
            onClick: () => { if (openMenu === 'effort') closePicker(); else openPicker('effort'); },
            onKeyDown: onMenuKeyDown,
          },
            h('span', { className: 'sug-trigger-label' }, model?.reasoningEffort ? (efforts.find(effort => effort.id === model.reasoningEffort)?.name || model.reasoningEffort) : TEXT.effortAuto),
            chevronIcon())));
      const pickerMenu = () => openMenu ? h('div', { className: 'sug-menu', role: 'listbox', 'data-sug-menu': openMenu, ref: menuRef,
        'aria-label': openMenu === 'model' ? TEXT.modelRow : TEXT.effortRow, style: menuBox || {}, onKeyDown: onMenuKeyDown },
        openMenu === 'model' && searchable ? h('div', { className: 'sug-menu-search' },
          h('input', { type: 'search', value: menuSearch, placeholder: TEXT.modelSearch, 'aria-label': TEXT.modelSearch, autoFocus: true,
            onChange: event => { setMenuSearch(event.target.value); setMenuActive(0); }, onKeyDown: onMenuKeyDown })) : null,
        h('div', { className: 'sug-menu-list' },
          openMenu === 'model' ? renderModelOptions() : renderEffortOptions(),
          openMenu === 'model' && visibleGroups.length === 0 && !showStale ? h('div', { className: 'sug-menu-empty' }, TEXT.modelEmpty) : null)) : null;
      const startRecording = name => {
        setCapture(null); setRecording(recording === name ? '' : name); setStatus('');
      };
      const chord = binding => h('span', { className: 'sug-chord', key: binding, 'aria-label': keyLabel(binding) },
        keyLabel(binding).split('＋').flatMap((part, index) => [
          index ? h('span', { className: 'sug-key-separator', key: `${index}+`, 'aria-hidden': true }, '+') : null,
          h('kbd', { key: index }, part),
        ]));
      const shortcut = (name, label) => {
        const action = keys[name];
        const active = recording === name;
        return h('div', { className: 'sug-controls' },
          h('div', { className: 'sug-summary', 'data-recording': active, 'aria-label': `${label} ${TEXT.shortcuts}`, 'aria-live': active ? 'polite' : undefined },
            active && !capture ? TEXT.press : [
              h('span', { key: 'count', className: 'sug-count' }, (active ? capture.presses : action.presses) === 2 ? TEXT.double : TEXT.single),
              h('span', { key: 'bindings', className: 'sug-bindings' }, (active ? [capture.binding] : action.keys).flatMap((binding, index) => [
                index ? h('span', { key: `${index}-or`, className: 'sug-key-separator' }, TEXT.or) : null,
                chord(binding),
              ])),
            ]),
          h('button', { type: 'button', className: 'sug-record', disabled,
            'aria-label': `${active ? TEXT.stop : TEXT.record} ${label}`, 'aria-pressed': active,
            onClick: () => { if (active) { setRecording(''); setCapture(null); } else startRecording(name); },
          }, active ? TEXT.stop : TEXT.record));
      };

      return h('section', { 'data-dsh-suggestions-settings': '', 'aria-label': TEXT.title },
        h('style', null, SETTINGS_CSS),
        h('header', { className: 'sug-header' },
          h('div', { className: 'sug-brand' },
            h('span', { className: 'sug-brand-tile', 'aria-hidden': true },
              h('span', { className: 'sug-brand-glyph', style: { maskImage: SETTINGS_ICON_MASK } })),
            h('h2', { className: 'sug-heading' }, TEXT.title)),
          h('ul', { className: 'sug-features', role: 'list' }, TEXT.features.map(label => h('li', { key: label }, label)))),
        h('div', { className: 'sug-section-heading' }, h('h3', null, TEXT.model), h('span', null, TEXT.modelHint)),
        h('div', { className: 'sug-rows', 'data-sug-model-rows': '' }, modelRow(), effortRow()),
        h('div', { className: 'sug-section-heading' }, h('h3', null, TEXT.shortcuts), h('span', null, TEXT.hint)),
        h('div', { className: 'sug-rows' }, ROWS.map(([name, label, note]) => h('div', { key: name, className: 'sug-row', 'data-action': name, 'data-recording': recording === name },
          h('div', null, h('div', { className: 'sug-row-title' }, label), h('div', { className: 'sug-row-note' }, recording === name ? capture?.presses === 1 ? TEXT.wait + ' · Esc ' + TEXT.stop : TEXT.cancel : note)),
          shortcut(name, label)))),
        h('div', { className: 'sug-feedback', 'data-state': error ? 'error' : status, role: error ? 'alert' : 'status', 'aria-live': 'polite' },
          message ? h('span', null, message) : null,
          status === 'loadFailed' ? h('button', { type: 'button', className: 'sug-retry', onClick: () => load() }, TEXT.retry) : null),
        pickerMenu());
    }

    function SettingsEntry(props) {
      if (props.view === 'summary') return isChinese(props.language)
        ? '推荐下一条消息，也可以优化输入的草稿。' : 'Get a follow-up suggestion or improve your draft.';
      return h(SettingsCard, props);
    }

    return { inject: ['slots', 'locale'], apply(ctx) {
      installSettingsIcon(ctx);
      ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({ name: 'conversation.input.overlay', id: 'dsh-suggestions', order: 30 }, SuggestionHint));
      const label = () => 'DSH-Suggestions';
      const inject = () => ({ language: ctx.locale?.getSnapshot?.().active });
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-suggestions', label, inject, order: 40 }, SettingsCard));
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: 'dsh-suggestions', label, inject, order: 40 }, SettingsCard));
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-suggestions', inject }, SettingsEntry));
    } };
  },
});
