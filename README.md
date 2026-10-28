# Developer Control MCP

Educational local diagnostics server.

Protocol target: MCP 2026-07-28.
Future SDK comparison: TypeScript MCP SDK v2.

## MCP-001

Requires Node.js >=26.5.0 <27.

Install:

    npm ci

Run tests:

    npm test

Start development server:

    npm run dev

Check:

    curl -i http://127.0.0.1:3100/health

The server binds only to 127.0.0.1.
The /mcp endpoint is not implemented yet.
