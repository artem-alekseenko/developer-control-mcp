import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JsonRpcResponse } from '../protocol/jsonrpc.js';
import { createJsonRpcDispatcher } from '../protocol/dispatcher.js';

export const MCP_VERSION = '2026-07-28';
const MAX_BODY_BYTES = 64 * 1024;
type Dispatcher = ReturnType<typeof createJsonRpcDispatcher>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sendJson(response: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function rpcError(
  response: ServerResponse,
  status: number,
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): void {
  sendJson(response, status, {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}

function authorized(header: string | undefined, token: string): boolean {
  const supplied = /^Bearer (\S+)$/i.exec(header ?? '')?.[1];
  if (!supplied) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(supplied), digest(token));
}

function accepts(header: string | undefined, mediaType: string): boolean {
  return (header ?? '').split(',').some((part) => {
    const [type, ...parameters] = part.split(';');
    return type?.trim().toLowerCase() === mediaType &&
      !parameters.some((p) => /^q\s*=\s*0(?:\.0+)?$/i.test(p.trim()));
  });
}

function decodeHeaderValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  if (!match) {
    if (value.startsWith('=?base64?') || value.trim() !== value || /[^\x20-\x7e]/.test(value)) {
      return undefined;
    }
    return value;
  }
  try {
    const bytes = Buffer.from(match[1]!, 'base64');
    if (bytes.toString('base64') !== match[1]) return undefined;
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

async function readBody(request: IncomingMessage): Promise<string | null> {
  let length = 0;
  let tooLarge = false;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_BODY_BYTES) {
      tooLarge = true;
    } else if (!tooLarge) {
      chunks.push(bytes);
    }
  }
  return tooLarge ? null : Buffer.concat(chunks).toString('utf8');
}

function statusOf(result: JsonRpcResponse): number {
  if (!('error' in result)) return 200;
  if (result.error.code === -32601) return 404;
  if (result.error.code === -32603) return 500;
  return 400;
}

export async function handleMcpPost(
  request: IncomingMessage,
  response: ServerResponse,
  dispatch: Dispatcher,
  token: string | undefined,
): Promise<void> {
  if (!token) {
    request.resume();
    sendJson(response, 503, { error: 'MCP authentication is not configured' });
    return;
  }
  if (!authorized(request.headers.authorization, token)) {
    request.resume();
    response.setHeader('WWW-Authenticate', 'Bearer');
    sendJson(response, 401, { error: 'Unauthorized' });
    return;
  }
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    request.resume();
    sendJson(response, 415, { error: 'Content-Type must be application/json' });
    return;
  }
  if (!accepts(request.headers.accept, 'application/json') ||
      !accepts(request.headers.accept, 'text/event-stream')) {
    request.resume();
    sendJson(response, 406, { error: 'Accept must include JSON and SSE' });
    return;
  }
  const declaredLength = Number(request.headers['content-length']);
  if (request.headers['content-length'] !== undefined &&
      (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
    request.resume();
    sendJson(response, 400, { error: 'Invalid Content-Length' });
    return;
  }
  if (declaredLength > MAX_BODY_BYTES) {
    request.resume();
    sendJson(response, 413, { error: 'Payload Too Large' });
    return;
  }

  const body = await readBody(request);
  if (body === null) {
    sendJson(response, 413, { error: 'Payload Too Large' });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    const result = await dispatch(body);
    sendJson(response, 400, result);
    return;
  }
  // The generic MCP-002 dispatcher executes notifications. HTTP must reject
  // them BEFORE dispatch because this MCP revision defines none for clients.
  if (isRecord(parsed) && !Object.hasOwn(parsed, 'id')) {
    rpcError(response, 400, null, -32600, 'Client notifications are not supported');
    return;
  }
  if (!isRecord(parsed) || parsed.jsonrpc !== '2.0' ||
      typeof parsed.method !== 'string' || parsed.method.length === 0 ||
      parsed.method.startsWith('rpc.') || !Object.hasOwn(parsed, 'id') ||
      !(typeof parsed.id === 'string' ||
        (typeof parsed.id === 'number' && Number.isSafeInteger(parsed.id)))) {
    // Reject notifications here: no client notifications exist in MCP 2026-07-28 HTTP.
    const result = await dispatch(body);
    sendJson(response, 400, result ?? {
      jsonrpc: '2.0', id: null,
      error: { code: -32600, message: 'Invalid Request' },
    });
    return;
  }

  const id = parsed.id as string | number;
  const params = parsed.params;
  if (!isRecord(params)) {
    rpcError(response, 400, id, -32602, 'Invalid params');
    return;
  }
  if (!isRecord(params._meta)) {
    rpcError(response, 400, id, -32020, 'Header mismatch: missing params._meta');
    return;
  }
  const meta = params._meta;
  const protocolHeader = request.headers['mcp-protocol-version'];
  const bodyVersion = meta['io.modelcontextprotocol/protocolVersion'];
  if (typeof protocolHeader !== 'string' ||
      typeof bodyVersion !== 'string' || protocolHeader !== bodyVersion) {
    rpcError(response, 400, id, -32020, 'Header mismatch: MCP-Protocol-Version');
    return;
  }
  if (protocolHeader !== MCP_VERSION) {
    rpcError(response, 400, id, -32022, 'Unsupported protocol version', {
      requested: protocolHeader,
      supported: [MCP_VERSION],
    });
    return;
  }
  if (request.headers['mcp-method'] !== parsed.method) {
    rpcError(response, 400, id, -32020, 'Header mismatch: Mcp-Method');
    return;
  }
  if (!isRecord(meta['io.modelcontextprotocol/clientCapabilities'])) {
    rpcError(response, 400, id, -32602, 'Invalid params: clientCapabilities');
    return;
  }
  if (Object.hasOwn(meta, 'io.modelcontextprotocol/clientInfo')) {
    const info = meta['io.modelcontextprotocol/clientInfo'];
    if (!isRecord(info) || typeof info.name !== 'string' || !info.name ||
        typeof info.version !== 'string' || !info.version) {
      rpcError(response, 400, id, -32602, 'Invalid params: clientInfo');
      return;
    }
  }

  const namedParameter: Record<string, string> = {
    'tools/call': 'name', 'prompts/get': 'name', 'resources/read': 'uri',
  };
  const field = namedParameter[parsed.method];
  if (field) {
    if (typeof params[field] !== 'string') {
      rpcError(response, 400, id, -32602, `Invalid params: ${field}`);
      return;
    }
    const headerName = request.headers['mcp-name'];
    const decoded = typeof headerName === 'string' ? decodeHeaderValue(headerName) : undefined;
    if (decoded === undefined || decoded !== params[field]) {
      rpcError(response, 400, id, -32020, 'Header mismatch: Mcp-Name');
      return;
    }
  }

  const result = await dispatch(body);
  if (!result) {
    rpcError(response, 400, id, -32600, 'Invalid Request');
    return;
  }
  if ('result' in result) {
    if (!isRecord(result.result) || typeof result.result.resultType !== 'string') {
      rpcError(response, 500, id, -32603, 'Internal error');
      return;
    }
    // 2026-07-28: identify the server in the successful result metadata.
    const metadata = isRecord(result.result._meta) ? result.result._meta : {};
    result.result = {
      ...result.result,
      _meta: {
        ...metadata,
        'io.modelcontextprotocol/serverInfo': {
          name: 'developer-control-mcp', version: '0.1.0',
        },
      },
    };
  }
  sendJson(response, statusOf(result), result);
}
