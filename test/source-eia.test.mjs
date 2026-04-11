import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

import { fetchSeries, briefing } from '../apis/sources/eia.mjs';

function makeEiaResponse(value, period = '2026-03-15', unit = 'Dollars per Barrel') {
  return {
    response: {
      data: [
        { value: String(value), period, 'unit-name': unit },
        { value: String(value - 2), period: '2026-03-14', 'unit-name': unit },
        { value: String(value - 1), period: '2026-03-13', 'unit-name': unit },
        { value: String(value + 1), period: '2026-03-12', 'unit-name': unit },
        { value: String(value - 3), period: '2026-03-11', 'unit-name': unit },
      ],
    },
  };
}

describe('eia', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('briefing', () => {
    it('returns error when no API key provided', async () => {
      const result = await briefing(undefined);
      assert.equal(result.source, 'EIA');
      assert.ok(result.error);
      assert.ok(result.hint);
    });

    it('returns oil prices, gas, and inventories on success', async () => {
      // briefing makes 4 parallel safeFetch calls
      let callCount = 0;
      globalThis.fetch = async (url) => {
        callCount++;
        let body;
        if (url.includes('petroleum/pri/spt') && url.includes('RWTC')) {
          body = makeEiaResponse(72.50);
        } else if (url.includes('petroleum/pri/spt') && url.includes('RBRTE')) {
          body = makeEiaResponse(76.30);
        } else if (url.includes('natural-gas')) {
          body = makeEiaResponse(3.45, '2026-03-15', '$/MMBtu');
        } else {
          body = makeEiaResponse(440000, '2026-03-14', 'Thousand Barrels');
        }
        const text = JSON.stringify(body);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(text),
          json: () => Promise.resolve(body),
        };
      };

      const result = await briefing('test-key');
      assert.equal(result.source, 'EIA');
      assert.ok(result.timestamp);
      assert.ok(result.oilPrices);
      assert.ok(result.oilPrices.wti);
      assert.equal(result.oilPrices.wti.value, 72.50);
      assert.ok(result.oilPrices.brent);
      assert.equal(result.oilPrices.brent.value, 76.30);
      assert.ok(typeof result.oilPrices.spread === 'number');
      assert.ok(result.gasPrice);
      assert.ok(result.inventories.crudeStocks);
      assert.ok(Array.isArray(result.signals));
    });

    it('generates signal when WTI above $100', async () => {
      globalThis.fetch = async () => {
        const body = makeEiaResponse(105);
        const text = JSON.stringify(body);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(text),
          json: () => Promise.resolve(body),
        };
      };

      const result = await briefing('test-key');
      assert.ok(result.signals.some(s => s.includes('WTI') && s.includes('above $100')));
    });

    it('handles API error gracefully', async () => {
      // safeFetch returns { error, source } on failure
      globalThis.fetch = async () => {
        throw new Error('Service unavailable');
      };

      const result = await briefing('test-key');
      // When all fetches fail, extractLatest returns null, so we get null prices
      assert.equal(result.source, 'EIA');
      assert.equal(result.oilPrices.wti, null);
      assert.equal(result.oilPrices.brent, null);
    });

    it('handles empty response data', async () => {
      globalThis.fetch = async () => {
        const body = { response: { data: [] } };
        const text = JSON.stringify(body);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(text),
          json: () => Promise.resolve(body),
        };
      };

      const result = await briefing('test-key');
      assert.equal(result.oilPrices.wti, null);
      assert.equal(result.oilPrices.brent, null);
      assert.equal(result.gasPrice, null);
    });
  });
});
