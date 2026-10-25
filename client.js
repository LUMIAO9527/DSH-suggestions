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
      const anchorRef = useRef(null);
      const consumedTurnRef = useRef(0);
      const sentTurnRef = useRef(0);
      const lastTurnRef = useRef(0);
      const lastEmptyAtRef = useRef(0);
      const previousDraftRef = useRef(draft);
      const keyRef = useRef({});
      const generationRef = useRef(null);
      const optimizationRef = useRef(null);
      const candidatesRef = useRef([]);
      const candidateIndexRef = useRef(-1);
      const shownRef = useRef('');
      const altRef = useRef(null);
      const adoptedRef = useRef(null);
      const activeRef = useRef(null);
      activeRef.current = { sessionId, draft, empty, idle, runningTurn, sending };
      const hintKey = hint ? `${hint.sessionId}#${hint.turn}` : '';
      const visible = Boolean(hint?.text) && hint.sessionId === sessionId && empty && idle && !runningTurn && !sending && dismissedKey !== hintKey;
      const shouldPoll = Boolean(sessionId) && empty && idle && !runningTurn && !sending && !generating;

      const clearHint = useCallback(() => {
        shownRef.current = '';
        setHint(null);
      }, []);

      // Deleting an adopted suggestion brings that same candidate back without
      // another model call, and the browsing cursor stays where it was.
      const restoreAdopted = useCallback(() => {
        const adopted = adoptedRef.current;
        if (!adopted) return;
        const index = candidatesRef.current.indexOf(adopted.text);
        if (index < 0) return;
        candidateIndexRef.current = index;
        shownRef.current = adopted.text;
        setDismissedKey('');
        setHint({ sessionId: activeRef.current.sessionId, turn: lastTurnRef.current, text: adopted.text });
      }, []);

      useEffect(() => {
        consumedTurnRef.current = 0;
        sentTurnRef.current = 0;
        lastTurnRef.current = 0;
        lastEmptyAtRef.current = 0;
        previousDraftRef.current = draft;
        keyRef.current = {};
        candidatesRef.current = [];
        candidateIndexRef.current = -1;
        adoptedRef.current = null;
        setGenerating(false);
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
        candidatesRef.current = [];
        candidateIndexRef.current = -1;
        adoptedRef.current = null;
        clearHint();
        optimizationRef.current?.controller.abort();
        optimizationRef.current = null;
        generationRef.current?.controller.abort();
        generationRef.current = null;
        setGenerating(false);
        keyRef.current = {};
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
            lastTurnRef.current = Math.max(lastTurnRef.current, turn);
            if (value?.status === 'running') {
              consumedTurnRef.current = Math.max(consumedTurnRef.current, lastTurnRef.current);
              sentTurnRef.current = Math.max(sentTurnRef.current, consumedTurnRef.current);
              clearHint();
              schedule(3500);
            } else if (value?.status === 'ready' && typeof value.suggestions?.[0] === 'string' && turn > consumedTurnRef.current) {
              const text = value.suggestions[0].trim();
              lastTurnRef.current = turn;
              // Polling supplies the suggestion of a turn; it must never move the
              // cursor while a candidate is already on screen.
              if (!text) clearHint();
              else if (!shownRef.current) present(text, turn);
              backoff = POLL_MS;
              schedule(5000); // Also notice turns sent from another window.
            } else {
              clearHint();
              backoff = Math.min(Math.round(backoff * 1.4), MAX_BACKOFF_MS);
              schedule(value?.status === 'error' ? Math.max(5000, backoff) : backoff);
            }
          } catch {
            if (!cancelled) { clearHint(); backoff = Math.min(backoff * 2, MAX_BACKOFF_MS); schedule(backoff); }
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

      // Show a suggestion and make it the cursor of the candidate list. A text
      // already seen this session is revisited instead of duplicated, so Up can
      // walk back through what was offered before.
      const present = useCallback((text, turn) => {
        const trimmed = typeof text === 'string' ? text.trim() : '';
        if (!trimmed) return;
        const list = candidatesRef.current;
        const existing = list.lastIndexOf(trimmed);
        if (existing >= 0) candidateIndexRef.current = existing;
        else {
          list.push(trimmed);
          if (list.length > MAX_CANDIDATES) list.shift();
          candidateIndexRef.current = list.length - 1;
        }
        shownRef.current = trimmed;
        setHint({ sessionId: activeRef.current.sessionId, turn, text: trimmed });
        setShowChip(hintUses(`${activeRef.current.sessionId}#${turn}`) <= 3);
      }, []);

      const accept = useCallback(() => {
        const active = activeRef.current;
        if (!visible || !hint || active.sessionId !== sessionId || !active.empty || !active.idle || active.sending || active.runningTurn) return;
        const editor = composerEditor(anchorRef.current);
        keyRef.current = { mode: 'accepted', at: Date.now(), draft: hint.text };
        inputActions.setDraft(hint.text);
        consumedTurnRef.current = Math.max(consumedTurnRef.current, hint.turn);
        adoptedRef.current = { text: hint.text };
        clearHint();
        editor?.focus();
      }, [visible, hint, sessionId, inputActions, clearHint]);

      const generate = useCallback(async () => {
        const state = activeRef.current;
        if (!state.sessionId || !state.empty || !state.idle || state.sending || state.runningTurn || generationRef.current) return;
        const pending = { sessionId: state.sessionId, controller: new AbortController() };
        generationRef.current = pending;
        setGenerating(true);
        clearHint();
        const timeout = setTimeout(() => pending.controller.abort(), 40000);
        try {
          const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: pending.controller.signal, body: JSON.stringify({ sessionId: pending.sessionId, action: 'suggest', manual: true, fresh: true, afterTurn: sentTurnRef.current || undefined }) });
          if (!response.ok) return;
          const payload = await response.json();
          const result = payload?.ok ? payload.value : undefined;
          const current = activeRef.current;
          if (pending.controller.signal.aborted || generationRef.current !== pending || current.sessionId !== pending.sessionId || !current.empty || !current.idle || current.sending || current.runningTurn) return;
          const turn = Number(result?.turn) || 0;
          lastTurnRef.current = Math.max(lastTurnRef.current, turn);
          if (result?.status === 'running') {
            consumedTurnRef.current = Math.max(consumedTurnRef.current, turn);
            sentTurnRef.current = Math.max(sentTurnRef.current, turn);
          } else if (result?.status === 'ready' && turn > sentTurnRef.current && typeof result.suggestions?.[0] === 'string' && result.suggestions[0].trim()) {
            consumedTurnRef.current = sentTurnRef.current;
            setDismissedKey('');
            present(result.suggestions[0], turn);
          }
        } catch { /* Leave the composer available when no suggestion is returned. */ }
        finally {
          clearTimeout(timeout);
          if (generationRef.current === pending) { generationRef.current = null; setGenerating(false); }
        }
      }, [present, clearHint]);

      // Up walks back through candidates already shown; Down moves forward and
      // asks for a new one once the tail is reached.
      const step = useCallback(direction => {
        const list = candidatesRef.current;
        const index = candidateIndexRef.current;
        if (direction < 0) {
          if (index <= 0 || !list[index - 1]) return;
          candidateIndexRef.current = index - 1;
          shownRef.current = list[index - 1];
          setDismissedKey('');
          setHint({ sessionId: activeRef.current.sessionId, turn: lastTurnRef.current, text: list[index - 1] });
          return;
        }
        if (index >= 0 && index < list.length - 1) {
          candidateIndexRef.current = index + 1;
          shownRef.current = list[index + 1];
          setDismissedKey('');
          setHint({ sessionId: activeRef.current.sessionId, turn: lastTurnRef.current, text: list[index + 1] });
          return;
        }
        generate();
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
          if (event.isComposing || event.keyCode === 229 || event.repeat) { keyRef.current = {}; return; }
          const editor = composerEditor(anchorRef.current);
          if (!editor || !(document.activeElement === editor || editor.contains(document.activeElement))) { keyRef.current = {}; altRef.current = null; return; }
          const current = activeRef.current;
          if (!current.idle || current.sending || current.runningTurn) { keyRef.current = {}; altRef.current = null; return; }
          // Alt on its own browses the candidates: Right Alt moves forward and asks
          // for a new one at the tail, Left Alt walks back. It stays native once
          // the composer holds a draft, and any other key cancels the gesture.
          if (event.key === 'Alt' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            if (!current.empty || (!hintKey && candidateIndexRef.current < 0)) { altRef.current = null; return; }
            const at = Date.now();
            const code = event.code === 'AltRight' ? 'AltRight' : 'AltLeft';
            const previousAlt = altRef.current;
            const doubledAlt = previousAlt?.code === code && at - previousAlt.at <= 500;
            altRef.current = doubledAlt ? null : { code, at };
            event.preventDefault();
            if (doubledAlt) step(code === 'AltRight' ? 1 : -1);
            return;
          }
          if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) { keyRef.current = {}; altRef.current = null; return; }
          if (event.key === 'Escape' && (visible || generationRef.current)) {
            setDismissedKey(hintKey || `${sessionId}#${lastTurnRef.current}`);
            generationRef.current?.controller.abort();
            generationRef.current = null;
            setGenerating(false);
            keyRef.current = {};
            return;
          }
          const now = Date.now();
          const shortcut = event.key === 'Tab' || event.key === 'ArrowRight';
          const previous = keyRef.current;
          const mode = current.empty ? 'empty' : 'draft';
          const doubled = previous.key === event.key && previous.mode === mode && previous.draft === current.draft && now - previous.at <= 500;
          // A second press in the same acceptance gesture must not optimize
          // the suggestion that the first press has just inserted.
          if (shortcut && previous.mode === 'accepted' && previous.draft === current.draft && now - previous.at <= 500) { event.preventDefault(); event.stopPropagation(); return; }
          if (current.empty) {
            if (visible && shortcut && !doubled) { event.preventDefault(); event.stopPropagation(); accept(); return; }
            if (!shortcut) { keyRef.current = {}; return; }
          } else if (event.key !== 'Tab' && !(event.key === 'ArrowRight' && caretAtEnd(editor))) {
            keyRef.current = {};
            return;
          }
          // Keep focus in the editor for the second Tab; a lone Right remains
          // native caret movement when no suggestion is being accepted.
          if (event.key === 'Tab' || doubled) { event.preventDefault(); event.stopPropagation(); }
          keyRef.current = doubled ? {} : { key: event.key, mode, draft: current.draft, at: now };
          if (doubled) { if (current.empty) generate(); else optimize(); }
        };
        const resetKeys = () => { keyRef.current = {}; altRef.current = null; };
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('blur', resetKeys);
        window.addEventListener('focusout', resetKeys, true);
        return () => { window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('blur', resetKeys); window.removeEventListener('focusout', resetKeys, true); };
      }, [sessionId, visible, hintKey, accept, generate, optimize, step]);

      return h('div', { ref: anchorRef, 'data-dsh-suggestions': visible && layout ? 'hint' : 'anchor', style: visible ? { position: 'absolute', top: 0, left: 0, right: 0, height: 1, padding: 0, border: 0, pointerEvents: 'none', zIndex: 3 } : { display: 'none' } },
        visible && layout ? h('div', { 'aria-hidden': true, 'data-dsh-suggestions-text': '', style: { ...layout, position: 'absolute', display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none', background: 'transparent', whiteSpace: 'nowrap', overflow: 'hidden' } },
          h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, hint.text),
          showChip ? h('span', { role: 'button', 'aria-label': '采用这条建议', title: '按 Tab 或 → 采用这条建议；双击 ↑ / ↓ 翻看', onMouseDown: event => event.preventDefault(), onClick: accept, style: { display: 'inline-flex', flex: 'none', alignItems: 'center', opacity: 0.65, pointerEvents: 'auto', cursor: 'pointer' } }, keycapSvg()) : null) : null);
    }

    return { inject: ['slots'], apply(ctx) { ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({ name: 'conversation.input.overlay', id: 'dsh-suggestions', order: 30 }, SuggestionHint)); } };
  },
});
