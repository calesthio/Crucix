// ReliefWeb source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/reliefweb.mjs';

const CANNED_RELIEFWEB = {
  data: [
    {
      id: '123',
      fields: {
        title: 'Test Report',
        date: { created: '2026-01-01T00:00:00+00:00' },
        country: [{ name: 'Test Country' }],
        disaster_type: [{ name: 'Flood' }],
        source: [{ name: 'UNOCHA' }],
      },
    },
  ],
  totalCount: 1,
};

describe('reliefweb briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RELIEFWEB),
      json: async () => CANNED_RELIEFWEB,
    });
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      // Should use ReliefWeb path (not HDX fallback) since fetch succeeded
      assert.equal(result.source, 'ReliefWeb (UN OCHA)');
      assert.ok(Array.isArray(result.latestReports));
      assert.ok(Array.isArray(result.activeDisasters));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maps report fields correctly', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RELIEFWEB),
      json: async () => CANNED_RELIEFWEB,
    });
    try {
      const result = await briefing();
      const report = result.latestReports[0];
      assert.equal(report.title, 'Test Report');
      assert.equal(report.date, '2026-01-01T00:00:00+00:00');
      assert.deepEqual(report.countries, ['Test Country']);
      assert.deepEqual(report.disasterType, ['Flood']);
      assert.deepEqual(report.source, ['UNOCHA']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to HDX on HTTP error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('reliefweb.int')) {
        // Return 403 — simulates unapproved appname
        return {
          ok: false,
          status: 403,
          text: async () => 'Forbidden',
          json: async () => { throw new Error('not json'); },
        };
      }
      // HDX fallback
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: { results: [] } }),
        json: async () => ({ result: { results: [] } }),
      };
    };
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      // Should fall back to HDX
      assert.ok(result.source.includes('HDX'));
      assert.ok(Array.isArray(result.hdxDatasets));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles fetch failure gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.ok(result.source);
      assert.ok(result.timestamp);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns a valid ISO timestamp', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RELIEFWEB),
      json: async () => CANNED_RELIEFWEB,
    });
    try {
      const result = await briefing();
      assert.ok(!isNaN(Date.parse(result.timestamp)));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
