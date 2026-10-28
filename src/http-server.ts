import {
  createServer,
  type Server,
  type ServerResponse,
} from 'node:http';

function sendJson(
  response: ServerResponse,
  status: number,
  data: object,
): void {
  const body = JSON.stringify(data);

  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });

  response.end(body);
}

export function createHttpServer(): Server {
  return createServer((request, response) => {
    if (request.url !== '/health') {
      sendJson(response, 404, { error: 'Not Found' });
      return;
    }

    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, {
        error: 'Method Not Allowed',
      });
      return;
    }

    sendJson(response, 200, { status: 'ok' });
  });
}
