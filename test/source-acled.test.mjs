import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError, mockFetchStatus, withEnv } from './helpers.mjs';

// We need to dynamically import acled since it has side effects (env loading, session cache)
let acledModule;

before(() => { saveFetch(); });
after(() => { restoreFetch(); });

describe('ACLED source', () => {
  beforeEach(async () => {
    // Fresh import each time to avoid cached sessions bleeding between tests
    // We can't truly re-import in ESM, so we import once and reset cache indirectly
    if (!acledModule) {
      acledModule = await import('../apis/sources/acled.mjs');
    }
  });

  describe('EVENT_TYPES', () => {
    it('exports the expected event type constants', async () => {
      const mod = await import('../apis/sources/acled.mjs');
      assert.ok(Array.isArray(mod.EVENT_TYPES));
      assert.ok(mod.EVENT_TYPES.length >= 6);
      assert.ok(mod.EVENT_TYPES.includes('Battles'));
      assert.ok(mod.EVENT_TYPES.includes('Protests'));
    });
  });

  describe('briefing()', () => {
    it('returns no_credentials status when env vars are missing', async () => {
      const mod = await import('../apis/sources/acled.mjs');
      const result = await withEnv({ ACLED_EMAIL: null, ACLED_PASSWORD: null }, async () => {
        return mod.briefing();
      });
      assert.equal(result.source, 'ACLED');
      assert.equal(result.status, 'no_credentials');
      assert.ok(result.message.includes('ACLED_EMAIL'));
    });

    it('returns error when OAuth and cookie login both fail', async () => {
      // Mock fetch to fail auth
      mockFetchStatus(401, JSON.stringify({ error: 'Unauthorized' }));

      const mod = await import('../apis/sources/acled.mjs');
      const result = await withEnv(
        { ACLED_EMAIL: 'test@test.com', ACLED_PASSWORD: 'pass123' },
        async () => mod.briefing()
      );
      assert.equal(result.source, 'ACLED');
      assert.ok(result.error, 'Should have an error field');
    });

    it('returns structured briefing data on successful auth and data fetch', async () => {
      // We need multiple fetch calls: OAuth token, then data fetch
      let callCount = 0;
      globalThis.fetch = async (url, opts) => {
        callCount++;
        // First call: OAuth token request
        if (url.includes('/oauth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'test-token-123' }),
            text: async () => JSON.stringify({ access_token: 'test-token-123' }),
            headers: new Headers({ 'content-type': 'application/json' }),
          };
        }
        // Second call: data fetch
        if (url.includes('/api/acled/read')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 200,
              data: [
                {
                  event_date: '2026-04-05',
                  event_type: 'Battles',
                  sub_event_type: 'Armed clash',
                  country: 'Ukraine',
                  region: 'Europe',
                  location: 'Bakhmut',
                  fatalities: '5',
                  latitude: '48.5956',
                  longitude: '38.0003',
                  notes: 'Armed clash between forces near Bakhmut.',
                },
                {
                  event_date: '2026-04-04',
                  event_type: 'Protests',
                  sub_event_type: 'Peaceful protest',
                  country: 'Iran',
                  region: 'Middle East',
                  location: 'Tehran',
                  fatalities: '0',
                  latitude: '35.6892',
                  longitude: '51.3890',
                  notes: 'Large-scale anti-government protest in Tehran.',
                },
                {
                  event_date: '2026-04-03',
                  event_type: 'Violence against civilians',
                  sub_event_type: 'Attack',
                  country: 'Syria',
                  region: 'Middle East',
                  location: 'Aleppo',
                  fatalities: '12',
                  latitude: '36.2021',
                  longitude: '37.1343',
                  notes: 'Civilian attack in Aleppo.',
                },
              ],
            }),
            text: async () => JSON.stringify({ status: 200, data: [] }),
            headers: new Headers({ 'content-type': 'application/json' }),
          };
        }
        // Fallback
        return { ok: false, status: 404, text: async () => '', headers: new Headers() };
      };

      const mod = await import('../apis/sources/acled.mjs');
      const result = await withEnv(
        { ACLED_EMAIL: 'test@test.com', ACLED_PASSWORD: 'pass123' },
        async () => mod.briefing()
      );

      assert.equal(result.source, 'ACLED');
      assert.ok(result.timestamp);
      assert.equal(result.totalEvents, 3);
      assert.equal(result.totalFatalities, 17);
      assert.ok(result.byRegion);
      assert.ok(result.byType);
      assert.ok(result.topCountries);
      assert.ok(Array.isArray(result.deadliestEvents));
      assert.ok(result.period);
      assert.ok(result.period.start);
      assert.ok(result.period.end);
    });

    it('handles empty data array gracefully', async () => {
      let callCount = 0;
      globalThis.fetch = async (url) => {
        if (url.includes('/oauth/token')) {
          return {
            ok: true, status: 200,
            json: async () => ({ access_token: 'test-token-abc' }),
            text: async () => JSON.stringify({ access_token: 'test-token-abc' }),
            headers: new Headers({ 'content-type': 'application/json' }),
          };
        }
        if (url.includes('/api/acled/read')) {
          return {
            ok: true, status: 200,
            json: async () => ({ status: 200, data: [] }),
            text: async () => JSON.stringify({ status: 200, data: [] }),
            headers: new Headers({ 'content-type': 'application/json' }),
          };
        }
        return { ok: false, status: 404, text: async () => '', headers: new Headers() };
      };

      const mod = await import('../apis/sources/acled.mjs');
      const result = await withEnv(
        { ACLED_EMAIL: 'test@test.com', ACLED_PASSWORD: 'pass123' },
        async () => mod.briefing()
      );

      assert.equal(result.source, 'ACLED');
      assert.equal(result.totalEvents, 0);
      assert.equal(result.totalFatalities, 0);
      assert.deepEqual(result.deadliestEvents, []);
    });

    it('handles ACLED API error status in response body', async () => {
      globalThis.fetch = async (url) => {
        if (url.includes('/oauth/token')) {
          return {
            ok: true, status: 200,
            json: async () => ({ access_token: 'test-token-xyz' }),
            text: async () => JSON.stringify({ access_token: 'test-token-xyz' }),
            headers: new Headers({ 'content-type': 'application/json' }),
          };
        }
        if (url.includes('/api/acled/read')) {
          return {
            ok: true, status: 200,
            json: async () => ({ status: 403, message: 'Access denied' }),
            text: async () => JSON.stringify({ status: 403, message: 'Access denied' }),
            headers: new Headers({ 'content-type': 'application/json' }),
          };
        }
        return { ok: false, status: 404, text: async () => '', headers: new Headers() };
      };

      const mod = await import('../apis/sources/acled.mjs');
      const result = await withEnv(
        { ACLED_EMAIL: 'test@test.com', ACLED_PASSWORD: 'pass123' },
        async () => mod.briefing()
      );

      assert.equal(result.source, 'ACLED');
      assert.ok(result.error);
      assert.ok(result.error.includes('Access denied'));
    });
  });

  describe('getEvents()', () => {
    it('returns error when no credentials are set', async () => {
      const mod = await import('../apis/sources/acled.mjs');
      const result = await withEnv(
        { ACLED_EMAIL: null, ACLED_PASSWORD: null },
        async () => mod.getEvents()
      );
      assert.ok(result.error);
      assert.ok(result.error.includes('ACLED'));
    });

    it('handles network errors gracefully', async () => {
      mockFetchError('Connection refused');

      const mod = await import('../apis/sources/acled.mjs');
      const result = await withEnv(
        { ACLED_EMAIL: 'test@test.com', ACLED_PASSWORD: 'pass123' },
        async () => mod.getEvents()
      );
      // Should get an error from failed auth (both methods)
      assert.ok(result.error);
    });
  });
});
