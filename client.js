window.__ModuleLoader__.load({
  id: 'dsh-suggestions',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;
    const ENDPOINT = 'api/dsh-suggestions';
    const POLL_MS = 2500;
    const MAX_BACKOFF_MS = 15000;
    const HINT_USES_KEY = 'dsh-suggestions.hint-uses.v2';

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
      let parent = anchor && anchor.parentElement;
      for (let i = 0; parent && i < 7 && parent !== document.body; i++, parent = parent.parentElement) {
        const editor = parent.querySelector('[contenteditable="true"]');
        if (editor) return editor;
      }
      return null;
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
      const [focused, setFocused] = useState(false);
      const anchorRef = useRef(null);
      const consumedTurnRef = useRef(0);
      const lastTurnRef = useRef(0);
      const lastEmptyAtRef = useRef(0);
      const previousDraftRef = useRef(draft);
      const keyRef = useRef({ tab: 0, arrow: 0 });
      const optimizationRef = useRef(null);
      const activeRef = useRef(null);
      activeRef.current = { sessionId, draft, empty, idle, runningTurn, sending };
      const hintKey = hint ? `${hint.sessionId}#${hint.turn}` : '';
      const visible = Boolean(hint?.text) && hint.sessionId === sessionId && empty && idle && !runningTurn && !sending && dismissedKey !== hintKey;
      const shouldPoll = Boolean(sessionId) && empty && idle && !runningTurn && !sending;

      useEffect(() => {
        consumedTurnRef.current = 0;
        lastTurnRef.current = 0;
        lastEmptyAtRef.current = 0;
        previousDraftRef.current = draft;
        keyRef.current = { tab: 0, arrow: 0 };
        setHint(null);
        setDismissedKey('');
        setShowChip(false);
        return () => {
          optimizationRef.current?.controller.abort();
          optimizationRef.current = null;
        };
      }, [sessionId]);

      // Ordinary DSH sends deliberately keep phase="plain". The synchronous
      // local submission echo, not phase or an empty draft, marks a real send.
      useEffect(() => {
        if (!sending && !runningTurn) return;
        consumedTurnRef.current = Math.max(consumedTurnRef.current, lastTurnRef.current);
        lastEmptyAtRef.current = Date.now();
        setHint(null);
        optimizationRef.current?.controller.abort();
        optimizationRef.current = null;
      }, [sessionId, pendingSubmissionKey, runningTurn]);

      useEffect(() => {
        if (previousDraftRef.current.trim() && !draft.trim()) lastEmptyAtRef.current = Date.now();
        previousDraftRef.current = draft;
        if (draft.trim() || !idle) setHint(null);
        if (phase === 'submitting' || phase === 'adjudicating') {
          consumedTurnRef.current = Math.max(consumedTurnRef.current, lastTurnRef.current);
          lastEmptyAtRef.current = Date.now();
        }
        const pending = optimizationRef.current;
        if (pending && (pending.sessionId !== sessionId || pending.draft !== draft || !idle)) {
          pending.controller.abort();
          optimizationRef.current = null;
        }
      }, [draft, idle, phase, sessionId]);

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
            lastTurnRef.current = Math.max(lastTurnRef.current, turn);
            if (value?.status === 'running') {
              consumedTurnRef.current = Math.max(consumedTurnRef.current, lastTurnRef.current);
              setHint(null);
              schedule(3500);
            } else if (value?.status === 'ready' && typeof value.suggestions?.[0] === 'string' && turn > consumedTurnRef.current) {
              const text = value.suggestions[0].trim();
              lastTurnRef.current = turn;
              setHint(text ? { sessionId, turn, text } : null);
              setShowChip(hintUses(`${sessionId}#${turn}`) <= 3);
              backoff = POLL_MS;
              schedule(5000); // Also notice turns sent from another window.
            } else {
              setHint(null);
              backoff = Math.min(Math.round(backoff * 1.4), MAX_BACKOFF_MS);
              schedule(value?.status === 'error' ? Math.max(5000, backoff) : backoff);
            }
          } catch {
            if (!cancelled) { setHint(null); backoff = Math.min(backoff * 2, MAX_BACKOFF_MS); schedule(backoff); }
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

      // Scope placeholder changes and keyboard handling to this composer, not
      // every editor rendered in the document.
      useEffect(() => {
        if (!visible) return undefined;
        const editor = composerEditor(anchorRef.current);
        let parent = editor?.parentElement;
        let placeholder;
        for (let i = 0; parent && i < 5; i++, parent = parent.parentElement) {
          placeholder = parent.querySelector('[data-composer-placeholder]');
          if (placeholder) break;
        }
        const oldVisibility = placeholder?.style.getPropertyValue('visibility') || '';
        const oldPriority = placeholder?.style.getPropertyPriority('visibility') || '';
        placeholder?.style.setProperty('visibility', 'hidden', 'important');
        const update = () => setFocused(Boolean(editor && (document.activeElement === editor || editor.contains(document.activeElement))));
        update();
        document.addEventListener('focusin', update, true);
        document.addEventListener('focusout', update, true);
        return () => {
          if (placeholder) {
            if (oldVisibility) placeholder.style.setProperty('visibility', oldVisibility, oldPriority);
            else placeholder.style.removeProperty('visibility');
          }
          document.removeEventListener('focusin', update, true);
          document.removeEventListener('focusout', update, true);
        };
      }, [visible, sessionId]);

      const accept = useCallback(() => {
        const active = activeRef.current;
        if (!visible || !hint || active.sessionId !== sessionId || !active.empty || !active.idle || active.sending || active.runningTurn) return;
        const editor = composerEditor(anchorRef.current);
        inputActions.setDraft(hint.text);
        consumedTurnRef.current = Math.max(consumedTurnRef.current, hint.turn);
        setHint(null);
        editor?.focus();
      }, [visible, hint, sessionId, inputActions]);

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
          if (event.isComposing || event.keyCode === 229 || event.repeat || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
          const editor = composerEditor(anchorRef.current);
          if (!editor || !(document.activeElement === editor || editor.contains(document.activeElement))) return;
          const current = activeRef.current;
          if (!current.idle) return;
          if (event.key === 'Escape' && visible) { setDismissedKey(hintKey); return; }
          if (current.empty) {
            if (visible && (event.key === 'Tab' || event.key === 'ArrowRight')) { event.preventDefault(); event.stopPropagation(); accept(); }
            return;
          }
          const now = Date.now();
          if (event.key === 'Tab') {
            event.preventDefault(); event.stopPropagation();
            if (keyRef.current.tab && now - keyRef.current.tab <= 500) { keyRef.current.tab = 0; optimize(); }
            else keyRef.current.tab = now;
            keyRef.current.arrow = 0;
          } else if (event.key === 'ArrowRight' && caretAtEnd(editor)) {
            if (keyRef.current.arrow && now - keyRef.current.arrow <= 500) { keyRef.current.arrow = 0; event.preventDefault(); event.stopPropagation(); optimize(); }
            else keyRef.current.arrow = now;
            keyRef.current.tab = 0;
          } else keyRef.current = { tab: 0, arrow: 0 };
        };
        const resetKeys = () => { keyRef.current = { tab: 0, arrow: 0 }; };
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('blur', resetKeys);
        return () => { window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('blur', resetKeys); };
      }, [sessionId, visible, hintKey, accept, optimize]);

      if (!visible) return h('span', { ref: anchorRef, 'data-dsh-suggestions': 'anchor', style: { display: 'none' } });
      return h('div', { ref: anchorRef, 'data-dsh-suggestions': 'hint', style: { position: 'absolute', top: 0, left: 0, right: 0, height: 0, pointerEvents: 'none', zIndex: 3 } },
        h('div', { 'aria-hidden': true, style: { position: 'absolute', left: 14, top: 12, right: 8, height: 24, pointerEvents: 'none', background: 'transparent', color: 'var(--dsw-alias-label-caption)', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', lineHeight: '24px', whiteSpace: 'nowrap', overflow: 'hidden' } },
          h('span', { style: { display: 'inline-block', maxWidth: showChip ? 'calc(100% - 40px)' : '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle', marginLeft: focused ? 2 : 0 } }, hint.text),
          showChip ? h('span', { role: 'button', 'aria-label': '采用这条建议', title: '按 Tab 或 → 采用这条建议', onMouseDown: event => event.preventDefault(), onClick: accept, style: { display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', marginLeft: 8, color: 'var(--dsw-alias-label-caption)', opacity: 0.65, pointerEvents: 'auto', cursor: 'pointer' } }, keycapSvg()) : null));
    }

    return { inject: ['slots'], apply(ctx) { ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({ name: 'conversation.input.overlay', id: 'dsh-suggestions', order: 30 }, SuggestionHint)); } };
  },
});
