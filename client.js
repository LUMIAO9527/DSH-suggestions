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

      // Measure the native placeholder itself: mobile layouts and composer skins
      // own its position, typography and available width, including transitions.
      useEffect(() => {
        if (!visible) { setLayout(null); return undefined; }
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

      return h('div', { ref: anchorRef, 'data-dsh-suggestions': visible && layout ? 'hint' : 'anchor', style: visible ? { position: 'absolute', top: 0, left: 0, right: 0, height: 1, padding: 0, border: 0, pointerEvents: 'none', zIndex: 3 } : { display: 'none' } },
        visible && layout ? h('div', { 'aria-hidden': true, 'data-dsh-suggestions-text': '', style: { ...layout, position: 'absolute', display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none', background: 'transparent', whiteSpace: 'nowrap', overflow: 'hidden' } },
          h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, hint.text),
          showChip ? h('span', { role: 'button', 'aria-label': '采用这条建议', title: '按 Tab 或 → 采用这条建议', onMouseDown: event => event.preventDefault(), onClick: accept, style: { display: 'inline-flex', flex: 'none', alignItems: 'center', opacity: 0.65, pointerEvents: 'auto', cursor: 'pointer' } }, keycapSvg()) : null) : null);
    }

    return { inject: ['slots'], apply(ctx) { ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({ name: 'conversation.input.overlay', id: 'dsh-suggestions', order: 30 }, SuggestionHint)); } };
  },
});
