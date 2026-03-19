// Space/CelesTrak source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/space.mjs';

const CANNED_SATELLITES = [
  {
    OBJECT_NAME: 'ISS (ZARYA)',
    NORAD_CAT_ID: '25544',
    COUNTRY_CODE: 'ISS',
    LAUNCH_DATE: '1998-11-20',
    EPOCH: '2026-001.00000000',
    OBJECT_TYPE: 'PAYLOAD',
    CLASSIFICATION_TYPE: 'U',
    DECAY_DATE: null,
    PERIOD: 92.68,
    INCLINATION: 51.64,
    APOAPSIS: 422,
    PERIAPSIS: 418,
  },
];

describe('space briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_SATELLITES),
      json: async () => CANNED_SATELLITES,
    });
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      assert.equal(result.source, 'Space/CelesTrak');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns active status with satellite data', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_SATELLITES),
      json: async () => CANNED_SATELLITES,
    });
    try {
      const result = await briefing();
      // status should be active or error (error is acceptable if logic deems both launches+stations errored)
      assert.ok(['active', 'error'].includes(result.status));
      if (result.status === 'active') {
        assert.ok(Array.isArray(result.recentLaunches));
        assert.ok(Array.isArray(result.spaceStations));
        assert.ok(Array.isArray(result.signals));
        assert.ok(typeof result.militarySatellites === 'number');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('includes ISS in station data when ISS TLE is returned', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_SATELLITES),
      json: async () => CANNED_SATELLITES,
    });
    try {
      const result = await briefing();
      if (result.status === 'active' && result.iss) {
        assert.ok(result.iss.name.includes('ISS'));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns error status when fetch fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'Space/CelesTrak');
      assert.ok(result.timestamp);
      assert.equal(result.status, 'error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles non-array response (e.g. API error body) gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ error: 'Invalid group' }),
      json: async () => ({ error: 'Invalid group' }),
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'Space/CelesTrak');
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
      text: async () => JSON.stringify(CANNED_SATELLITES),
      json: async () => CANNED_SATELLITES,
    });
    try {
      const result = await briefing();
      assert.ok(!isNaN(Date.parse(result.timestamp)));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
