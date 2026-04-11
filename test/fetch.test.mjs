// safeFetch + date utilities — unit tests
// Uses Node.js built-in test runner (node:test)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';
import { safeFetch, ago, today, daysAgo } from '../apis/utils/fetch.mjs';

// ─── safeFetch Tests ───

describe('safeFetch', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  it('should return parsed JSON on success', async () => {
    const payload = { data: [1, 2, 3] };
    mockFetch(payload);

    const result = await safeFetch('https://example.com/api');
    assert.deepEqual(result, payload);
  });

  it('should send User-Agent header', async () => {
    let capturedOpts;
    const fn = mockFetch({ ok: true });
    // Override to capture
    globalThis.fetch = (url, opts) => {
      capturedOpts = opts;
      return fn();
    };

    await safeFetch('https://example.com/api');
    assert.equal(capturedOpts.headers['User-Agent'], 'Crucix/1.0');
  });

  it('should merge custom headers with defaults', async () => {
    let capturedOpts;
    const fn = mockFetch({ ok: true });
    globalThis.fetch = (url, opts) => {
      capturedOpts = opts;
      return fn();
    };

    await safeFetch('https://example.com/api', { headers: { 'X-Custom': 'test' } });
    assert.equal(capturedOpts.headers['User-Agent'], 'Crucix/1.0');
    assert.equal(capturedOpts.headers['X-Custom'], 'test');
  });

  it('should return error object on HTTP error after retries', async () => {
    // Mock returns non-ok response; the source reads res.text() on error
    globalThis.fetch = () => Promise.resolve({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const result = await safeFetch('https://example.com/fail', { retries: 0, timeout: 1000 });
    assert.ok(result.error);
    assert.match(result.error, /HTTP 500/);
    assert.equal(result.source, 'https://example.com/fail');
  });

  it('should return error object on network failure after retries', async () => {
    mockFetchError('ECONNREFUSED');

    const result = await safeFetch('https://example.com/down', { retries: 0, timeout: 1000 });
    assert.ok(result.error);
    assert.match(result.error, /ECONNREFUSED/);
    assert.equal(result.source, 'https://example.com/down');
  });

  it('should retry on failure up to retries count', async () => {
    let callCount = 0;
    globalThis.fetch = () => {
      callCount++;
      if (callCount < 2) {
        return Promise.reject(new Error('Transient'));
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('{"recovered":true}'),
      });
    };

    const result = await safeFetch('https://example.com/retry', { retries: 1, timeout: 5000 });
    assert.equal(callCount, 2);
    assert.equal(result.recovered, true);
  });

  it('should return rawText for non-JSON responses', async () => {
    globalThis.fetch = () => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('plain text response'),
    });

    const result = await safeFetch('https://example.com/text', { retries: 0 });
    assert.equal(result.rawText, 'plain text response');
  });

  it('should pass AbortController signal to fetch', async () => {
    let capturedOpts;
    globalThis.fetch = (url, opts) => {
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('{}'),
      });
    };

    await safeFetch('https://example.com/signal', { timeout: 5000, retries: 0 });
    assert.ok(capturedOpts.signal, 'should have an abort signal');
  });
});

// ─── Date Utility Tests ───

describe('ago', () => {
  it('should return ISO string N hours in the past', () => {
    const result = ago(2);
    const parsed = new Date(result);
    const diff = Date.now() - parsed.getTime();
    // Allow 100ms tolerance
    assert.ok(Math.abs(diff - 2 * 3600000) < 100, `Expected ~2h ago, got ${diff}ms diff`);
  });

  it('should return a valid ISO string', () => {
    const result = ago(0);
    assert.ok(result.endsWith('Z') || result.includes('+'), 'Should be ISO format');
    assert.ok(!isNaN(new Date(result).getTime()), 'Should be parseable');
  });
});

describe('today', () => {
  it('should return YYYY-MM-DD format', () => {
    const result = today();
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('should match current date', () => {
    const expected = new Date().toISOString().split('T')[0];
    assert.equal(today(), expected);
  });
});

describe('daysAgo', () => {
  it('should return YYYY-MM-DD format', () => {
    const result = daysAgo(5);
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('should return today for daysAgo(0)', () => {
    assert.equal(daysAgo(0), today());
  });

  it('should return correct date for daysAgo(1)', () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const expected = d.toISOString().split('T')[0];
    assert.equal(daysAgo(1), expected);
  });
});
