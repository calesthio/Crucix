// NY Fed GSCPI — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/gscpi.mjs';

// Canned CSV in NY Fed wide-format: Date column + one value column (latest vintage)
const CANNED_CSV = `Date,GSCPI_2026-01,GSCPI_2025-12,GSCPI_2025-11
31-Jan-2026,0.5,,
31-Dec-2025,0.3,0.3,
31-Nov-2025,0.1,0.1,0.1`;

// Simpler two-column CSV also acceptable
const SIMPLE_CSV = `Date,GSCPI
31-Jan-2026,0.5
31-Dec-2025,0.3
31-Nov-2025,0.1`;

describe('gscpi briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => SIMPLE_CSV,
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'NY Fed GSCPI');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.history));
      assert.ok(Array.isArray(result.signals));
      assert.ok(typeof result.trend === 'string');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('includes latest reading in output', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => SIMPLE_CSV,
    });
    try {
      const result = await briefing();
      assert.ok(result.latest !== null);
      assert.ok(typeof result.latest.value === 'number');
      assert.ok(typeof result.latest.date === 'string');
      assert.ok(typeof result.latest.interpretation === 'string');
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
      assert.equal(result.source, 'NY Fed GSCPI');
      assert.ok(result.error);
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
      assert.equal(result.source, 'NY Fed GSCPI');
      assert.ok(result.error);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('detects trend correctly from multi-month data', async () => {
    const originalFetch = globalThis.fetch;
    // Rising trend: each more recent month is higher
    const risingCsv = `Date,GSCPI
31-Jan-2026,1.5
31-Dec-2025,1.0
31-Nov-2025,0.5`;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => risingCsv,
    });
    try {
      const result = await briefing();
      assert.equal(result.trend, 'rising');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sorts history newest-first', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => SIMPLE_CSV,
    });
    try {
      const result = await briefing();
      if (result.history.length >= 2) {
        // Dates are "YYYY-MM" strings, newest first means desc order
        assert.ok(result.history[0].date >= result.history[1].date);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
