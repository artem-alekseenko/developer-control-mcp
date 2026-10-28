import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createJsonRpcDispatcher,
  type JsonRpcHandler,
} from '../../src/protocol/dispatcher.js';

import {
  InvalidParamsError,
  JsonRpcErrorCode,
} from '../../src/protocol/errors.js';

function createFixture() {
  const handlers = new Map<string, JsonRpcHandler>();

  handlers.set('demo/echo', (params) => {
    const message = params?.message;

    if (typeof message !== 'string') {
      throw new InvalidParamsError();
    }

    return {
      resultType: 'complete',
      message,
    };
  });

  handlers.set('demo/crash', () => {
    throw new Error('private internal error details');
  });

  return createJsonRpcDispatcher(handlers);
}

test('returns a successful result', async () => {
  const dispatch = createFixture();

  const response = await dispatch(JSON.stringify({
    jsonrpc: '2.0',
    id: 'request-1',
    method: 'demo/echo',
    params: { message: 'hello' },
  }));

  assert.deepEqual(response, {
    jsonrpc: '2.0',
    id: 'request-1',
    result: {
      resultType: 'complete',
      message: 'hello',
    },
  });
});

test('preserves numeric ID zero', async () => {
  const dispatch = createFixture();

  const response = await dispatch(JSON.stringify({
    jsonrpc: '2.0',
    id: 0,
    method: 'demo/echo',
    params: { message: 'pong' },
  }));

  assert.equal(response?.id, 0);
});

test('reports malformed JSON', async () => {
  const dispatch = createFixture();

  const response = await dispatch('{invalid');

  assert.deepEqual(response, {
    jsonrpc: '2.0',
    id: null,
    error: {
      code: JsonRpcErrorCode.PARSE_ERROR,
      message: 'Parse error',
    },
  });
});

test('rejects invalid requests', async () => {
  const dispatch = createFixture();

  const invalidMessages = [
    'null',
    '[]',
    '{}',
    '{"jsonrpc":"1.0","method":"demo/echo","id":1}',
    '{"jsonrpc":"2.0","method":"demo/echo","id":null}',
    '{"jsonrpc":"2.0","method":"demo/echo","id":1.5}',
    '{"jsonrpc":"2.0","method":"demo/echo","id":9007199254740992}',
    '{"jsonrpc":"2.0","method":"rpc.internal","id":1}',
  ];

  for (const payload of invalidMessages) {
    const response = await dispatch(payload);

    assert.deepEqual(response, {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: JsonRpcErrorCode.INVALID_REQUEST,
        message: 'Invalid Request',
      },
    });
  }
});

test('rejects positional params', async () => {
  const dispatch = createFixture();

  const response = await dispatch(JSON.stringify({
    jsonrpc: '2.0',
    id: 10,
    method: 'demo/echo',
    params: ['hello'],
  }));

  assert.deepEqual(response, {
    jsonrpc: '2.0',
    id: 10,
    error: {
      code: JsonRpcErrorCode.INVALID_PARAMS,
      message: 'Invalid params',
    },
  });
});

test('rejects an unknown method', async () => {
  const dispatch = createFixture();

  const response = await dispatch(JSON.stringify({
    jsonrpc: '2.0',
    id: 11,
    method: 'missing/method',
  }));

  assert.deepEqual(response, {
    jsonrpc: '2.0',
    id: 11,
    error: {
      code: JsonRpcErrorCode.METHOD_NOT_FOUND,
      message: 'Method not found',
    },
  });
});

test('maps handler validation errors', async () => {
  const dispatch = createFixture();

  const response = await dispatch(JSON.stringify({
    jsonrpc: '2.0',
    id: 12,
    method: 'demo/echo',
    params: {},
  }));

  assert.deepEqual(response, {
    jsonrpc: '2.0',
    id: 12,
    error: {
      code: JsonRpcErrorCode.INVALID_PARAMS,
      message: 'Invalid params',
    },
  });
});

test('hides internal exception details', async () => {
  const dispatch = createFixture();

  const response = await dispatch(JSON.stringify({
    jsonrpc: '2.0',
    id: 13,
    method: 'demo/crash',
  }));

  assert.deepEqual(response, {
    jsonrpc: '2.0',
    id: 13,
    error: {
      code: JsonRpcErrorCode.INTERNAL_ERROR,
      message: 'Internal error',
    },
  });
});

test('executes notifications without responses', async () => {
  let calls = 0;

  const handlers = new Map<string, JsonRpcHandler>();

  handlers.set('demo/notify', () => {
    calls += 1;
    return null;
  });

  const dispatch = createJsonRpcDispatcher(handlers);

  const response = await dispatch(JSON.stringify({
    jsonrpc: '2.0',
    method: 'demo/notify',
  }));

  assert.equal(response, undefined);
  assert.equal(calls, 1);
});

test('does not reply to unknown notifications', async () => {
  const dispatch = createFixture();

  const response = await dispatch(JSON.stringify({
    jsonrpc: '2.0',
    method: 'unknown/notification',
  }));

  assert.equal(response, undefined);
});
