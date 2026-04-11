import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

import { getTradeData, getBilateralTrade, briefing } from '../apis/sources/comtrade.mjs';

function makeComtradeResponse(records) {
  return { data: records };
}

function makeTradeRecord(overrides = {}) {
  return {
    reporterDesc: 'United States',
    reporterCode: 842,
    partnerDesc: 'Canada',
    partnerCode: 124,
    cmdDesc: 'Crude Petroleum',
    cmdCode: '2709',
    flowDesc: 'Imports',
    flowCode: 'M',
    primaryValue: 5000000000,
    qty: 100000,
    qtyUnitAbbr: 'kg',
    period: 2026,
    ...overrides,
  };
}

describe('comtrade', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('getTradeData', () => {
    it('fetches trade data via safeFetch', async () => {
      const body = makeComtradeResponse([makeTradeRecord()]);
      mockFetch(body);

      const result = await getTradeData({ reporterCode: 842, cmdCode: '2709' });
      assert.ok(result.data);
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].reporterDesc, 'United States');
    });

    it('returns error on failure', async () => {
      mockFetchError('timeout');
      // safeFetch retries once, so this will eventually return error object
      const result = await getTradeData();
      assert.ok(result.error);
    });
  });

  describe('getBilateralTrade', () => {
    it('calls getTradeData with reporter and partner', async () => {
      let capturedUrl;
      globalThis.fetch = async (url) => {
        capturedUrl = url;
        const body = makeComtradeResponse([makeTradeRecord()]);
        const text = JSON.stringify(body);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(text),
        };
      };

      await getBilateralTrade(842, 156, '8542');
      assert.ok(capturedUrl.includes('reporterCode=842'));
      assert.ok(capturedUrl.includes('partnerCode=156'));
      assert.ok(capturedUrl.includes('cmdCode=8542'));
    });
  });

  describe('briefing', () => {
    it('returns trade flows and signals', async () => {
      const body = makeComtradeResponse([
        makeTradeRecord(),
        makeTradeRecord({ partnerDesc: 'Saudi Arabia', primaryValue: 8000000000 }),
        makeTradeRecord({ partnerDesc: 'Mexico', primaryValue: 3000000000 }),
      ]);
      mockFetch(body);

      const result = await briefing();
      assert.equal(result.source, 'UN Comtrade');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.tradeFlows));
      assert.ok(Array.isArray(result.signals));
      assert.ok(result.coveredCommodities);
      assert.ok(result.coveredCountries);
    });

    it('returns no_data status when API returns empty', async () => {
      mockFetch({ data: [] });
      const result = await briefing();
      assert.equal(result.status, 'no_data');
      assert.deepStrictEqual(result.signals, ['No significant trade anomalies detected in sampled commodities']);
    });

    it('detects outlier trade values', async () => {
      // Create records with one extreme outlier; need enough tight-clustered values
      // so stddev stays small relative to the outlier
      const records = [
        makeTradeRecord({ partnerDesc: 'Canada', primaryValue: 1000000000 }),
        makeTradeRecord({ partnerDesc: 'Mexico', primaryValue: 1050000000 }),
        makeTradeRecord({ partnerDesc: 'UK', primaryValue: 980000000 }),
        makeTradeRecord({ partnerDesc: 'Japan', primaryValue: 1020000000 }),
        makeTradeRecord({ partnerDesc: 'Germany', primaryValue: 1010000000 }),
        makeTradeRecord({ partnerDesc: 'Outlier Country', primaryValue: 100000000000 }), // 100x outlier
      ];
      mockFetch(makeComtradeResponse(records));

      const result = await briefing();
      assert.ok(result.signals.some(s => s.includes('OUTLIER')));
    });

    it('handles API error gracefully', async () => {
      mockFetchError('Service unavailable');
      const result = await briefing();
      assert.equal(result.source, 'UN Comtrade');
      // Should still return structure with no data
      assert.equal(result.status, 'no_data');
    });
  });
});
