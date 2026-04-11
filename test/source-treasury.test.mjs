// Treasury source — unit tests

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

describe('Treasury source', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('getDebtToThePenny', () => {
    it('should call the correct fiscal data endpoint', async () => {
      let capturedUrl;
      mockFetch({ data: [] });
      const origFetch = globalThis.fetch;
      globalThis.fetch = (url, opts) => { capturedUrl = url; return origFetch(url, opts); };

      const { getDebtToThePenny } = await import('../apis/sources/treasury.mjs');
      await getDebtToThePenny();

      assert.ok(capturedUrl.includes('fiscal_service'));
      assert.ok(capturedUrl.includes('debt_to_penny'));
      assert.ok(capturedUrl.includes('tot_pub_debt_out_amt'));
    });
  });

  describe('getAvgInterestRates', () => {
    it('should call the interest rates endpoint', async () => {
      let capturedUrl;
      mockFetch({ data: [] });
      const origFetch = globalThis.fetch;
      globalThis.fetch = (url, opts) => { capturedUrl = url; return origFetch(url, opts); };

      const { getAvgInterestRates } = await import('../apis/sources/treasury.mjs');
      await getAvgInterestRates();

      assert.ok(capturedUrl.includes('avg_interest_rates'));
    });
  });

  describe('briefing', () => {
    it('should return structured briefing with debt and interest rate data', async () => {
      const payload = {
        data: [
          {
            record_date: '2026-04-09',
            tot_pub_debt_out_amt: '36500000000000.00',
            debt_held_public_amt: '28500000000000.00',
            intragov_hold_amt: '8000000000000.00',
          },
          {
            record_date: '2026-04-08',
            tot_pub_debt_out_amt: '36480000000000.00',
            debt_held_public_amt: '28480000000000.00',
            intragov_hold_amt: '8000000000000.00',
          },
        ],
      };
      mockFetch(payload);

      const { briefing } = await import('../apis/sources/treasury.mjs');
      const result = await briefing();

      assert.equal(result.source, 'US Treasury');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.debt));
      assert.ok(Array.isArray(result.interestRates));
      assert.ok(Array.isArray(result.signals));
    });

    it('should map debt data to correct structure', async () => {
      const payload = {
        data: [
          {
            record_date: '2026-04-09',
            tot_pub_debt_out_amt: '36500000000000.00',
            debt_held_public_amt: '28500000000000.00',
            intragov_hold_amt: '8000000000000.00',
          },
        ],
      };
      mockFetch(payload);

      const { briefing } = await import('../apis/sources/treasury.mjs');
      const result = await briefing();

      assert.ok(result.debt.length > 0);
      const d = result.debt[0];
      assert.equal(d.date, '2026-04-09');
      assert.equal(d.totalDebt, '36500000000000.00');
      assert.equal(d.publicDebt, '28500000000000.00');
      assert.equal(d.intragovDebt, '8000000000000.00');
    });

    it('should generate signal when debt exceeds 36T', async () => {
      const payload = {
        data: [
          {
            record_date: '2026-04-09',
            tot_pub_debt_out_amt: '37000000000000.00',
            debt_held_public_amt: '29000000000000.00',
            intragov_hold_amt: '8000000000000.00',
          },
        ],
      };
      mockFetch(payload);

      const { briefing } = await import('../apis/sources/treasury.mjs');
      const result = await briefing();

      assert.ok(result.signals.length > 0);
      assert.ok(result.signals[0].includes('$37.00T'));
    });

    it('should not generate signal when debt is below 36T', async () => {
      const payload = {
        data: [
          {
            record_date: '2026-04-09',
            tot_pub_debt_out_amt: '35000000000000.00',
            debt_held_public_amt: '27000000000000.00',
            intragov_hold_amt: '8000000000000.00',
          },
        ],
      };
      mockFetch(payload);

      const { briefing } = await import('../apis/sources/treasury.mjs');
      const result = await briefing();

      assert.deepEqual(result.signals, []);
    });

    it('should handle empty API response', async () => {
      mockFetch({ data: [] });

      const { briefing } = await import('../apis/sources/treasury.mjs');
      const result = await briefing();

      assert.equal(result.source, 'US Treasury');
      assert.deepEqual(result.debt, []);
      assert.deepEqual(result.signals, []);
    });

    it('should handle API error gracefully', async () => {
      mockFetchError('timeout');

      const { briefing } = await import('../apis/sources/treasury.mjs');
      const result = await briefing();

      // safeFetch returns { error, source } on failure; briefing uses ?.data || []
      assert.equal(result.source, 'US Treasury');
      assert.deepEqual(result.debt, []);
    });
  });
});
