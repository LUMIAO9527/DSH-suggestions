/** DSH host: one suggestion per completed turn and a draft editor. */
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { LIMITS, SUGGEST_SYSTEM, OPTIMIZE_SYSTEM, boundedText, contextExcerpt, suggestionInput, optimizeInput, parseSuggestion, parseRewrite, optimizeMaxTokens, abortable } from './prompt-core.mjs';

import { VERSION } from './version.mjs';

const ROUTE_PATH = '/api/dsh-suggestions';
const BRIDGE_PATH = '/dsh-suggestions-mcp/bridge';
const BRIDGE_DIR = join(homedir(), '.dsh', 'dsh-suggestions-mcp');
const BRIDGE_FILE = join(BRIDGE_DIR, 'bridge.json');
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 64;
const noStore = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

function textOf(message) {
  if (typeof message?.content === 'string') return message.content.trim();
  return Array.isArray(message?.content) ? message.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n').trim() : '';
}

export function summarize(events) {
  let current;
  let completed;
  let lastUserSeq = -1;
  let lastAssistantSeq = -1;
  let lastEndSeq = -1;
  const history = [];
  for (const event of events) {
    if (!event) continue;
    if (event.type === 'turn/start') {
      current = { turn: event.data?.turn ?? (completed?.turn ?? 0) + 1, user: '', assistant: '', revision: event.seq };
    } else if (event.type === 'user/message') {
      // DSH persists injected instructions, runtime snapshots and skill catalogs
      // as user-role messages too. Only human-origin messages express intent.
      const source = event.data?.source?.kind;
      if (source && source !== 'user') continue;
      lastUserSeq = event.seq;
      const text = textOf(event.data);
      if (text) {
        history.push(contextExcerpt(text, LIMITS.history));
        if (history.length > LIMITS.historyCount) history.shift();
        if (current) current.user = text;
      }
    } else if (event.type === 'assistant/message') {
      lastAssistantSeq = event.seq;
      if (current) { const text = textOf(event.data?.message); if (text) current.assistant = text; }
    } else if (event.type === 'turn/end') {
      lastEndSeq = event.seq;
      if (current) {
        const kind = event.data?.reason?.kind;
        completed = { ...current, revision: event.seq, usable: !kind || kind === 'completed' || kind === 'stop' };
      }
      current = undefined;
    }
  }
  return {
    running: Boolean(current) || (lastUserSeq > lastAssistantSeq && lastUserSeq > lastEndSeq),
    turn: completed?.turn ?? 0,
    revision: completed?.revision ?? 0,
    usable: completed?.usable === true,
    lastUserText: completed?.user || '',
    lastAssistantText: completed?.assistant || '',
    recentUserTexts: history,
  };
}

function routeFromEvents(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const config = events[i]?.type === 'request/header' && events[i].data?.header?.config;
    if (config && typeof config.provider === 'string' && typeof config.model === 'string') return { provider: config.provider, model: config.model };
  }
}

