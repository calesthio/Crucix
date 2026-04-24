import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('/Users/rightclaw/services/crucix/server.mjs', 'utf8');

function between(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle);
  if (start === -1 || end === -1 || end <= start) throw new Error(`could not extract ${startNeedle}..${endNeedle}`);
  return source.slice(start, end);
}

const code = [
  between('function isLocalRequest', 'function readOpenSkyRuntimeState'),
  'module.exports = { isLocalRequest, requireDebugAccess };',
].join('\n');

const context = {
  module: { exports: {} },
  exports: {},
  console,
  config: { debugEndpoints: { exposure: 'local-only' } },
};
vm.createContext(context);
vm.runInContext(code, context);
const { isLocalRequest, requireDebugAccess } = context.module.exports;

test('isLocalRequest accepts loopback addresses', () => {
  assert.equal(isLocalRequest({ ip: '127.0.0.1', socket: {} }), true);
  assert.equal(isLocalRequest({ ip: '::1', socket: {} }), true);
  assert.equal(isLocalRequest({ ip: '::ffff:127.0.0.1', socket: {} }), true);
});

test('requireDebugAccess blocks non-local requests by default', () => {
  let statusCode = null;
  let body = null;
  let nextCalled = false;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; },
  };
  requireDebugAccess({ ip: '203.0.113.10', socket: { remoteAddress: '203.0.113.10' } }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.equal(body.error, 'debug-endpoint-forbidden');
});

test('requireDebugAccess allows non-local requests when exposure is open', () => {
  context.config.debugEndpoints.exposure = 'open';
  let nextCalled = false;
  requireDebugAccess({ ip: '203.0.113.10', socket: { remoteAddress: '203.0.113.10' } }, { status() { throw new Error('should not block'); }, json() { throw new Error('should not block'); } }, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  context.config.debugEndpoints.exposure = 'local-only';
});
