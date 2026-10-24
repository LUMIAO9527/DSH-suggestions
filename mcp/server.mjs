#!/usr/bin/env node
/** stdio MCP companion for the DSH suggestions bundle. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, SUGGEST_SYSTEM, OPTIMIZE_SYSTEM, boundedText, validateTurns, suggestionInput, optimizeInput, parseSuggestion, parseRewrite, optimizeMaxTokens } from '../prompt-core.mjs';

import { VERSION } from '../version.mjs';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_FRAME_BYTES = 10 * 1024 * 1024;
const MAX_CONCURRENT = 2;
const MAX_QUEUED = 8;
const sessionProperty = { type: 'string', maxLength: 240, minLength: 1, description: 'DSH session ID. Uses the session model, or the DSH default when omitted.' };
const TOOLS = [
  { name: 'suggest_next_prompt', description: 'Suggest one follow-up prompt from the user request and completed answer.', inputSchema: {
    type: 'object', properties: {
      assistantAnswer: { type: 'string', minLength: 1, maxLength: LIMITS.answer, description: 'The completed assistant answer.' },
      userRequest: { type: 'string', maxLength: LIMITS.request, description: 'The actual latest user request, including its constraints.' },
      recentUserMessages: { type: 'array', maxItems: LIMITS.historyCount, items: { type: 'string', maxLength: LIMITS.history }, description: 'Recent user instructions or corrections, oldest first.' },
      recentTurns: { type: 'array', maxItems: LIMITS.turns, description: 'Previous user/assistant exchanges, oldest first; omit the latest exchange provided above.', items: { type: 'object', properties: { user: { type: 'string', minLength: 1, maxLength: LIMITS.turnUser }, assistant: { type: 'string', maxLength: LIMITS.turnAnswer } }, required: ['user'], additionalProperties: false } },
      sessionId: sessionProperty,
    }, required: ['assistantAnswer'], additionalProperties: false,
  } },
  { name: 'optimize_prompt', description: 'Improve a draft while preserving its intent, constraints, paths and numbers.', inputSchema: {
    type: 'object', properties: {
      draft: { type: 'string', minLength: 1, maxLength: LIMITS.draft },
      context: { type: 'string', maxLength: LIMITS.context, description: 'Recent conversation context for resolving references.' },
      sessionId: sessionProperty,
    }, required: ['draft'], additionalProperties: false,
  } },
];

class ToolError extends Error {}
class InvalidParams extends Error {}
const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const textResult = (text, isError = false) => text ? { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) } : { content: [], structuredContent: { status: 'none' } };
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateArguments(name, args) {
  const tool = TOOLS.find(tool => tool.name === name);
  if (!tool) throw new InvalidParams(`unknown tool: ${name}`);
  if (!plainObject(args)) throw new InvalidParams('arguments must be an object');
  for (const key of Object.keys(args)) if (!Object.hasOwn(tool.inputSchema.properties, key)) throw new InvalidParams(`unexpected argument: ${key}`);
  for (const key of tool.inputSchema.required) if (!(key in args)) throw new InvalidParams(`${key} is required`);
  const value = {};
  try {
    for (const [key, item] of Object.entries(args)) {
      const schema = tool.inputSchema.properties[key];
      if (key === 'recentTurns') value[key] = validateTurns(item);
      else if (schema.type === 'array') {
        if (!Array.isArray(item) || item.length > schema.maxItems) throw new Error(`${key} must be an array of at most ${schema.maxItems} strings`);
        value[key] = item.map(text => boundedText(text, `${key} item`, schema.items.maxLength));
      } else value[key] = boundedText(item, key, schema.maxLength, tool.inputSchema.required.includes(key) || key === 'sessionId');
    }
  } catch (error) { throw new InvalidParams(error.message); }
  return value;
}

function bridgeConfig() {
  if (process.env.DSS_BRIDGE === 'off') return undefined;
  const file = process.env.DSS_BRIDGE_FILE || join(homedir(), '.dsh', 'dsh-suggestions-mcp', 'bridge.json');
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new ToolError('DSH bridge discovery is unreadable; retry after the plugin has loaded');
  }
  try {
    const url = new URL(data.url);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    const path = data.path || '/dsh-suggestions-mcp/bridge';
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || typeof data.token !== 'string' || !data.token) throw new Error();
    return { url: `${url.origin}${path}`, token: data.token };
  } catch { throw new ToolError('DSH bridge configuration is invalid; refusing a non-local or ambiguous endpoint'); }
}

function directConfig() {
  const timeout = Number(process.env.DSS_LLM_TIMEOUT_MS || 30000);
  return { baseUrl: (process.env.DSS_LLM_BASE_URL || '').trim(), apiKey: (process.env.DSS_LLM_API_KEY || '').trim(), model: (process.env.DSS_LLM_MODEL || '').trim(), timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 45000) : 30000 };
}

async function callBridge(bridge, name, args, signal) {
  let response;
  try {
    response = await fetch(bridge.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-suggestions-token': bridge.token }, body: JSON.stringify({ action: name === 'suggest_next_prompt' ? 'suggest' : 'optimize', ...args }), signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]), redirect: 'error' });
  } catch (error) { throw new ToolError(`DSH bridge unavailable: ${signal.aborted ? 'request cancelled' : error.message}. Start Harness, or use DSS_BRIDGE=off for a separately configured backend.`); }
  let data;
  try { data = await response.json(); } catch { throw new ToolError('DSH bridge returned invalid JSON'); }
  if (!response.ok || data?.ok !== true || !plainObject(data.value)) throw new ToolError(`DSH bridge error: ${String(data?.error || `HTTP ${response.status}`).slice(0, 240)}`);
  const value = name === 'suggest_next_prompt' ? data.value.suggestion : data.value.prompt;
  if (typeof value !== 'string') throw new ToolError('DSH bridge returned an invalid tool result');
  // Validate the same policy on both sides, including intentional abstention.
  return name === 'suggest_next_prompt' ? parseSuggestion(JSON.stringify(value ? [value] : []), args) : parseRewrite(value, args.draft);
}

async function callDirect(name, args, signal) {
  const { baseUrl, apiKey, model, timeoutMs } = directConfig();
  if (!baseUrl || !model) throw new ToolError('LLM backend is not configured. Start the DSH plugin, or set DSS_LLM_BASE_URL and DSS_LLM_MODEL.');
  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: name === 'suggest_next_prompt' ? SUGGEST_SYSTEM : OPTIMIZE_SYSTEM }, { role: 'user', content: name === 'suggest_next_prompt' ? suggestionInput(args) : optimizeInput(args.draft, args.context) }], temperature: 0.2, max_tokens: name === 'suggest_next_prompt' ? 1400 : optimizeMaxTokens(args.draft), stream: false }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), redirect: 'error',
    });
  } catch (error) { throw new ToolError(`LLM request failed: ${signal.aborted ? 'request cancelled' : error.message}`); }
  if (!response.ok) throw new ToolError(`LLM request returned HTTP ${response.status}`);
  let data;
  try { data = await response.json(); } catch { throw new ToolError('LLM response is not JSON'); }
  const choice = data?.choices?.[0];
  if (choice?.finish_reason !== 'stop') throw new ToolError(`LLM did not finish successfully (${choice?.finish_reason || 'unknown'})`);
  const content = choice.message?.content;
  const raw = Array.isArray(content) ? content.map(part => typeof part?.text === 'string' ? part.text : '').join('') : content;
  if (typeof raw !== 'string' || !raw.trim()) throw new ToolError('LLM returned no text');
  return name === 'suggest_next_prompt' ? parseSuggestion(raw, args) : parseRewrite(raw, args.draft);
}

async function callTool(name, args, signal) {
  const bridge = bridgeConfig();
  return textResult(bridge ? await callBridge(bridge, name, args, signal) : await callDirect(name, args, signal));
}

let phase = 'new';
let active = 0;
let ending = false;
let buffer = '';
let bufferBytes = 0;
let discarding = false;
const pending = new Map();
const waiting = [];

function write(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function finishIfEnded() {
  if (ending && active === 0 && waiting.length === 0) process.stdout.write('', () => process.exit(0));
}
function pump() {
  while (active < MAX_CONCURRENT && waiting.length) {
    const task = waiting.shift();
    if (task.controller.signal.aborted) continue;
    active++;
    callTool(task.name, task.args, task.controller.signal).then(value => {
      if (!task.controller.signal.aborted) write(result(task.id, value));
    }, error => {
      if (!task.controller.signal.aborted) write(result(task.id, textResult(error.message || 'tool failed', true)));
    }).finally(() => { active--; pending.delete(task.id); pump(); finishIfEnded(); });
  }
  finishIfEnded();
}
function cancel(requestId) {
  const task = pending.get(requestId);
  if (!task) return;
  task.controller.abort(new Error('request cancelled'));
  const index = waiting.indexOf(task);
  if (index >= 0) { waiting.splice(index, 1); pending.delete(requestId); }
}

function handle(message) {
  const id = message?.id;
  if (!plainObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (id !== undefined && !(typeof id === 'string' || Number.isInteger(id)))) {
    write(failure(typeof id === 'string' || Number.isInteger(id) ? id : null, -32600, 'invalid JSON-RPC request'));
    return;
  }
  const { method, params } = message;
  if (id === undefined) {
    if (method === 'notifications/initialized' && phase === 'initializing') phase = 'ready';
    if (method === 'notifications/cancelled') cancel(params?.requestId);
    return; // Notifications, including unknown ones, never receive responses.
  }
  if (pending.has(id)) return write(failure(id, -32600, 'request ID is already in use'));
  if (method === 'initialize') {
    if (phase !== 'new') return write(failure(id, -32600, 'already initialized'));
    if (!plainObject(params) || typeof params.protocolVersion !== 'string' || !plainObject(params.capabilities) || !plainObject(params.clientInfo) || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') return write(failure(id, -32602, 'invalid initialize parameters'));
    phase = 'initializing';
    return write(result(id, { protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: { name: 'dsh-suggestions-mcp', version: VERSION } }));
  }
  if (method === 'ping') return write(result(id, {}));
  if (phase !== 'ready') return write(failure(id, -32000, 'initialization is not complete'));
  if (method === 'tools/list') return write(result(id, { tools: TOOLS }));
  if (method === 'resources/list') return write(result(id, { resources: [] }));
  if (method === 'prompts/list') return write(result(id, { prompts: [] }));
  if (method !== 'tools/call') return write(failure(id, -32601, `method not found: ${method}`));
  let args;
  try { args = validateArguments(params?.name, params?.arguments ?? {}); } catch (error) { return write(failure(id, -32602, error.message)); }
  if (waiting.length >= MAX_QUEUED && active >= MAX_CONCURRENT) return write(failure(id, -32000, 'server is busy; retry later'));
  const task = { id, name: params.name, args, controller: new AbortController() };
  pending.set(id, task);
  waiting.push(task);
  pump();
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (discarding) {
    const newline = chunk.indexOf('\n');
    if (newline === -1) return;
    chunk = chunk.slice(newline + 1);
    discarding = false;
  }
  buffer += chunk;
  bufferBytes += Buffer.byteLength(chunk);
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const raw = buffer.slice(0, newline);
    const bytes = Buffer.byteLength(raw);
    buffer = buffer.slice(newline + 1);
    bufferBytes -= bytes + 1;
    if (bytes > MAX_FRAME_BYTES) { write(failure(null, -32700, 'message exceeds 10 MiB')); continue; }
    const line = raw.trim();
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { write(failure(null, -32700, 'parse error')); continue; }
    try { handle(message); } catch { write(failure(message?.id ?? null, -32603, 'internal error')); }
  }
  if (bufferBytes > MAX_FRAME_BYTES) { buffer = ''; bufferBytes = 0; discarding = true; write(failure(null, -32700, 'message exceeds 10 MiB')); }
});
process.stdin.on('end', () => { ending = true; finishIfEnded(); });
function shutdown() { for (const task of pending.values()) task.controller.abort(new Error('server shutting down')); process.exit(0); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.stdout.on('error', shutdown);
