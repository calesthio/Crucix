// NASA FIRMS — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/firms.mjs';

const CANNED_CSV = `latitude,longitude,bright_ti4,frp,acq_date,confidence,daynight
38.9,-77.0,320.5,15.2,2026-01-01,h,D
34.1,-118.2,310.0,8.5,2026-01-01,n,N`;

describe('firms briefing', () => {
  it('returns no_key status when FIRMS_MAP_KEY is not set', async () => {
    const originalKey = process.env.FIRMS_MAP_KEY;
    delete process.env.FIRMS_MAP_KEY;
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'NASA FIRMS');
      assert.equal(result.status, 'no_key');
      assert.ok(result.message);
    } finally {
      if (originalKey !== undefined) {
        process.env.FIRMS_MAP_KEY = originalKey;
      }
    }
  });

  it('returns structured data on success with mocked CSV', async () => {
    const originalKey = process.env.FIRMS_MAP_KEY;
    process.env.FIRMS_MAP_KEY = 'test-key-123';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => CANNED_CSV,
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'NASA FIRMS');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.hotspots));
      assert.ok(Array.isArray(result.signals));
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey !== undefined) {
        process.env.FIRMS_MAP_KEY = originalKey;
      } else {
        delete process.env.FIRMS_MAP_KEY;
      }
    }
  });

  it('handles fetch failure gracefully when key is set', async () => {
    const originalKey = process.env.FIRMS_MAP_KEY;
    process.env.FIRMS_MAP_KEY = 'test-key-123';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    try {
      const result = await briefing();
      assert.ok(result !== undefined); // must not throw
      assert.equal(result.source, 'NASA FIRMS');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey !== undefined) {
        process.env.FIRMS_MAP_KEY = originalKey;
      } else {
        delete process.env.FIRMS_MAP_KEY;
      }
    }
  });

  it('handles non-ok HTTP response gracefully', async () => {
    const originalKey = process.env.FIRMS_MAP_KEY;
    process.env.FIRMS_MAP_KEY = 'test-key-123';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'NASA FIRMS');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey !== undefined) {
        process.env.FIRMS_MAP_KEY = originalKey;
      } else {
        delete process.env.FIRMS_MAP_KEY;
      }
    }
  });
});
