// EPA RadNet — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/epa.mjs';

const CANNED_RECORD = {
  ANA_CITY: 'Washington',
  ANA_STATE: 'DC',
  ANA_TYPE: 'GROSS BETA',
  ANA_RESULT: '0.05',
  ANA_COLLECT_DATE: '2026-01-01',
  RESULT_UNIT: 'pCi/m3',
  SAMPLE_TYPE: 'AIR',
};

describe('epa briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([CANNED_RECORD]),
    });
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      assert.equal(result.source, 'EPA RadNet');
      assert.ok(typeof result.totalReadings === 'number');
      assert.ok(Array.isArray(result.readings));
      assert.ok(Array.isArray(result.signals));
      assert.ok(Array.isArray(result.monitoredAnalytes));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns structured data with empty array response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([]),
    });
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      assert.equal(result.totalReadings, 0);
      assert.ok(Array.isArray(result.readings));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles fetch failure gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    try {
      const result = await briefing();
      assert.ok(result !== undefined); // must not throw
      assert.equal(result.source, 'EPA RadNet');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles non-ok HTTP response gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'EPA RadNet');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('includes stateSummary in output', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([CANNED_RECORD]),
    });
    try {
      const result = await briefing();
      assert.ok(result.stateSummary !== undefined);
      assert.ok(typeof result.stateSummary === 'object');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
