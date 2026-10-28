import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttpServer } from '../src/http-server.js';

test('HTTP health endpoint, routing and methods', async (context) => {
  const server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Expected TCP address');
  const base = `http://127.0.0.1:${addr.port}`;
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const notFound = await fetch(`${base}/missing`);
  assert.equal(notFound.status, 404);
  const method = await fetch(`${base}/mcp`);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'POST');
  const wrongHealth = await fetch(`${base}/health`, { method: 'POST' });
  assert.equal(wrongHealth.status, 405);
  assert.equal(wrongHealth.headers.get('allow'), 'GET');
});
