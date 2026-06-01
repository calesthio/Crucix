// safeFetch — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch, ago, today, daysAgo } from '../apis/utils/fetch.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────

function mockResponse(status, body, headers = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers)),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
  });
}

function mockNetworkError(message = 'fetch failed') {
  return Promise.reject(new Error(message));
}

// ─── safeFetch ────────────────────────────────────────────────────────────

describe('safeFetch', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return parsed JSON on success', async () => {
    globalThis.fetch = mock.fn(() => mockResponse(200, { foo: 'bar' }));
    const result = await safeFetch('https://example.com/api');
    assert.deepEqual(result, { foo: 'bar' });
  });

  it('should return rawText wrapper when response is not JSON', async () => {
    globalThis.fetch = mock.fn(() => mockResponse(200, 'plain text'));
    const result = await safeFetch('https://example.com/api');
    assert.equal(typeof result.rawText, 'string');
    assert.ok(result.rawText.startsWith('plain'));
  });

  it('should return error for non-retryable 4xx without retrying', async () => {
    const fn = mock.fn(() => mockResponse(404, 'Not Found'));
    globalThis.fetch = fn;
    const result = await safeFetch('https://example.com/api', { retries: 2 });
    assert.ok(result.error);
    assert.match(result.error, /HTTP 404/);
    // Should only have been called once — no retry for 404
    assert.equal(fn.mock.callCount(), 1);
  });

  it('should return error for 400 without retrying', async () => {
    const fn = mock.fn(() => mockResponse(400, 'Bad Request'));
    globalThis.fetch = fn;
    const result = await safeFetch('https://example.com/api', { retries: 2 });
    assert.ok(result.error);
    assert.match(result.error, /HTTP 400/);
    assert.equal(fn.mock.callCount(), 1);
  });

  it('should retry on 429 and succeed on retry', async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(() => {
      callCount++;
      if (callCount === 1) return mockResponse(429, 'Too Many Requests', { 'Retry-After': '1' });
      return mockResponse(200, { ok: true });
    });
    const result = await safeFetch('https://example.com/api', { retries: 2 });
    assert.deepEqual(result, { ok: true });
    assert.equal(callCount, 2);
  });

  it('should retry on 503 and succeed on retry', async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(() => {
      callCount++;
      if (callCount === 1) return mockResponse(503, 'Service Unavailable');
      return mockResponse(200, { ok: true });
    });
    const result = await safeFetch('https://example.com/api', { retries: 1 });
    assert.deepEqual(result, { ok: true });
    assert.equal(callCount, 2);
  });

  it('should respect Retry-After header on 429', async () => {
    const fn = mock.fn(() => mockResponse(429, 'Rate limited', { 'Retry-After': '2' }));
    globalThis.fetch = fn;
    const start = Date.now();
    await safeFetch('https://example.com/api', { retries: 1 });
    const elapsed = Date.now() - start;
    // Should have waited at least ~2s for the Retry-After
    assert.ok(elapsed >= 1800, `Expected >=1800ms delay, got ${elapsed}ms`);
  });

  it('should return error after exhausting retries on 429', async () => {
    const fn = mock.fn(() => mockResponse(429, 'Too Many Requests', { 'Retry-After': '1' }));
    globalThis.fetch = fn;
    const result = await safeFetch('https://example.com/api', { retries: 1 });
    assert.ok(result.error);
    assert.match(result.error, /429/);
    // Called once initially + 1 retry = 2 total
    assert.equal(fn.mock.callCount(), 2);
  });

  it('should retry on network error', async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(() => {
      callCount++;
      if (callCount === 1) return mockNetworkError('ECONNRESET');
      return mockResponse(200, { ok: true });
    });
    const result = await safeFetch('https://example.com/api', { retries: 1, timeout: 5000 });
    assert.deepEqual(result, { ok: true });
    assert.equal(callCount, 2);
  });

  it('should time out after specified timeout', async () => {
    globalThis.fetch = mock.fn((url, opts) => {
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new DOMException('The operation was aborted', 'AbortError');
          reject(err);
        });
      });
    });
    const result = await safeFetch('https://example.com/api', { timeout: 50, retries: 0 });
    assert.ok(result.error);
    assert.match(result.error, /timed out/i);
  });

  it('should use custom headers', async () => {
    let usedHeaders;
    globalThis.fetch = mock.fn((url, opts) => {
      usedHeaders = opts.headers;
      return mockResponse(200, {});
    });
    await safeFetch('https://example.com/api', { headers: { 'X-Custom': 'test' } });
    assert.equal(usedHeaders['X-Custom'], 'test');
    assert.equal(usedHeaders['User-Agent'], 'Crucix/1.0');
  });

  it('should send POST body when method is POST', async () => {
    let sentBody;
    globalThis.fetch = mock.fn((url, opts) => {
      sentBody = opts.body;
      return mockResponse(200, {});
    });
    await safeFetch('https://example.com/api', { method: 'POST', body: { key: 'value' } });
    assert.equal(sentBody, JSON.stringify({ key: 'value' }));
  });

  it('should not retry on 403 Forbidden', async () => {
    const fn = mock.fn(() => mockResponse(403, 'Forbidden'));
    globalThis.fetch = fn;
    const result = await safeFetch('https://example.com/api', { retries: 3 });
    assert.ok(result.error);
    assert.match(result.error, /HTTP 403/);
    assert.equal(fn.mock.callCount(), 1);
  });

  it('should retry on 408 Request Timeout', async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(() => {
      callCount++;
      if (callCount === 1) return mockResponse(408, 'Request Timeout');
      return mockResponse(200, { ok: true });
    });
    const result = await safeFetch('https://example.com/api', { retries: 1 });
    assert.deepEqual(result, { ok: true });
    assert.equal(callCount, 2);
  });

  it('should not exceed max backoff when Retry-After is excessive', async () => {
    const fn = mock.fn(() => mockResponse(429, 'Rate limited', { 'Retry-After': '300' }));
    globalThis.fetch = fn;
    const start = Date.now();
    await safeFetch('https://example.com/api', { retries: 1 });
    const elapsed = Date.now() - start;
    // Should have capped at MAX_RETRY_AFTER_SEC=60s, but with only 1 retry
    // and max total backoff of 30s, it should be well under 300s
    assert.ok(elapsed < 120000, `Expected <120s, got ${elapsed}ms`);
  });
});

// ─── date helpers ─────────────────────────────────────────────────────────

describe('date helpers', () => {
  it('ago should return ISO string in the past', () => {
    const result = ago(1);
    const diff = Date.now() - new Date(result).getTime();
    assert.ok(diff > 3_500_000 && diff < 3_700_000, `Expected ~1h ago, got ${diff}ms`);
  });

  it('today should return YYYY-MM-DD', () => {
    const result = today();
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('daysAgo should return YYYY-MM-DD in the past', () => {
    const result = daysAgo(5);
    const diff = Date.now() - new Date(result).getTime();
    assert.ok(diff > 4 * 86_400_000 && diff < 6 * 86_400_000, `Expected ~5 days ago, got ${diff}ms`);
  });
});
