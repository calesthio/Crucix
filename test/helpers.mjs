// Shared test helpers for Crucix test suite
// Uses node:test built-in — no external dependencies

import { mock } from 'node:test';

/**
 * Create a mock fetch that returns a successful JSON response.
 * Replaces globalThis.fetch and returns the mock for assertions.
 */
export function mockFetch(body, { status = 200, headers = {} } = {}) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  const fn = mock.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json', ...headers }),
      text: () => Promise.resolve(json),
      json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
    })
  );
  globalThis.fetch = fn;
  return fn;
}

/**
 * Create a mock fetch that rejects with a network error.
 */
export function mockFetchError(message = 'Network error') {
  const fn = mock.fn(() => Promise.reject(new Error(message)));
  globalThis.fetch = fn;
  return fn;
}

/**
 * Create a mock fetch that returns an HTTP error status.
 */
export function mockFetchStatus(status, body = '') {
  return mockFetch(body, { status });
}

/**
 * Restore globalThis.fetch to the original.
 * Call this in afterEach or after blocks.
 */
let _originalFetch;
export function saveFetch() {
  _originalFetch = globalThis.fetch;
}

export function restoreFetch() {
  if (_originalFetch) globalThis.fetch = _originalFetch;
}

/**
 * Create a minimal Express-like request object for testing middleware/routes.
 */
export function mockReq(overrides = {}) {
  return {
    method: 'GET',
    url: '/',
    headers: {},
    query: {},
    params: {},
    body: null,
    ...overrides,
  };
}

/**
 * Create a minimal Express-like response object for testing middleware/routes.
 */
export function mockRes() {
  const res = {
    statusCode: 200,
    _headers: {},
    _body: null,
    _jsonBody: null,
    status(code) { res.statusCode = code; return res; },
    json(data) { res._jsonBody = data; return res; },
    send(data) { res._body = data; return res; },
    set(key, val) { res._headers[key] = val; return res; },
    setHeader(key, val) { res._headers[key] = val; return res; },
    end() { return res; },
    write(chunk) { res._body = (res._body || '') + chunk; return true; },
    headersSent: false,
  };
  return res;
}

/**
 * Temporarily set environment variables, restoring originals after the callback.
 */
export async function withEnv(vars, fn) {
  const originals = {};
  for (const [key, val] of Object.entries(vars)) {
    originals[key] = process.env[key];
    if (val === undefined || val === null) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, val] of Object.entries(originals)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  }
}
