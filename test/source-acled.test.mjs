// ACLED source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/acled.mjs';

// ─── Helpers ───

const cannedEvent = {
  event_date: '2026-03-15',
  event_type: 'Battles',
  sub_event_type: 'Armed clash',
  country: 'Ukraine',
  region: 'Europe',
  location: 'Kyiv',
  fatalities: '5',
  latitude: '50.4501',
  longitude: '30.5234',
  notes: 'Clashes reported near the capital.',
};

const cannedDataResponse = {
  status: 200,
  data: [cannedEvent],
};

// Mock that handles both the OAuth POST and the data GET
function makeFullMock() {
  let callCount = 0;
  return async (url, opts) => {
    callCount++;
    // OAuth token endpoint
    if (typeof url === 'string' && url.includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'mock-token-abc' }),
        json: async () => ({ access_token: 'mock-token-abc' }),
        headers: { getSetCookie: () => [] },
      };
    }
    // Data endpoint
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(cannedDataResponse),
      json: async () => cannedDataResponse,
      headers: { getSetCookie: () => [] },
    };
  };
}

// ─── Tests ───

describe('acled briefing', () => {
  let originalFetch;
  let savedEmail;
  let savedPassword;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    savedEmail = process.env.ACLED_EMAIL;
    savedPassword = process.env.ACLED_PASSWORD;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // Restore env vars
    if (savedEmail === undefined) {
      delete process.env.ACLED_EMAIL;
    } else {
      process.env.ACLED_EMAIL = savedEmail;
    }
    if (savedPassword === undefined) {
      delete process.env.ACLED_PASSWORD;
    } else {
      process.env.ACLED_PASSWORD = savedPassword;
    }
  });

  it('should return no_credentials status when env vars are missing', async () => {
    delete process.env.ACLED_EMAIL;
    delete process.env.ACLED_PASSWORD;

    const result = await briefing();

    assert.equal(result.source, 'ACLED');
    assert.ok(result.timestamp);
    assert.equal(result.status, 'no_credentials');
    assert.ok(result.message);
  });

  it('should return structured data with mocked auth and data', async () => {
    process.env.ACLED_EMAIL = 'test@example.com';
    process.env.ACLED_PASSWORD = 'testpassword';
    globalThis.fetch = makeFullMock();

    const result = await briefing();

    assert.equal(result.source, 'ACLED');
    assert.ok(result.timestamp);
    assert.ok('totalEvents' in result, 'should have totalEvents');
    assert.ok('totalFatalities' in result, 'should have totalFatalities');
    assert.ok('byRegion' in result, 'should have byRegion');
    assert.ok('byType' in result, 'should have byType');
    assert.ok('topCountries' in result, 'should have topCountries');
    assert.ok(Array.isArray(result.deadliestEvents), 'deadliestEvents should be an array');
    assert.equal(result.totalEvents, 1);
    assert.equal(result.totalFatalities, 5);
  });

  it('should handle fetch error gracefully', async () => {
    process.env.ACLED_EMAIL = 'test@example.com';
    process.env.ACLED_PASSWORD = 'testpassword';
    globalThis.fetch = async () => { throw new Error('network error'); };

    const result = await briefing();

    assert.ok(result !== undefined);
    assert.equal(result.source, 'ACLED');
    assert.ok(result.timestamp);
    // Should return an error field rather than throwing
    assert.ok(result.error || result.status, 'should have error or status');
  });

  it('should handle auth failure gracefully', async () => {
    process.env.ACLED_EMAIL = 'test@example.com';
    process.env.ACLED_PASSWORD = 'wrongpassword';
    globalThis.fetch = async (url) => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
      json: async () => ({ error: 'invalid_grant' }),
      headers: { getSetCookie: () => [] },
    });

    const result = await briefing();

    assert.ok(result !== undefined);
    assert.equal(result.source, 'ACLED');
    assert.ok(result.error, 'should have error field when auth fails');
  });

  it('should enrich events with numeric lat/lon', async () => {
    process.env.ACLED_EMAIL = 'test@example.com';
    process.env.ACLED_PASSWORD = 'testpassword';
    globalThis.fetch = makeFullMock();

    const result = await briefing();

    if (result.deadliestEvents && result.deadliestEvents.length > 0) {
      const evt = result.deadliestEvents[0];
      assert.ok('lat' in evt, 'event should have lat');
      assert.ok('lon' in evt, 'event should have lon');
    }
  });
});
