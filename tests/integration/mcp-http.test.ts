import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttpServer } from '../../src/http-server.js';
import type { JsonRpcHandler } from '../../src/protocol/dispatcher.js';

const version = '2026-07-28';
const token = 'test-only-secret';
const metadata = {
  'io.modelcontextprotocol/protocolVersion': version,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
};
const makeRequest = (overrides: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0', id: 1, method: 'demo/echo',
  params: { _meta: metadata, message: 'hello' },
  ...overrides,
});

test('MCP JSON-only HTTP transport', async (t) => {
  let executed = 0;
  const handlers = new Map<string, JsonRpcHandler>([
    ['demo/echo', (params) => {
      executed += 1;
      const message = params?.message;
      return { resultType: 'complete', message: typeof message === 'string' ? message : null };
    }],
    ['tools/call', () => ({ resultType: 'complete', content: [] })],
  ]);
  const server = createHttpServer({ token, handlers });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  const url = `http://127.0.0.1:${address.port}/mcp`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': version,
    'Mcp-Method': 'demo/echo',
  };
  async function post(body: unknown = makeRequest(), changes: Record<string, string> = {}) {
    const response = await fetch(url, {
      method: 'POST', headers: { ...headers, ...changes },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() as any };
  }

  await t.test('returns 200 and request id', async () => {
    const { status, json } = await post();
    assert.equal(status, 200);
    assert.equal(json.id, 1);
    assert.equal(json.result.resultType, 'complete');
    assert.equal(json.result.message, 'hello');
    assert.equal(json.result._meta['io.modelcontextprotocol/serverInfo'].name, 'developer-control-mcp');
  });
  await t.test('unknown RPC method is HTTP 404 with JSON-RPC -32601', async () => {
    const { status, json } = await post(makeRequest({ method: 'unknown/method' }), {
      'Mcp-Method': 'unknown/method',
    });
    assert.equal(status, 404);
    assert.equal(json.error.code, -32601);
  });
  await t.test('invalid JSON returns -32700', async () => {
    const { status, json } = await post('{');
    assert.equal(status, 400);
    assert.equal(json.error.code, -32700);
  });
  await t.test('mismatched method header returns -32020', async () => {
    const { status, json } = await post(makeRequest(), { 'Mcp-Method': 'other/method' });
    assert.equal(status, 400);
    assert.equal(json.error.code, -32020);
  });
  await t.test('unsupported version returns -32022 with supported list', async () => {
    const { status, json } = await post(makeRequest({ params: {
      _meta: { ...metadata, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' },
    } }), { 'MCP-Protocol-Version': '2099-01-01' });
    assert.equal(status, 400);
    assert.equal(json.error.code, -32022);
    assert.deepEqual(json.error.data.supported, [version]);
  });
  await t.test('missing method header is a mismatch', async () => {
    const { status, json } = await post(makeRequest(), { 'Mcp-Method': '' });
    assert.equal(status, 400);
    assert.equal(json.error.code, -32020);
  });
  await t.test('clientCapabilities is mandatory', async () => {
    const { status, json } = await post(makeRequest({ params: {
      _meta: { 'io.modelcontextprotocol/protocolVersion': version },
    } }));
    assert.equal(status, 400);
    assert.equal(json.error.code, -32602);
  });
  await t.test('invalid origin is forbidden', async () => {
    const { status } = await post(makeRequest(), { Origin: 'https://evil.example' });
    assert.equal(status, 403);
  });
  await t.test('invalid bearer token is rejected', async () => {
    const { status } = await post(makeRequest(), { Authorization: 'Bearer wrong' });
    assert.equal(status, 401);
  });
  await t.test('incorrect media type is rejected', async () => {
    const { status } = await post(makeRequest(), { 'Content-Type': 'text/plain' });
    assert.equal(status, 415);
  });
  await t.test('both accept media types are required', async () => {
    const { status } = await post(makeRequest(), { Accept: 'application/json' });
    assert.equal(status, 406);
  });
  await t.test('oversized body is rejected', async () => {
    const { status } = await post(makeRequest({ params: {
      _meta: metadata, message: 'x'.repeat(70_000),
    } }));
    assert.equal(status, 413);
  });
  await t.test('client notification cannot execute handlers', async () => {
    const before = executed;
    const { status, json } = await post({
      jsonrpc: '2.0', method: 'demo/echo', params: { _meta: metadata },
    });
    assert.equal(status, 400);
    assert.equal(json.error.code, -32600);
    assert.equal(executed, before);
  });
  await t.test('batch is rejected', async () => {
    const { status, json } = await post([makeRequest()]);
    assert.equal(status, 400);
    assert.equal(json.error.code, -32600);
  });
  await t.test('Mcp-Name supports base64 encoding', async () => {
    const name = 'тест';
    const { status, json } = await post(makeRequest({
      method: 'tools/call', params: { _meta: metadata, name, arguments: {} },
    }), {
      'Mcp-Method': 'tools/call',
      'Mcp-Name': `=?base64?${Buffer.from(name).toString('base64')}?=`,
    });
    assert.equal(status, 200);
    assert.equal(json.result.resultType, 'complete');
  });
  await t.test('Mcp-Name mismatch is rejected', async () => {
    const { status, json } = await post(makeRequest({
      method: 'tools/call', params: { _meta: metadata, name: 'git_status' },
    }), { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'other' });
    assert.equal(status, 400);
    assert.equal(json.error.code, -32020);
  });
});
