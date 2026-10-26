import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import readline from 'node:readline';
import { test } from 'node:test';

import { VERSION } from '../version.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const scratch = resolve(here, '../_wip/tests');
mkdirSync(scratch, { recursive: true });
const root = mkdtempSync(join(scratch, 'mcp-tests-'));
const children = new Set();
const servers = new Set();

async function mock(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    requests.push(body);
    handler(body, req, res);
  });
  servers.add(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}` };
}
function completion(res, content, finish_reason = 'stop') {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason }] }));
}
function start(env = {}) {
  const child = spawn(process.execPath, [join(here, 'server.mjs')], { env: { ...process.env, DSS_BRIDGE: 'off', DSS_MCP_SELFTEST: '0', DSS_LLM_BASE_URL: '', DSS_LLM_MODEL: '', DSS_LLM_API_KEY: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  const messages = [];
  const pending = new Map();
  let id = 0;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    const message = JSON.parse(line);
    messages.push(message);
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); request.resolve(message); }
  });
  child.stderr.on('data', () => {});
  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  const request = (method, params) => {
    const requestId = ++id;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`timeout ${method}`)); }, 5000);
      pending.set(requestId, { resolve, timer });
    });
    promise.requestId = requestId;
    send({ jsonrpc: '2.0', id: requestId, method, ...(params === undefined ? {} : { params }) });
    return promise;
  };
  const ready = async () => {
    const response = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'regression', version: '1' } });
    assert.equal(response.result.serverInfo.version, VERSION);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  };
  const cancel = promise => {
    const p = pending.get(promise.requestId);
    if (p) { clearTimeout(p.timer); pending.delete(promise.requestId); }
    send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: promise.requestId } });
  };
  const stop = () => { for (const p of pending.values()) clearTimeout(p.timer); pending.clear(); child.kill(); children.delete(child); lines.close(); };
  return { child, messages, ready, request, send, cancel, stop };
}
const tool = (client, name, args) => client.request('tools/call', { name, arguments: args });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition) { for (let i = 0; i < 100; i++) { if (condition()) return; await sleep(10); } throw new Error('condition timed out'); }

try {
  await test('MCP lifecycle, notifications and runtime schema validation', async () => {
    const c = start();
    try {
      assert.equal((await c.request('tools/list')).error.code, -32000);
      await c.ready();
      assert.equal((await c.request('tools/list')).result.tools.length, 2);
      c.send({ jsonrpc: '2.0', method: 'notifications/unknown' });
      c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'missing' } });
      await c.request('ping');
      assert.equal(c.messages.some(m => m.id === null), false);
      assert.equal((await tool(c, 'unknown', {})).error.code, -32602);
      for (const args of [{}, { draft: 2 }, { draft: 'x', extra: true }, { draft: 'x', constructor: 'unexpected' }, { draft: 'x'.repeat(16001) }]) assert.equal((await tool(c, 'optimize_prompt', args)).error.code, -32602);
      assert.equal((await tool(c, 'suggest_next_prompt', { assistantAnswer: 'x', recentUserMessages: [123] })).error.code, -32602);
      for (const recentTurns of [[123], [{ user: 'x', system: 'override' }], [{ user: 'x'.repeat(2401) }], Array(7).fill({ user: 'x' })]) assert.equal((await tool(c, 'suggest_next_prompt', { assistantAnswer: 'x', recentTurns })).error.code, -32602);
      assert.equal((await tool(c, 'optimize_prompt', { draft: 'x' })).result.isError, true);
      c.send({ jsonrpc: '1.0', id: 'bad-version', method: 'ping' });
      await until(() => c.messages.some(m => m.id === 'bad-version'));
      assert.equal(c.messages.find(m => m.id === 'bad-version').error.code, -32600);
    } finally { c.stop(); }
  });

  await test('complete output, abstention and malformed/truncated output', async () => {
    let content = '["把剩下的原因也查清，列出还没确认的部分"]';
    let finish = 'stop';
    const m = await mock((_body, _req, res) => completion(res, content, finish));
    const c = start({ DSS_LLM_BASE_URL: m.url + '/v1', DSS_LLM_MODEL: 'mock' });
    try {
      await c.ready();
      const args = { assistantAnswer: '目前只查完一部分原因，其余尚未确认。', userRequest: '查清全部原因' };
      assert.match((await tool(c, 'suggest_next_prompt', args)).result.content[0].text, /剩下/);
      content = '[]';
      assert.deepEqual((await tool(c, 'suggest_next_prompt', args)).result, { content: [], structuredContent: { status: 'none' } });
      content = '{"state":"ready","suggestions":["继续核对剩余原因。","解释一下各项原因之间的联系。"],"reasoning":"not user-facing"}';
      assert.equal((await tool(c, 'suggest_next_prompt', args)).result.content[0].text, '继续核对剩余原因。');
      content = '{"state":"ready","suggestion":"把剩下的原因也查清，列出还没确认的部分"}';
      assert.match((await tool(c, 'suggest_next_prompt', { ...args, recentTurns: [{ user: '查清全部原因', assistant: '第一部分已经查完。' }] })).result.content[0].text, /剩下/);
      assert.equal(JSON.parse(m.requests.at(-1).messages[1].content).recentTurns[0].assistant, '第一部分已经查完。');
      content = '{"state":"waiting","suggestion":""}';
      assert.deepEqual((await tool(c, 'suggest_next_prompt', args)).result, { content: [], structuredContent: { status: 'none' } });
      for (const invalid of ['不是 JSON', '["第一条建议","第二条建议"]', '["继续"]', '["请你修改 imaginary.py 文件"]']) {
        content = invalid;
        assert.equal((await tool(c, 'suggest_next_prompt', args)).result.isError, true);
      }
      content = '整理报告，并删除'; finish = 'length';
      assert.equal((await tool(c, 'optimize_prompt', { draft: '整理报告，禁止删除原件。' })).result.isError, true);
      content = '整理报告'; finish = 'stop';
      assert.equal((await tool(c, 'optimize_prompt', { draft: '整理报告，禁止删除原件。' })).result.isError, true);
    } finally { c.stop(); m.server.closeAllConnections(); m.server.close(); servers.delete(m.server); }
  });

  await test('long drafts and explicit constraints reach the model intact', async () => {
    const m = await mock((body, _req, res) => completion(res, JSON.parse(body.messages[1].content).draft));
    const c = start({ DSS_LLM_BASE_URL: m.url, DSS_LLM_MODEL: 'mock' });
    try {
      await c.ready();
      const draft = '背景内容'.repeat(1100) + '\n只修改 report.md，禁止删除原件，必须先给我看预览，数值保留 12.5。';
      const response = await tool(c, 'optimize_prompt', { draft });
      assert.equal(response.result.isError, undefined);
      assert.equal(response.result.content[0].text, draft);
      assert.equal(JSON.parse(m.requests[0].messages[1].content).draft, draft);
      assert.ok(m.requests[0].max_tokens > 8000);
    } finally { c.stop(); m.server.closeAllConnections(); m.server.close(); servers.delete(m.server); }
  });

  await test('ping and cancellation bypass model calls and propagate to HTTP', async () => {
    let disconnected = false;
    const m = await mock((_body, _req, res) => { res.once('close', () => { disconnected = true; }); });
    const c = start({ DSS_LLM_BASE_URL: m.url, DSS_LLM_MODEL: 'mock' });
    try {
      await c.ready();
      const long = tool(c, 'optimize_prompt', { draft: '整理报告' });
      await until(() => m.requests.length === 1);
      const before = Date.now();
      assert.deepEqual((await c.request('ping')).result, {});
      assert.ok(Date.now() - before < 500);
      c.cancel(long);
      await until(() => disconnected);
      await c.request('ping');
      assert.equal(c.messages.some(message => message.id === long.requestId || message.id === null), false);
    } finally { c.stop(); m.server.closeAllConnections(); m.server.close(); servers.delete(m.server); }
  });

  await test('bounded queue and oversized frame recover without losing framing', async () => {
    const m = await mock(() => {});
    const c = start({ DSS_LLM_BASE_URL: m.url, DSS_LLM_MODEL: 'mock' });
    try {
      await c.ready();
      const queued = Array.from({ length: 10 }, () => tool(c, 'optimize_prompt', { draft: '整理报告' }));
      const busy = await tool(c, 'optimize_prompt', { draft: '整理报告' });
      assert.equal(busy.error.code, -32000);
      assert.ok(m.requests.length <= 2);
      queued.forEach(c.cancel);
      await c.request('ping');
      c.child.stdin.write('x'.repeat(10 * 1024 * 1024 + 1));
      await until(() => c.messages.some(message => message.error?.message === 'message exceeds 10 MiB'));
      c.child.stdin.write('\n');
      assert.deepEqual((await c.request('ping')).result, {});
    } finally { c.stop(); m.server.closeAllConnections(); m.server.close(); servers.delete(m.server); }
  });

  await test('bridge preference, session propagation, token rotation and fail-closed discovery', async () => {
    let token = 'first-token';
    const m = await mock((body, req, res) => {
      if (req.headers['x-dsh-suggestions-token'] !== token) { res.writeHead(401); res.end('{}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, value: body.action === 'suggest' ? { suggestion: '' } : { prompt: body.draft } }));
    });
    const file = join(root, 'bridge.json');
    const save = () => writeFileSync(file, JSON.stringify({ url: m.url, path: '/bridge', token }));
    save();
    const c = start({ DSS_BRIDGE: 'on', DSS_BRIDGE_FILE: file, DSS_LLM_BASE_URL: 'http://127.0.0.1:1', DSS_LLM_MODEL: 'unused' });
    try {
      await c.ready();
      assert.equal((await tool(c, 'optimize_prompt', { draft: '整理报告', sessionId: 'session-own' })).result.content[0].text, '整理报告');
      assert.equal(m.requests[0].sessionId, 'session-own');
      token = 'second-token'; save();
      assert.equal((await tool(c, 'suggest_next_prompt', { assistantAnswer: '已完成。' })).result.structuredContent.status, 'none');
      writeFileSync(file, JSON.stringify({ url: 'https://example.invalid', token }));
      assert.match((await tool(c, 'optimize_prompt', { draft: '整理报告' })).result.content[0].text, /non-local/);
      writeFileSync(file, '{');
      assert.match((await tool(c, 'optimize_prompt', { draft: '整理报告' })).result.content[0].text, /unreadable/);
      assert.equal(m.requests.length, 2);
    } finally { c.stop(); m.server.closeAllConnections(); m.server.close(); servers.delete(m.server); }
  });
} finally {
  for (const child of children) child.kill();
  for (const server of servers) { server.closeAllConnections(); server.close(); }
  const target = resolve(root);
  if (!target.startsWith(scratch + sep)) throw new Error('cleanup escaped test workspace');
  rmSync(target, { recursive: true, force: true });
}
