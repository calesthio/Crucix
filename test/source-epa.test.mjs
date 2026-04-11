import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

import { getAnalyticalResults, getResultsByState, getResultsByAnalyte, briefing } from '../apis/sources/epa.mjs';

function makeReading(overrides = {}) {
  return {
    ANA_CITY: 'Washington',
    ANA_STATE: 'DC',
    ANA_TYPE: 'GROSS BETA',
    ANA_RESULT: '0.5',
    RESULT_UNIT: 'pCi/m3',
    COLLECT_DATE: '2026-03-15',
    SAMPLE_TYPE: 'AIR',
    ...overrides,
  };
}

describe('epa', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('getAnalyticalResults', () => {
    it('fetches and returns readings', async () => {
      const body = [makeReading(), makeReading({ ANA_CITY: 'New York', ANA_STATE: 'NY' })];
      mockFetch(body);

      const result = await getAnalyticalResults({ rows: 10 });
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 2);
    });

    it('returns error object on failure', async () => {
      mockFetchError('timeout');
      const result = await getAnalyticalResults();
      assert.ok(result.error);
    });
  });

  describe('getResultsByState', () => {
    it('fetches state-filtered results', async () => {
      let capturedUrl;
      globalThis.fetch = async (url) => {
        capturedUrl = url;
        const body = [makeReading()];
        const text = JSON.stringify(body);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(text),
        };
      };

      await getResultsByState('DC');
      assert.ok(capturedUrl.includes('ANA_STATE/DC'));
    });
  });

  describe('getResultsByAnalyte', () => {
    it('fetches analyte-filtered results', async () => {
      let capturedUrl;
      globalThis.fetch = async (url) => {
        capturedUrl = url;
        const body = [makeReading({ ANA_TYPE: 'IODINE-131' })];
        const text = JSON.stringify(body);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(text),
        };
      };

      await getResultsByAnalyte('IODINE-131');
      assert.ok(capturedUrl.includes('ANA_TYPE'));
      assert.ok(capturedUrl.includes('IODINE-131'));
    });
  });

  describe('briefing', () => {
    it('returns readings, state summary, and signals', async () => {
      const readings = [
        makeReading(),
        makeReading({ ANA_CITY: 'New York', ANA_STATE: 'NY', ANA_TYPE: 'GROSS ALPHA', ANA_RESULT: '0.02' }),
      ];
      // briefing calls getAnalyticalResults once, then getResultsByAnalyte 3 times
      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        const body = callCount === 1 ? readings : [makeReading({ ANA_TYPE: 'GROSS BETA' })];
        const text = JSON.stringify(body);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(text),
        };
      };

      const result = await briefing();
      assert.equal(result.source, 'EPA RadNet');
      assert.ok(result.timestamp);
      assert.ok(typeof result.totalReadings === 'number');
      assert.ok(result.totalReadings > 0);
      assert.ok(Array.isArray(result.readings));
      assert.ok(result.stateSummary);
      assert.ok(Array.isArray(result.signals));
      assert.ok(result.monitoredAnalytes);
      assert.ok(result.thresholds);
    });

    it('flags elevated readings', async () => {
      const readings = [
        makeReading({ ANA_TYPE: 'GROSS BETA', ANA_RESULT: '10.0' }), // way above elevated threshold of 5.0
      ];
      globalThis.fetch = async () => {
        const text = JSON.stringify(readings);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(text),
        };
      };

      const result = await briefing();
      assert.ok(result.signals.some(s => s.includes('ELEVATED')));
    });

    it('reports all normal when readings are within thresholds', async () => {
      const readings = [
        makeReading({ ANA_TYPE: 'GROSS BETA', ANA_RESULT: '0.3' }), // below normal threshold of 1.0
      ];
      globalThis.fetch = async () => {
        const text = JSON.stringify(readings);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(text),
        };
      };

      const result = await briefing();
      assert.ok(result.signals.some(s => s.includes('normal background levels')));
    });

    it('handles empty data gracefully', async () => {
      mockFetch([]);
      const result = await briefing();
      assert.equal(result.totalReadings, 0);
      assert.ok(result.signals.some(s => s.includes('normal background levels')));
    });

    it('handles API error gracefully', async () => {
      mockFetchError('ECONNREFUSED');
      const result = await briefing();
      // safeFetch returns { error } which is not an array, so recentRecords = []
      assert.equal(result.source, 'EPA RadNet');
      assert.equal(result.totalReadings, 0);
    });

    it('deduplicates readings from analyte queries', async () => {
      // Same reading returned by both the main query and the analyte query
      const reading = makeReading({ ANA_CITY: 'Denver', ANA_STATE: 'CO', ANA_TYPE: 'GROSS BETA', COLLECT_DATE: '2026-03-10' });
      globalThis.fetch = async () => {
        const text = JSON.stringify([reading]);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(text),
        };
      };

      const result = await briefing();
      // Should not have duplicates of the Denver reading
      const denverReadings = result.readings.filter(r => r.location === 'Denver' && r.analyte === 'GROSS BETA' && r.collectDate === '2026-03-10');
      assert.equal(denverReadings.length, 1);
    });
  });
});
