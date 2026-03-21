// OpenSky source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/opensky.mjs';

// State vector format is positional array:
// [icao24, callsign, origin_country, time_position, last_contact,
//  longitude, latitude, baro_altitude, on_ground, velocity,
//  true_track, vertical_rate, sensors, geo_altitude, squawk, spi, position_source]
const CANNED_RESPONSE = {
  states: [
    ['abc123', 'UAL100  ', 'United States', 1700000000, 1700000000,
      -87.6, 41.9, 35000, false, 250, 180, null, null, null, 'squawk', false, 0],
  ],
};

describe('opensky briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      assert.equal(result.source, 'OpenSky');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns hotspots array with one entry per defined region', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      assert.ok(Array.isArray(result.hotspots));
      // 10 HOTSPOTS defined in the source
      assert.equal(result.hotspots.length, 10);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('counts aircraft per hotspot from states array', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      const hotspot = result.hotspots[0];
      assert.ok(hotspot.region);
      assert.ok(hotspot.key);
      assert.equal(hotspot.totalAircraft, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('groups aircraft by origin country', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      const hotspot = result.hotspots[0];
      assert.ok(typeof hotspot.byCountry === 'object');
      assert.equal(hotspot.byCountry['United States'], 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('counts high-altitude aircraft (above 12000m)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      const hotspot = result.hotspots[0];
      // baro_altitude is index 7: 35000 > 12000, so highAltitude = 1
      assert.equal(hotspot.highAltitude, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('counts aircraft with no callsign', async () => {
    const originalFetch = globalThis.fetch;
    const noCallsignResponse = {
      states: [
        ['def456', '        ', 'Russia', 1700000000, 1700000000,
          35.0, 55.0, 10000, false, 200, 0, null, null, null, null, false, 0],
      ],
    };
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(noCallsignResponse),
    });
    try {
      const result = await briefing();
      const hotspot = result.hotspots[0];
      assert.equal(hotspot.noCallsign, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles fetch failure gracefully and reports error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'OpenSky');
      assert.ok(Array.isArray(result.hotspots));
      // All hotspots should have errors when fetch fails
      assert.ok(result.hotspots.every(h => h.error));
      // Top-level error string should be present
      assert.ok(result.error);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles HTTP error response gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests',
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'OpenSky');
      assert.ok(Array.isArray(result.hotspots));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
