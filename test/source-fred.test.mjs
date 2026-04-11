// FRED source — unit tests

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

describe('FRED source', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('briefing', () => {
    it('should return error when no API key provided', async () => {
      const { briefing } = await import('../apis/sources/fred.mjs');
      const result = await briefing(null);

      assert.equal(result.source, 'FRED');
      assert.ok(result.error);
      assert.ok(result.error.includes('API key'));
      assert.ok(result.hint);
    });

    it('should return error when undefined API key', async () => {
      const { briefing } = await import('../apis/sources/fred.mjs');
      const result = await briefing(undefined);

      assert.equal(result.source, 'FRED');
      assert.ok(result.error);
    });

    it('should return structured briefing with indicators', async () => {
      const apiResponse = {
        observations: [
          { date: '2026-04-09', value: '4.25' },
          { date: '2026-04-08', value: '4.20' },
        ],
      };
      mockFetch(apiResponse);

      const { briefing } = await import('../apis/sources/fred.mjs');
      const result = await briefing('test-api-key');

      assert.equal(result.source, 'FRED');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.indicators));
      assert.ok(Array.isArray(result.signals));
    });

    it('should parse observation values as numbers', async () => {
      const apiResponse = {
        observations: [
          { date: '2026-04-09', value: '5.25' },
          { date: '2026-04-08', value: '5.20' },
        ],
      };
      mockFetch(apiResponse);

      const { briefing } = await import('../apis/sources/fred.mjs');
      const result = await briefing('test-key');

      const indicator = result.indicators[0];
      assert.equal(typeof indicator.value, 'number');
      assert.equal(indicator.value, 5.25);
      assert.equal(indicator.date, '2026-04-09');
      assert.ok(Array.isArray(indicator.recent));
    });

    it('should skip observations with value "."', async () => {
      const apiResponse = {
        observations: [
          { date: '2026-04-09', value: '.' },
          { date: '2026-04-08', value: '4.50' },
          { date: '2026-04-07', value: '4.45' },
        ],
      };
      mockFetch(apiResponse);

      const { briefing } = await import('../apis/sources/fred.mjs');
      const result = await briefing('test-key');

      const indicator = result.indicators[0];
      // Should pick first non-"." value
      assert.equal(indicator.value, 4.50);
      assert.equal(indicator.date, '2026-04-08');
    });

    it('should generate yield curve inversion signal', async () => {
      // Need to return specific data for T10Y2Y series
      let callCount = 0;
      const origFetch = globalThis.fetch;

      // The briefing fetches all KEY_SERIES in parallel via Promise.all
      globalThis.fetch = (url, opts) => {
        callCount++;
        let value = '3.50'; // default

        if (url.includes('series_id=T10Y2Y')) {
          value = '-0.50'; // inverted
        } else if (url.includes('series_id=T10Y3M')) {
          value = '-0.25'; // inverted
        } else if (url.includes('series_id=VIXCLS')) {
          value = '22.00'; // normal
        } else if (url.includes('series_id=BAMLH0A0HYM2')) {
          value = '3.50'; // normal
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            observations: [{ date: '2026-04-09', value }],
          })),
          json: () => Promise.resolve({
            observations: [{ date: '2026-04-09', value }],
          }),
        });
      };

      const { briefing } = await import('../apis/sources/fred.mjs');
      const result = await briefing('test-key');

      assert.ok(result.signals.some(s => s.includes('YIELD CURVE INVERTED (10Y-2Y)')));
      assert.ok(result.signals.some(s => s.includes('YIELD CURVE INVERTED (10Y-3M)')));
    });

    it('should generate VIX elevated signal when above 30', async () => {
      globalThis.fetch = (url, opts) => {
        let value = '3.50';
        if (url.includes('series_id=VIXCLS')) {
          value = '35.00';
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            observations: [{ date: '2026-04-09', value }],
          })),
        });
      };

      const { briefing } = await import('../apis/sources/fred.mjs');
      const result = await briefing('test-key');

      assert.ok(result.signals.some(s => s.includes('VIX ELEVATED')));
    });

    it('should generate VIX extreme signal when above 40', async () => {
      globalThis.fetch = (url, opts) => {
        let value = '3.50';
        if (url.includes('series_id=VIXCLS')) {
          value = '45.00';
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            observations: [{ date: '2026-04-09', value }],
          })),
        });
      };

      const { briefing } = await import('../apis/sources/fred.mjs');
      const result = await briefing('test-key');

      assert.ok(result.signals.some(s => s.includes('VIX EXTREME')));
    });

    it('should generate high yield spread signal when above 5', async () => {
      globalThis.fetch = (url, opts) => {
        let value = '3.50';
        if (url.includes('series_id=BAMLH0A0HYM2')) {
          value = '6.50';
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            observations: [{ date: '2026-04-09', value }],
          })),
        });
      };

      const { briefing } = await import('../apis/sources/fred.mjs');
      const result = await briefing('test-key');

      assert.ok(result.signals.some(s => s.includes('HIGH YIELD SPREAD WIDE')));
    });

    it('should handle no signals when all normal', async () => {
      const apiResponse = {
        observations: [
          { date: '2026-04-09', value: '3.50' },
        ],
      };
      mockFetch(apiResponse);

      const { briefing } = await import('../apis/sources/fred.mjs');
      const result = await briefing('test-key');

      // T10Y2Y=3.50 (positive), VIX=3.50 (low), HY spread=3.50 (low) - no signals
      assert.deepEqual(result.signals, []);
    });

    it('should handle empty observations', async () => {
      mockFetch({ observations: [] });

      const { briefing } = await import('../apis/sources/fred.mjs');
      const result = await briefing('test-key');

      assert.equal(result.source, 'FRED');
      // Indicators with null values are filtered out
      assert.deepEqual(result.indicators, []);
      assert.deepEqual(result.signals, []);
    });

    it('should handle API error gracefully', async () => {
      mockFetchError('Service unavailable');

      const { briefing } = await import('../apis/sources/fred.mjs');
      const result = await briefing('test-key');

      // safeFetch returns { error, source } on failure; briefing uses ?.observations
      assert.equal(result.source, 'FRED');
      assert.deepEqual(result.indicators, []);
    });

    it('should call correct FRED API URL', async () => {
      let capturedUrls = [];
      globalThis.fetch = (url, opts) => {
        capturedUrls.push(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ observations: [{ date: '2026-04-09', value: '3.50' }] })),
        });
      };

      const { briefing } = await import('../apis/sources/fred.mjs');
      await briefing('my-fred-key');

      assert.ok(capturedUrls.length > 0);
      assert.ok(capturedUrls[0].includes('api.stlouisfed.org/fred'));
      assert.ok(capturedUrls[0].includes('api_key=my-fred-key'));
    });
  });
});
