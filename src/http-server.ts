import { createServer, type Server } from 'node:http';
import { createJsonRpcDispatcher, type JsonRpcHandler } from './protocol/dispatcher.js';
import { handleMcpPost, sendJson } from './transport/mcp-http.js';
import { MCP_VERSION } from './transport/mcp-http.js';
import { createDiscoveryHandler } from './protocol/discovery.js';

export interface HttpServerOptions {
  token?: string;
  handlers?: ReadonlyMap<string, JsonRpcHandler>;
  allowedOrigins?: readonly string[];
}

export function createHttpServer(options: HttpServerOptions = {}): Server {
  const handlers = new Map<string, JsonRpcHandler>(
    options.handlers,
  );

  // Mandatory MCP method, not overridable by external handlers.
  handlers.set(
    'server/discover',
    createDiscoveryHandler(MCP_VERSION),
  );

  const dispatch = createJsonRpcDispatcher(handlers);

  return createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, (request, response) => {
    // Absent Origin is normal for curl and server-side MCP clients.
    const origin = request.headers.origin;
    if (origin !== undefined && !options.allowedOrigins?.includes(origin)) {
      request.resume();
      sendJson(response, 403, { error: 'Forbidden Origin' });
      return;
    }

    if (request.url === '/health') {
      request.resume();
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        sendJson(response, 405, { error: 'Method Not Allowed' });
      } else {
        sendJson(response, 200, { status: 'ok' });
      }
      return;
    }

    if (request.url === '/mcp') {
      if (request.method !== 'POST') {
        request.resume();
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { error: 'Method Not Allowed' });
        return;
      }
      void handleMcpPost(request, response, dispatch, options.token).catch((error: unknown) => {
        console.error('HTTP request handling failed:', error);
        if (!response.headersSent) {
          sendJson(response, 500, { jsonrpc: '2.0', id: null,
            error: { code: -32603, message: 'Internal error' } });
        } else {
          response.end();
        }
      });
      return;
    }

    request.resume();
    sendJson(response, 404, { error: 'Not Found' });
  });
}
