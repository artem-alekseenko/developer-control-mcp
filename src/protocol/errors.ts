export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export class InvalidParamsError extends Error {
  constructor(message = 'Invalid params') {
    super(message);
    this.name = 'InvalidParamsError';
  }
}