export function apply(ctx, config = {}, runtime = {}) {
  // An explicit test seam keeps discovery fixtures out of the user's profile.
  const bridgeFile = runtime.bridgeFile || BRIDGE_FILE;
  const timeoutMs = Number.isInteger(config.timeoutMs) ? Math.min(45000, Math.max(1000, config.timeoutMs)) : 30000;
  const diag = message => { if (config.debug === true) ctx.logger?.info?.(`dsh-suggestions: ${message}`); };
  const cache = new Map();
  const inFlight = new Map();
  const readings = new Map();
  const failures = new Map();
  const controllers = new Set();
  const effortCache = new Map();
  const bridgeToken = randomBytes(24).toString('hex');
  let disposed = false;

  function remember(map, key, value) {
    map.delete(key);
    map.set(key, value);
    while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
  }

  async function readSession(sessionId, fresh = false) {
    if (!fresh) { const cached = readings.get(sessionId); if (cached && Date.now() - cached.at < 300) return cached; }
    const query = ctx.get('sessionQuery');
    if (!query || typeof query.observeSession !== 'function') throw new Error('session service unavailable');
    const handle = await query.observeSession(sessionId, { projectionMode: 'none' });
    try {
      const events = Array.isArray(handle?.events) ? handle.events : [];
      const entry = { at: Date.now(), summary: summarize(events), route: routeFromEvents(events) };
      if (!disposed) remember(readings, sessionId, entry);
      return entry;
    } finally { handle?.[Symbol.dispose]?.(); }
  }

  function defaultRoute() {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
    if (typeof selection?.provider === 'string' && typeof selection?.model === 'string') return { provider: selection.provider, model: selection.model };
    throw new Error('no default model selected');
  }

  async function effortFor(llm, route, signal) {
    const key = `${route.provider}/${route.model}`;
    if (effortCache.has(key)) return effortCache.get(key);
    let effort;
    try {
      const info = await abortable(llm.resolveModelInfo?.(route.provider, route.model, signal), signal);
      const efforts = info?.reasoning?.efforts || [];
      for (const id of ['none', 'off', 'minimal', 'low']) {
        const match = efforts.find(entry => entry.id?.toLowerCase() === id);
        if (match) { effort = match.id; break; }
      }
    } catch (error) { if (signal.aborted) throw error; }
    remember(effortCache, key, effort);
    return effort;
  }

  async function complete({ system, input, sessionId, route, signal, maxTokens = 1400, temperature = 0.3 }) {
    if (disposed) throw new Error('plugin disposed');
    if (controllers.size >= 3) throw new Error('model busy; try again shortly');
    if (signal?.aborted) throw signal.reason || new Error('request cancelled');
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason || new Error('request cancelled'));
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('model request timed out')), timeoutMs);
    controllers.add(controller);
    try {
      const llm = ctx.get('llm');
      if (typeof llm?.stream !== 'function') throw new Error('llm service unavailable');
      // With a session, use only that session's route. Without one, the documented
      // global default is deterministic and never borrowed from another window.
      const selected = route || (sessionId ? (await abortable(readSession(sessionId), controller.signal)).route : undefined) || defaultRoute();
      const effort = await effortFor(llm, selected, controller.signal);
      controller.signal.throwIfAborted();
      const collect = async () => {
        const chunks = [];
        let finish;
        const stream = llm.stream({ provider: selected.provider, model: selected.model, ...(sessionId ? { sessionId } : {}), ...(effort ? { reasoningEffort: effort } : {}), system, messages: [{ role: 'user', content: [{ type: 'text', text: input }] }], maxTokens, temperature, signal: controller.signal });
        for await (const chunk of stream) {
          controller.signal.throwIfAborted();
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') chunks.push(chunk.text);
          if (chunk?.type === 'finish') {
            finish = chunk.reason?.kind;
            if (finish !== 'stop') throw new Error(`model did not finish successfully (${finish || 'unknown'})`);
          }
        }
        if (finish !== 'stop') throw new Error('model stream ended without a successful finish');
        const text = chunks.join('').trim();
        if (!text) throw new Error('model returned no text');
        return text;
      };
      const raw = await abortable(collect(), controller.signal);
      diag(`model=${selected.provider}/${selected.model} chars=${raw.length}`);
      return raw;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      controllers.delete(controller);
    }
  }

  async function suggest(body, signal, route) {
    const source = {
      assistantAnswer: boundedText(body.assistantAnswer, 'assistantAnswer', LIMITS.answer, true),
      userRequest: boundedText(body.userRequest, 'userRequest', LIMITS.request),
      recentUserMessages: body.recentUserMessages || [],
    };
    if (!Array.isArray(source.recentUserMessages) || source.recentUserMessages.length > LIMITS.historyCount) throw new Error('invalid recentUserMessages');
    source.recentUserMessages = source.recentUserMessages.map(text => boundedText(text, 'recentUserMessages item', LIMITS.history));
    const raw = await complete({ system: SUGGEST_SYSTEM, input: suggestionInput(source), sessionId: body.sessionId, route, signal });
    return { suggestion: parseSuggestion(raw, source) };
  }

  async function optimize(body, signal, route) {
    const draft = boundedText(body.draft, 'draft', LIMITS.draft, true);
    const context = boundedText(body.context, 'context', LIMITS.context);
    const raw = await complete({ system: OPTIMIZE_SYSTEM, input: optimizeInput(draft, context), sessionId: body.sessionId, route, signal, maxTokens: optimizeMaxTokens(draft), temperature: 0.2 });
    return { prompt: parseRewrite(raw, draft) };
  }

  function joinTask(task, signal) {
    task.users++;
    return abortable(task.promise, signal).finally(() => {
      task.users--;
      if (task.users === 0 && !task.done) task.controller.abort(new Error('all readers cancelled'));
    });
  }

  async function suggestionsFor(sessionId, request = {}, signal) {
    const entry = await abortable(readSession(sessionId, request.fresh === true), signal);
    const summary = entry.summary;
    const afterTurn = Number.isFinite(request.afterTurn) ? request.afterTurn : 0;
    const base = { turn: summary.turn };
    if (summary.running) return { ...base, status: 'running', suggestions: [] };
    if (summary.turn <= afterTurn || !summary.usable || !summary.lastAssistantText) return { ...base, status: 'none', suggestions: [] };
    const fingerprint = createHash('sha256').update(`${summary.lastUserText}\n${summary.lastAssistantText}`).digest('hex').slice(0, 16);
    const key = `${sessionId}#${summary.turn}#${summary.revision}#${fingerprint}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { ...base, status: cached.suggestions.length ? 'ready' : 'none', suggestions: cached.suggestions };
    let task = inFlight.get(key);
    if (!task) {
      const failure = failures.get(key);
      if (failure && (failure.count >= 2 || Date.now() - failure.at < 10000)) return { ...base, status: 'none', suggestions: [] };
      if (inFlight.size >= 3) return { ...base, status: 'error', suggestions: [] };
      const controller = new AbortController();
      task = { controller, users: 0, done: false };
      task.promise = (async () => {
        const value = await suggest({
          assistantAnswer: contextExcerpt(summary.lastAssistantText, LIMITS.answer),
          userRequest: contextExcerpt(summary.lastUserText, LIMITS.request),
          recentUserMessages: summary.recentUserTexts,
          sessionId,
        }, controller.signal, entry.route);
        const suggestions = value.suggestion ? [value.suggestion] : [];
        if (!disposed && !controller.signal.aborted) remember(cache, key, { at: Date.now(), suggestions });
        return suggestions;
      })().catch(error => {
        if (!controller.signal.aborted && !disposed) remember(failures, key, { at: Date.now(), count: (failures.get(key)?.count || 0) + 1 });
        throw error;
      }).finally(() => { task.done = true; if (inFlight.get(key) === task) inFlight.delete(key); });
      inFlight.set(key, task);
    }
    try {
      const suggestions = await joinTask(task, signal);
      // Generation can finish after another window has already sent a message.
      // Never publish the old turn's result against a newer session snapshot.
      const latest = (await abortable(readSession(sessionId, true), signal)).summary;
      if (latest.running || latest.turn !== summary.turn || latest.revision !== summary.revision) return { turn: latest.turn, status: latest.running ? 'running' : 'none', suggestions: [] };
      return { ...base, status: suggestions.length ? 'ready' : 'none', suggestions };
    } catch (error) {
      if (signal?.aborted) throw error;
      diag(`suggestion failed: ${error.message}`);
      return { ...base, status: 'error', suggestions: [] };
    }
  }

  const readJsonBody = async req => {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 1_000_000) throw new Error('request body too large');
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('body must be an object');
    return body;
  };
  const sendJson = (res, status, value) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
  };

  ctx.inject(['webServer'], scope => {
    const webServer = scope.get('webServer');
    if (typeof webServer?.register !== 'function') return;
    scope.effect(() => webServer.register({ kind: 'exact', path: BRIDGE_PATH, handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
      if (req.headers['x-dsh-suggestions-token'] !== bridgeToken) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const controller = new AbortController();
      const cancel = () => controller.abort(new Error('bridge client disconnected'));
      const close = () => { if (!res.writableEnded) cancel(); };
      req.once?.('aborted', cancel);
      res.once?.('close', close);
      try {
        let body;
        try { body = await readJsonBody(req); } catch (error) { return sendJson(res, 400, { ok: false, error: error.message }); }
        if (body.sessionId !== undefined) boundedText(body.sessionId, 'sessionId', 240, true);
        const value = body.action === 'suggest' ? await suggest(body, controller.signal) : body.action === 'optimize' ? await optimize(body, controller.signal) : undefined;
        if (!value) return sendJson(res, 400, { ok: false, error: 'unknown action' });
        sendJson(res, 200, { ok: true, value });
      } catch (error) { sendJson(res, controller.signal.aborted ? 499 : 500, { ok: false, error: error.message || 'bridge failed' }); }
      finally { req.removeListener?.('aborted', cancel); res.removeListener?.('close', close); }
    } }), 'dsh-suggestions MCP bridge');
    scope.effect(() => {
      const origin = new URL(webServer.getOrigin());
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('bridge must use a loopback origin');
      mkdirSync(dirname(bridgeFile), { recursive: true });
      writeFileSync(bridgeFile, JSON.stringify({ url: origin.origin, path: BRIDGE_PATH, token: bridgeToken, version: VERSION, updatedAt: new Date().toISOString() }), { mode: 0o600 });
      return () => {
        try { if (JSON.parse(readFileSync(bridgeFile, 'utf8')).token === bridgeToken) unlinkSync(bridgeFile); } catch { /* another host may own the file */ }
      };
    }, 'dsh-suggestions bridge discovery');
  });

  ctx.inject(['connection'], scope => {
    const connection = scope.get('connection');
    if (typeof connection?.fetch?.register !== 'function') return;
    scope.effect(() => connection.fetch.register({ path: ROUTE_PATH, methods: ['POST'], requestBody: 'buffered', fetch: async request => {
      let body;
      try { body = await request.json(); } catch { return noStore({ ok: false, error: { message: 'body is not JSON' } }, 400); }
      let sessionId;
      try { sessionId = boundedText(body?.sessionId, 'sessionId', 240, true); } catch (error) { return noStore({ ok: false, error: { message: error.message } }, 400); }
      if (body.action === 'optimize') {
        try {
          boundedText(body.draft, 'draft', LIMITS.draft, true);
          const entry = await abortable(readSession(sessionId, true), request.signal);
          const context = JSON.stringify({ userRequest: contextExcerpt(entry.summary.lastUserText, 3000), assistantAnswer: contextExcerpt(entry.summary.lastAssistantText, 4000) });
          const value = await optimize({ sessionId, draft: body.draft, context }, request.signal, entry.route);
          return noStore({ ok: true, value: { status: 'ready', ...value } });
        } catch (error) { return noStore({ ok: true, value: { status: 'error' }, error: { message: error.message } }); }
      }
      if (body.action !== undefined && body.action !== 'suggest') return noStore({ ok: false, error: { message: 'unknown action' } }, 400);
      try { return noStore({ ok: true, value: await suggestionsFor(sessionId, body, request.signal) }); }
      catch (error) { return noStore({ ok: false, error: { message: error.message } }, request.signal?.aborted ? 499 : 500); }
    } }), 'dsh-suggestions composer route');
  });

  ctx.effect(() => () => {
    disposed = true;
    for (const controller of controllers) controller.abort(new Error('plugin disposed'));
    for (const task of inFlight.values()) task.controller.abort(new Error('plugin disposed'));
    cache.clear(); readings.clear(); failures.clear(); effortCache.clear(); inFlight.clear();
  }, 'dsh-suggestions lifecycle');
}
