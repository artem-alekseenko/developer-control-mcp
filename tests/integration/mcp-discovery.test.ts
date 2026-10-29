import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHttpServer } from '../../src/http-server.js';
import { MCP_VERSION } from '../../src/transport/mcp-http.js';

test('MCP discovery over HTTP', async (context) => {
  const token = 'integration-test-token';
  const server = createHttpServer({ token });

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

  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }

  const endpoint = `http://127.0.0.1:${address.port}/mcp`;

  const meta = {
    'io.modelcontextprotocol/protocolVersion': MCP_VERSION,
    'io.modelcontextprotocol/clientInfo': {
      name: 'integration-test',
      version: '1.0.0',
    },
    'io.modelcontextprotocol/clientCapabilities': {},
  };

  async function call(
    method: string,
    params: Record<string, unknown>,
  ) {
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        'MCP-Protocol-Version': MCP_VERSION,
        'Mcp-Method': method,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'discover-1',
        method,
        params,
      }),
    });
  }

  await context.test(
    'advertises supported versions and identity',
    async () => {
      const response = await call('server/discover', {
        _meta: meta,
      });

      assert.equal(response.status, 200);

      assert.deepEqual(await response.json(), {
        jsonrpc: '2.0',
        id: 'discover-1',
        result: {
          resultType: 'complete',
          supportedVersions: [MCP_VERSION],
          capabilities: {},
          _meta: {
            'io.modelcontextprotocol/serverInfo': {
              name: 'developer-control-mcp',
              version: '0.1.0',
            },
          },
        },
      });
    },
  );

  await context.test(
    'rejects unexpected discovery parameters',
    async () => {
      const response = await call('server/discover', {
        _meta: meta,
        unexpected: true,
      });

      assert.equal(response.status, 400);

      const body = await response.json() as {
        error: { code: number };
      };

      assert.equal(body.error.code, -32602);
    },
  );

  await context.test(
    'does not advertise unavailable tools',
    async () => {
      const response = await call('tools/list', {
        _meta: meta,
      });

      assert.equal(response.status, 404);

      const body = await response.json() as {
        error: { code: number };
      };

      assert.equal(body.error.code, -32601);
    },
  );
});
