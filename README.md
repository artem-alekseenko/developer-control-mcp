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

## MCP-003: JSON-only HTTP

Export an unpredictable local token before starting the server:

    export MCP_DEV_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
    npm run dev

POST /mcp accepts JSON-RPC 2.0 with MCP revision 2026-07-28.
Every request requires a bearer token, both Accept types, matching MCP
headers and per-request `_meta`. Origin is denied unless explicitly allowlisted.
There are no production RPC methods until MCP-004.
SSE, subscriptions, cancellation and custom x-mcp-header schema validation
are not implemented in this iteration.
