import type { JsonRpcHandler } from './dispatcher.js';
import { InvalidParamsError } from './errors.js';

export function createDiscoveryHandler(
  version: string,
): JsonRpcHandler {
  return (params) => {
    const meta = params?._meta;

    if (
      !params ||
      Object.keys(params).some((key) => key !== '_meta') ||
      typeof meta !== 'object' ||
      meta === null ||
      Array.isArray(meta)
    ) {
      throw new InvalidParamsError();
    }

    return {
      resultType: 'complete',
      supportedVersions: [version],
      capabilities: {},
    };
  };
}
