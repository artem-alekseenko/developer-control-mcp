import { createHttpServer } from './http-server.js';

const HOST = '127.0.0.1';
const PORT = 3100;

const token = process.env.MCP_DEV_TOKEN;
if (!token) {
  console.error('Set MCP_DEV_TOKEN before starting the server');
  process.exit(1);
}
const server = createHttpServer({ token });

server.on('error', (error) => {
  console.error('HTTP server error:', error);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(
    `HTTP server listening on http://${HOST}:${PORT}`,
  );
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}. Shutting down...`);

  const timeout = setTimeout(() => {
    console.error(
      'Shutdown timeout: closing active connections',
    );
    server.closeAllConnections();
  }, 5_000);

  timeout.unref();

  server.close((error) => {
    clearTimeout(timeout);

    if (error) {
      console.error('Shutdown failed:', error);
      process.exitCode = 1;
      return;
    }

    console.log('HTTP server stopped');
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
