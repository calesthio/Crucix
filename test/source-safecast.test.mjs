// Safecast source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/safecast.mjs';

const CANNED_MEASUREMENTS = [
  {
    id: 1,
    value: 15.5,
    unit: 'cpm',
    latitude: 35.6,
    longitude: 139.7,
    captured_at: '2026-01-01T00:00:00Z',
    location_name: 'Tokyo',
  },
];

describe('safecast briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_MEASUREMENTS),
      json: async () => CANNED_MEASUREMENTS,
    });
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      assert.equal(result.source, 'Safecast');
      assert.ok(Array.isArray(result.sites));
      assert.ok(Array.isArray(result.signals));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns one entry per monitored nuclear site', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_MEASUREMENTS),
      json: async () => CANNED_MEASUREMENTS,
    });
    try {
      const result = await briefing();
      // safecast.mjs defines 6 NUCLEAR_SITES
      assert.equal(result.sites.length, 6);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('computes avgCPM and recentReadings from measurement values', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_MEASUREMENTS),
      json: async () => CANNED_MEASUREMENTS,
    });
    try {
      const result = await briefing();
      const site = result.sites[0];
      assert.ok('avgCPM' in site);
      assert.ok('recentReadings' in site);
      assert.ok('maxCPM' in site);
      assert.ok('anomaly' in site);
      // 15.5 CPM is within normal range (10-80), so anomaly should be false
      assert.equal(site.anomaly, false);
      assert.equal(site.avgCPM, 15.5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('flags anomaly when avgCPM exceeds 100', async () => {
    const highRadiation = [{ id: 2, value: 250, captured_at: '2026-01-01T00:00:00Z' }];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(highRadiation),
      json: async () => highRadiation,
    });
    try {
      const result = await briefing();
      const elevated = result.sites.find(s => s.anomaly === true);
      assert.ok(elevated, 'Expected at least one site with anomaly=true');
      assert.ok(result.signals.some(s => s.includes('ELEVATED RADIATION')));
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
      assert.ok(Array.isArray(result.sites));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns normal signal when no anomalies detected with empty data', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([]),
      json: async () => [],
    });
    try {
      const result = await briefing();
      assert.ok(result.signals.some(s => s.includes('normal')));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
