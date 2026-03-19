// safeFetch / ago / today / daysAgo — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch, ago, today, daysAgo } from '../apis/utils/fetch.mjs';

// ─── safeFetch ────────────────────────────────────────────────────────────────

describe('safeFetch', () => {
  it('returns parsed JSON on successful fetch', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => '{"status":"ok","value":42}',
    });
    try {
      const result = await safeFetch('https://example.com/api');
      assert.deepEqual(result, { status: 'ok', value: 42 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns {rawText} when response body is not valid JSON', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => 'this is not json',
    });
    try {
      const result = await safeFetch('https://example.com/api');
      assert.ok('rawText' in result, 'Expected rawText field');
      assert.equal(result.rawText, 'this is not json');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns {error, source} when fetch throws', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('connection refused'); };
    try {
      const result = await safeFetch('https://example.com/api', { retries: 0 });
      assert.ok('error' in result, 'Expected error field');
      assert.ok('source' in result, 'Expected source field');
      assert.ok(result.error.includes('connection refused'));
      assert.equal(result.source, 'https://example.com/api');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('retries: first call fails, second succeeds — returns success result', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) throw new Error('network error');
      return { ok: true, text: async () => '{"ok":true}' };
    };
    try {
      // retries=1 means 2 total attempts (i=0 and i=1)
      const result = await safeFetch('https://example.com/api', { retries: 1, timeout: 15000 });
      assert.deepEqual(result, { ok: true });
      assert.equal(callCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('includes User-Agent: Crucix/1.0 in request headers', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders;
    globalThis.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      return { ok: true, text: async () => '{}' };
    };
    try {
      await safeFetch('https://example.com/api');
      assert.equal(capturedHeaders['User-Agent'], 'Crucix/1.0');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns {error, source} on HTTP non-ok response (e.g. 404)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });
    try {
      const result = await safeFetch('https://example.com/missing', { retries: 0 });
      assert.ok('error' in result, 'Expected error field');
      assert.ok(result.error.includes('404'), `Error should mention 404, got: ${result.error}`);
      assert.equal(result.source, 'https://example.com/missing');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── ago ──────────────────────────────────────────────────────────────────────

describe('ago', () => {
  it('returns ISO string approximately 1 hour ago', () => {
    const before = Date.now();
    const result = ago(1);
    const after = Date.now();

    assert.equal(typeof result, 'string');
    // Must be a valid ISO string
    assert.ok(!isNaN(Date.parse(result)), `Not a valid ISO string: ${result}`);

    const ts = new Date(result).getTime();
    const oneHourMs = 3600000;
    // Allow 1s tolerance on each side
    assert.ok(ts >= before - oneHourMs - 1000, 'Timestamp too far in the past');
    assert.ok(ts <= after - oneHourMs + 1000, 'Timestamp not far enough in the past');
  });
});

// ─── today ────────────────────────────────────────────────────────────────────

describe('today', () => {
  it('returns string in YYYY-MM-DD format', () => {
    const result = today();
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
    // Should equal today's date
    const expected = new Date().toISOString().split('T')[0];
    assert.equal(result, expected);
  });
});

// ─── daysAgo ──────────────────────────────────────────────────────────────────

describe('daysAgo', () => {
  it('returns string in YYYY-MM-DD format one day ago', () => {
    const result = daysAgo(1);
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);

    const d = new Date();
    d.setDate(d.getDate() - 1);
    const expected = d.toISOString().split('T')[0];
    assert.equal(result, expected);
  });

  it('daysAgo(0) equals today()', () => {
    assert.equal(daysAgo(0), today());
  });
});
