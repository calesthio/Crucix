// ADS-B Exchange source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/adsb.mjs';

// ─── Canned responses ───

const militaryAircraftResponse = {
  ac: [
    {
      hex: 'AE1234',       // US Military hex range
      flight: 'RCH001  ', // AMC callsign pattern
      t: 'KC135',         // KC-135 Stratotanker — known military type
      lat: 38.9,
      lon: -77.0,
      alt_baro: 30000,
      gs: 450,
      track: 270,
      squawk: '7500',
      r: 'USAF-001',
      seen: 2,
    },
  ],
};

const civilianAircraftResponse = {
  ac: [
    {
      hex: 'ABC123',
      flight: 'UAF001  ',
      t: 'B738',
      lat: 38.9,
      lon: -77.0,
      alt_baro: 30000,
      gs: 450,
      track: 90,
    },
  ],
};

const emptyResponse = { ac: [] };

// ─── Tests ───

describe('adsb briefing', () => {
  let originalFetch;
  let savedApiKey;
  let savedRapidKey;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    savedApiKey = process.env.ADSB_API_KEY;
    savedRapidKey = process.env.RAPIDAPI_KEY;
    // Remove env keys so briefing uses public feed path
    delete process.env.ADSB_API_KEY;
    delete process.env.RAPIDAPI_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (savedApiKey === undefined) {
      delete process.env.ADSB_API_KEY;
    } else {
      process.env.ADSB_API_KEY = savedApiKey;
    }
    if (savedRapidKey === undefined) {
      delete process.env.RAPIDAPI_KEY;
    } else {
      process.env.RAPIDAPI_KEY = savedRapidKey;
    }
  });

  it('should return no_key status when no API key configured', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
      json: async () => emptyResponse,
    });

    const result = await briefing();

    assert.equal(result.source, 'ADS-B Exchange');
    assert.ok(result.timestamp);
    assert.equal(result.status, 'no_key');
    assert.ok(result.message);
    assert.ok(Array.isArray(result.militaryAircraft));
  });

  it('should return structured data with mocked military aircraft', async () => {
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(militaryAircraftResponse),
      json: async () => militaryAircraftResponse,
    });

    const result = await briefing();

    assert.equal(result.source, 'ADS-B Exchange');
    assert.ok(result.timestamp);
    // With military aircraft detected, should have live status
    assert.equal(result.status, 'live');
    assert.ok(typeof result.totalMilitary === 'number');
    assert.ok(result.totalMilitary > 0);
    assert.ok('byCountry' in result);
    assert.ok('categories' in result);
    assert.ok(Array.isArray(result.militaryAircraft));
    assert.ok(Array.isArray(result.signals));
  });

  it('should return integration guide when public feed returns empty', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(emptyResponse),
      json: async () => emptyResponse,
    });

    const result = await briefing();

    assert.equal(result.source, 'ADS-B Exchange');
    assert.ok(result.timestamp);
    assert.ok(result.status === 'no_key' || result.status === 'error');
    assert.ok(Array.isArray(result.militaryAircraft));
    assert.ok(result.integrationGuide, 'should include integration guide');
  });

  it('should handle fetch error gracefully', async () => {
    globalThis.fetch = async () => { throw new Error('network error'); };

    const result = await briefing();

    assert.ok(result !== undefined);
    assert.equal(result.source, 'ADS-B Exchange');
    assert.ok(result.timestamp);
    // Should return a structured response without throwing
    assert.ok(result.status);
  });

  it('should classify aircraft correctly and include categories', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(militaryAircraftResponse),
      json: async () => militaryAircraftResponse,
    });

    const result = await briefing();

    if (result.status === 'live') {
      assert.ok('reconnaissance' in result.categories, 'should have reconnaissance category');
      assert.ok('bombers' in result.categories, 'should have bombers category');
      assert.ok('tankers' in result.categories, 'should have tankers category');
      assert.ok('vipTransport' in result.categories, 'should have vipTransport category');
    }
  });
});
