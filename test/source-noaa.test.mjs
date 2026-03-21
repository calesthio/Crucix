// NOAA source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/noaa.mjs';

const CANNED_RESPONSE = {
  features: [
    {
      properties: {
        event: 'Tornado Warning',
        severity: 'Extreme',
        urgency: 'Immediate',
        headline: 'Test alert',
        areaDesc: 'Test County',
        effective: '2026-01-01T00:00:00Z',
        expires: '2026-01-01T06:00:00Z',
      },
      geometry: {
        type: 'Point',
        coordinates: [-90.0, 35.0],
      },
    },
  ],
};

describe('noaa briefing', () => {
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
      assert.equal(result.source, 'NOAA/NWS');
      assert.equal(typeof result.totalSevereAlerts, 'number');
      assert.ok(result.summary);
      assert.ok(Array.isArray(result.topAlerts));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('counts tornado warnings in summary', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      assert.equal(result.totalSevereAlerts, 1);
      assert.equal(result.summary.tornadoes, 1);
      assert.equal(result.summary.hurricanes, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maps Point geometry to lat/lon in topAlerts', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      const alert = result.topAlerts[0];
      assert.ok(alert);
      assert.equal(alert.event, 'Tornado Warning');
      assert.equal(alert.severity, 'Extreme');
      assert.equal(alert.lat, 35.0);
      assert.equal(alert.lon, -90.0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles empty features array gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ features: [] }),
    });
    try {
      const result = await briefing();
      assert.equal(result.totalSevereAlerts, 0);
      assert.deepEqual(result.topAlerts, []);
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
      assert.equal(result.source, 'NOAA/NWS');
      // On fetch failure, safeFetch returns { error }, so features defaults to []
      assert.equal(result.totalSevereAlerts, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles HTTP error response gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'NOAA/NWS');
      assert.equal(result.totalSevereAlerts, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
