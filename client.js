window.__ModuleLoader__.load({
  id: 'dsh-suggestions',
  factory(require) {
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

    function keycapSvg() {
      return h('svg', { width: 30, height: 18, viewBox: '0 0 30 18', 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 0.5, y: 0.5, width: 29, height: 17, rx: 4, fill: 'none', stroke: 'currentColor', strokeWidth: 1, opacity: 0.75 }),
        h('text', { x: 15, y: 12.5, textAnchor: 'middle', fontSize: 9.5, fill: 'currentColor', fontFamily: 'inherit' }, 'Tab'));
    }

    const DEFAULT_KEYS = { composer: ['Tab', 'ArrowRight'], next: ['Alt+ArrowDown'], prev: ['Alt+ArrowUp'] };
    const KEYS_EVENT = 'dsh-suggestions:keys';
    const KEY_LABELS = { Tab: 'Tab', ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', AltLeft: '左 Alt', AltRight: '右 Alt', Escape: 'Esc', Enter: 'Enter', Space: 'Space', Backspace: 'Backspace' };
    const keyLabel = binding => String(binding || '').split('+').map(code => KEY_LABELS[code] || code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ')).join('＋');
    const isChinese = language => /^zh/i.test(language || (typeof navigator !== 'undefined' ? navigator.language : ''));
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
      const altRef = useRef(null);
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
        let cancelled = false;
        fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'config' }) })
          .then(response => response.ok ? response.json() : null)
          .then(payload => { if (!cancelled && payload?.ok && payload.value?.keys) { keysRef.current = payload.value.keys; setKeys(payload.value.keys); } })
          .catch(() => {});
        const onKeys = event => { if (event?.detail) { keysRef.current = event.detail; setKeys(event.detail); } };
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
        altRef.current = null;
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
        altRef.current = null;
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

      // Measure the native placeholder itself: mobile layouts and composer skins
      // own its position, typography and available width, including transitions.
      useLayoutEffect(() => {
        if (!showing) { setLayout(null); return undefined; }
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
          const anchor = anchorRef.current;
          const next = composerPlaceholder(composerEditor(anchor));
          if (next !== placeholder) {
            restore();
            placeholder = next;
            oldVisibility = placeholder?.style.getPropertyValue('visibility') || '';
            oldPriority = placeholder?.style.getPropertyPriority('visibility') || '';
          }
          const measured = placeholderLayout(anchor, placeholder);
          if (measured) {
            if (placeholder.style.getPropertyValue('visibility') !== 'hidden' || placeholder.style.getPropertyPriority('visibility') !== 'important') placeholder.style.setProperty('visibility', 'hidden', 'important');
          } else restore();
          const key = JSON.stringify(measured);
          if (key !== previous) { previous = key; setLayout(measured); }
          frame = window.requestAnimationFrame(update);
        };
        update();
        return () => {
          window.cancelAnimationFrame(frame);
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
          if (event.isComposing || event.keyCode === 229 || event.repeat) { keyRef.current = {}; altRef.current = null; return; }
          const code = keyCode(event);
          const editor = composerEditor(anchorRef.current);
          if (!editor || !(document.activeElement === editor || editor.contains(document.activeElement))) { keyRef.current = {}; altRef.current = null; return; }
          const current = activeRef.current;
          if (!current.idle || current.sending || current.runningTurn) { keyRef.current = {}; altRef.current = null; return; }
          const binding = keyBinding(event);
          const browse = binding === keysRef.current.next[0] ? 1 : binding === keysRef.current.prev[0] ? -1 : 0;
          if (browse) {
            if (!current.empty) { altRef.current = null; browsePressRef.current = ''; return; }
            const at = Date.now();
            const previousAlt = altRef.current;
            const doubledAlt = previousAlt?.code === code && at - previousAlt.at <= 500;
            altRef.current = doubledAlt ? null : { code, at };
            browsePressRef.current = code;
            keyRef.current = {};
            event.preventDefault(); event.stopPropagation();
            if (binding.includes('+') || doubledAlt) step(browse);
            return;
          }
          altRef.current = null;
          browsePressRef.current = '';
          if ((event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) && !keysRef.current.composer.includes(binding)) { keyRef.current = {}; altRef.current = null; return; }
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
          const composerKeys = keysRef.current.composer;
          const shortcut = composerKeys.includes(binding);
          const previous = keyRef.current;
          const mode = current.empty ? 'empty' : 'draft';
          const doubled = previous.key === binding && previous.mode === mode && previous.draft === current.draft && now - previous.at <= 500;
          // A second press in the same acceptance gesture must not optimize
          // the suggestion that the first press has just inserted.
          if (shortcut && previous.mode === 'accepted' && previous.draft === current.draft && now - previous.at <= 500) { event.preventDefault(); event.stopPropagation(); return; }
          if (current.empty) {
            if (visible && shortcut && !doubled) { event.preventDefault(); event.stopPropagation(); accept(); return; }
            if (!shortcut) { keyRef.current = {}; return; }
          } else if (!shortcut || (code === 'ArrowRight' && !caretAtEnd(editor))) {
            keyRef.current = {};
            return;
          }
          // Keep focus in the editor for the second Tab; a lone Right remains
          // native caret movement when no suggestion is being accepted.
          if (doubled || (shortcut && code !== 'ArrowRight')) { event.preventDefault(); event.stopPropagation(); }
          keyRef.current = doubled ? {} : { key: binding, mode, draft: current.draft, at: now };
          if (doubled) { if (current.empty) generate(); else optimize(); }
        };
        const onKeyUp = event => {
          if (!browsePressRef.current || ![browsePressRef.current, 'AltLeft', 'AltRight'].includes(keyCode(event))) return;
          // A handled bare Alt must not hand focus to the browser/menu on release.
          event.preventDefault(); event.stopPropagation(); browsePressRef.current = '';
        };
        const resetKeys = () => { keyRef.current = {}; altRef.current = null; browsePressRef.current = ''; };
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', resetKeys);
        window.addEventListener('focusout', resetKeys, true);
        return () => { window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp, true); window.removeEventListener('blur', resetKeys); window.removeEventListener('focusout', resetKeys, true); };
      }, [sessionId, visible, hintKey, accept, generate, optimize, step, feedback]);

      const deck = deckRef.current;
      const browseButton = (direction, label) => h('button', { type: 'button', 'aria-label': label, title: label,
        disabled: direction < 0 ? deck.index <= 0 : generating,
        onMouseDown: event => event.preventDefault(), onClick: () => step(direction),
        style: { border: 0, background: 'transparent', color: 'inherit', padding: '0 5px', minWidth: 28, minHeight: 0, font: 'inherit', cursor: 'pointer', pointerEvents: 'auto', touchAction: 'manipulation' } }, direction < 0 ? '‹' : '›');
      return h('div', { ref: anchorRef, 'data-dsh-suggestions': showing && layout ? (visible ? 'hint' : generating ? 'generating' : 'status') : 'anchor', style: showing ? { position: 'absolute', top: 0, left: 0, right: 0, height: 1, padding: 0, border: 0, pointerEvents: 'none', zIndex: 3 } : { display: 'none' } },
        showing && layout ? h('div', { 'data-dsh-suggestions-text': '', style: { ...layout, position: 'absolute', display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none', background: 'transparent', whiteSpace: 'nowrap', overflow: 'hidden' } },
          h('span', { 'aria-hidden': visible ? true : undefined, role: visible ? undefined : 'status', style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, visible ? hint.text : generating ? generatingLabel : feedback?.text),
          visible && showChip ? h('span', { role: 'button', 'aria-label': '采用这条建议', title: keys.composer.map(keyLabel).join(' / '), onMouseDown: event => event.preventDefault(), onClick: accept, style: { display: 'inline-flex', flex: 'none', alignItems: 'center', opacity: 0.65, pointerEvents: 'auto', cursor: 'pointer' } }, keycapSvg()) : null,
          deck.items.length > 0 ? h('span', { 'data-dsh-suggestions-pager': '', style: { flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 0, opacity: 0.7, pointerEvents: 'auto' } },
            browseButton(-1, (isChinese() ? '上一条' : 'Previous') + ' (' + keyLabel(keys.prev[0]) + ')'),
            h('span', { 'data-dsh-suggestions-page': '', style: { fontSize: '11px', minWidth: 22, textAlign: 'center' } }, `${deck.index + 1}/${deck.items.length}`),
            browseButton(1, (isChinese() ? '下一条' : 'Next') + ' (' + keyLabel(keys.next[0]) + ')')) : null) : null);
    }

    const CARD_BUTTON = { border: '1px solid currentColor', borderRadius: 6, background: 'transparent', color: 'inherit', padding: '2px 10px', fontSize: 12, cursor: 'pointer', opacity: 0.85 };

    // Shown inside Settings (and the Plugins page when the host serves the
    // bundle form). The card only talks to the host route, so the composer and
    // the form can never disagree about what is saved.
    function SettingsCard({ language } = {}) {
      const zh = isChinese(language);
      const TEXT = zh ? {
        title: '输入框建议',
        hint: '点“修改”后按下按键或组合键。',
        composer: '采纳 / 生成 / 优化',
        composerNote: '单击采纳，双击生成或优化草稿',
        next: '翻到下一条',
        prev: '翻回上一条',
        press: '按下按键…',
        change: '修改',
        save: '保存',
        reset: '恢复默认',
        saved: '已保存，立即生效',
        conflict: '两个动作不能用同一个键',
        failed: '保存失败',
      } : {
        title: 'Composer suggestions',
        hint: 'Click Change, then press a key or key combination.',
        composer: 'Accept / generate / optimize',
        composerNote: 'Press once to accept, twice to generate or improve the draft',
        next: 'Browse forward',
        prev: 'Browse back',
        press: 'Press a key…',
        change: 'Change',
        save: 'Save',
        reset: 'Reset',
        saved: 'Saved and applied',
        conflict: 'Two actions cannot share a key',
        failed: 'Save failed',
      };
      const ROWS = [['composer', TEXT.composer, TEXT.composerNote], ['next', TEXT.next, ''], ['prev', TEXT.prev, '']];
      const [draft, setDraft] = useState(null);
      const [recording, setRecording] = useState('');
      const [status, setStatus] = useState('');
      const [busy, setBusy] = useState(false);

      useEffect(() => {
        let cancelled = false;
        fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'config' }) })
          .then(response => response.ok ? response.json() : null)
          .then(payload => { if (!cancelled && payload?.ok && payload.value?.keys) setDraft(payload.value.keys); })
          .catch(() => {});
        return () => { cancelled = true; };
      }, []);

      useEffect(() => {
        if (!recording) return undefined;
        const onKey = event => {
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Escape') { setRecording(''); return; }
          if (['Shift', 'Control', 'Meta', 'Alt', 'AltGraph', 'CapsLock', 'Fn'].includes(event.key)) return;
          const binding = keyBinding(event);
          if (!binding) return;
          setDraft(current => ({ ...(current || DEFAULT_KEYS), [recording]: [binding] }));
          setRecording('');
          setStatus('');
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
      }, [recording]);

      const conflicts = keys => keys.composer.includes(keys.next[0]) || keys.composer.includes(keys.prev[0]) || keys.next[0] === keys.prev[0];
      const save = async next => {
        if (conflicts(next)) { setStatus(TEXT.conflict); return; }
        setBusy(true); setStatus('');
        try {
          const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'config', keys: next }) });
          const payload = await response.json();
          if (!payload?.ok) throw new Error(payload?.error?.message || TEXT.failed);
          setDraft(payload.value.keys);
          window.dispatchEvent(new CustomEvent(KEYS_EVENT, { detail: payload.value.keys }));
          setStatus(TEXT.saved);
        } catch (error) { setStatus(String(error?.message || TEXT.failed)); }
        finally { setBusy(false); }
      };
      const keys = draft || DEFAULT_KEYS;

      return h('div', { 'data-dsh-suggestions-settings': '', style: { padding: '16px 0', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 } },
        h('div', { style: { fontWeight: 600 } }, TEXT.title),
        h('div', { style: { opacity: 0.6, fontSize: 12 } }, TEXT.hint),
        ROWS.map(([name, label, note]) => h('div', { key: name, style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
          h('div', { style: { minWidth: 0 } },
            h('div', null, label),
            note ? h('div', { style: { opacity: 0.5, fontSize: 11 } }, note) : null),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: 'none' } },
            h('code', { style: { fontFamily: 'inherit', fontSize: 12, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(127,127,127,0.35)' } }, keys[name].map(keyLabel).join(' / ')),
            h('button', { type: 'button', onClick: () => { setRecording(recording === name ? '' : name); setStatus(''); }, style: CARD_BUTTON }, recording === name ? TEXT.press : TEXT.change)))),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 } },
          h('button', { type: 'button', disabled: busy, onClick: () => save(keys), style: CARD_BUTTON }, TEXT.save),
          h('button', { type: 'button', disabled: busy, onClick: () => save(DEFAULT_KEYS), style: CARD_BUTTON }, TEXT.reset),
          status ? h('span', { style: { opacity: 0.65, fontSize: 12 } }, status) : null));
    }

    return { inject: ['slots'], apply(ctx) {
      ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({ name: 'conversation.input.overlay', id: 'dsh-suggestions', order: 30 }, SuggestionHint));
      const label = () => isChinese(ctx.locale?.getSnapshot?.().active) ? '输入框建议' : 'Composer suggestions';
      const inject = () => ({ language: ctx.locale?.getSnapshot?.().active });
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-suggestions', label, inject, order: 40 }, SettingsCard));
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: 'dsh-suggestions', label, inject, order: 40 }, SettingsCard));
    } };
  },
});
