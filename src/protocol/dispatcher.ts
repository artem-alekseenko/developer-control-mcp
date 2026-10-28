import {
  type JsonRpcId,
  type JsonRpcParams,
  type JsonRpcResponse,
  type JsonValue,
} from './jsonrpc.js';

import {
  InvalidParamsError,
  JsonRpcErrorCode,
} from './errors.js';

export type JsonRpcHandler = (
  params: JsonRpcParams | undefined,
) => JsonValue | Promise<JsonValue>;

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isValidId(value: unknown): value is JsonRpcId {
  return (
    typeof value === 'string' ||
    (
      typeof value === 'number' &&
      Number.isSafeInteger(value)
    )
  );
}

function errorResponse(
  id: JsonRpcId | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
}

export function createJsonRpcDispatcher(
  handlers: ReadonlyMap<string, JsonRpcHandler>,
) {
  return async function dispatchJsonRpc(
    payload: string,
  ): Promise<JsonRpcResponse | undefined> {
    let message: unknown;

    try {
      message = JSON.parse(payload);
    } catch {
      return errorResponse(
        null,
        JsonRpcErrorCode.PARSE_ERROR,
        'Parse error',
      );
    }

    // Validate the request envelope.
    if (
      !isObject(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string' ||
      message.method.length === 0 ||
      message.method.startsWith('rpc.')
    ) {
      return errorResponse(
        null,
        JsonRpcErrorCode.INVALID_REQUEST,
        'Invalid Request',
      );
    }

    const hasId = Object.hasOwn(message, 'id');

    if (hasId && !isValidId(message.id)) {
      return errorResponse(
        null,
        JsonRpcErrorCode.INVALID_REQUEST,
        'Invalid Request',
      );
    }

    // No id means JSON-RPC notification.
    const id: JsonRpcId | undefined = hasId
      ? message.id as JsonRpcId
      : undefined;

    // MCP accepts object params, not positional arrays.
    if (
      Object.hasOwn(message, 'params') &&
      !isObject(message.params)
    ) {
      if (id === undefined) return undefined;

      return errorResponse(
        id,
        JsonRpcErrorCode.INVALID_PARAMS,
        'Invalid params',
      );
    }

    const params = message.params as
      | JsonRpcParams
      | undefined;

    const handler = handlers.get(message.method);

    if (!handler) {
      if (id === undefined) return undefined;

      return errorResponse(
        id,
        JsonRpcErrorCode.METHOD_NOT_FOUND,
        'Method not found',
      );
    }

    try {
      const result = await handler(params);

      // Notifications never receive JSON-RPC responses.
      if (id === undefined) return undefined;

      if (result === undefined) {
        throw new Error('Handler returned undefined');
      }

      // Verify that the result can be encoded as JSON.
      const encoded = JSON.stringify(result);

      if (encoded === undefined) {
        throw new Error('Handler returned invalid JSON');
      }

      return {
        jsonrpc: '2.0',
        id,
        result: JSON.parse(encoded) as JsonValue,
      };
    } catch (error) {
      if (id === undefined) return undefined;

      if (error instanceof InvalidParamsError) {
        return errorResponse(
          id,
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid params',
        );
      }

      // Do not expose internal exception details.
      return errorResponse(
        id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        'Internal error',
      );
    }
  };
}
