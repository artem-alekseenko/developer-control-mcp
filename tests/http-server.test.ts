import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttpServer } from '../src/http-server.js';

test('HTTP health endpoint and fallback', async (context) => {
  const server = createHttpServer();

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error ? reject(error) : resolve(),
      );
    });
  });

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Expected a TCP address');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/health`);

  assert.equal(health.status, 200);
  assert.match(
    health.headers.get('content-type') ?? '',
    /^application\/json/,
  );
  assert.deepEqual(await health.json(), { status: 'ok' });

  const notFound = await fetch(`${baseUrl}/mcp`);

  assert.equal(notFound.status, 404);
  assert.deepEqual(await notFound.json(), {
    error: 'Not Found',
  });

  const wrongMethod = await fetch(`${baseUrl}/health`, {
    method: 'POST',
  });

  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET');
});
