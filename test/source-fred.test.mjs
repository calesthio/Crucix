// FRED — Federal Reserve Economic Data — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/fred.mjs';

const CANNED_OBSERVATIONS = {
  observations: [
    { date: '2026-01-01', value: '20.5' },
    { date: '2025-12-01', value: '19.8' },
    { date: '2025-11-01', value: '19.2' },
    { date: '2025-10-01', value: '.' },
    { date: '2025-09-01', value: '18.9' },
  ],
};

describe('fred briefing', () => {
  it('returns error/hint when no API key is provided', async () => {
    const result = await briefing(null);
    assert.ok(result !== undefined);
    assert.equal(result.source, 'FRED');
    assert.ok(result.error || result.hint);
    assert.ok(typeof result.error === 'string');
  });

  it('returns error/hint when undefined key is provided', async () => {
    const result = await briefing(undefined);
    assert.ok(result !== undefined);
    assert.equal(result.source, 'FRED');
    assert.ok(result.error);
  });

  it('returns structured data on success with mocked fetch', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_OBSERVATIONS),
    });
    try {
      const result = await briefing('test-fred-api-key');
      assert.ok(result !== undefined);
      assert.equal(result.source, 'FRED');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.indicators));
      assert.ok(Array.isArray(result.signals));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles fetch failure gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    try {
      const result = await briefing('test-fred-api-key');
      assert.ok(result !== undefined); // must not throw
      assert.equal(result.source, 'FRED');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles non-ok HTTP response gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });
    try {
      const result = await briefing('test-fred-api-key');
      assert.ok(result !== undefined);
      assert.equal(result.source, 'FRED');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('filters out null-value indicators', async () => {
    const originalFetch = globalThis.fetch;
    // Return empty observations — all series will have value: null
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ observations: [] }),
    });
    try {
      const result = await briefing('test-fred-api-key');
      assert.ok(Array.isArray(result.indicators));
      // All values are null, so indicators array should be empty
      assert.equal(result.indicators.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
