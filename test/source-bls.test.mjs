import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

import { getSeriesV1, getSeries, briefing } from '../apis/sources/bls.mjs';

function makeBlsResponse(seriesData) {
  return {
    status: 'REQUEST_SUCCEEDED',
    Results: {
      series: seriesData,
    },
  };
}

function makeSeriesEntry(seriesID, dataPoints) {
  return {
    seriesID,
    data: dataPoints,
  };
}

describe('bls', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('getSeries', () => {
    it('posts to BLS API and returns response', async () => {
      const body = makeBlsResponse([
        makeSeriesEntry('CUUR0000SA0', [
          { year: '2026', period: 'M03', value: '315.2' },
        ]),
      ]);
      globalThis.fetch = async (url, opts) => {
        assert.ok(opts.method === 'POST');
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
        };
      };

      const result = await getSeries(['CUUR0000SA0']);
      assert.equal(result.status, 'REQUEST_SUCCEEDED');
      assert.ok(result.Results.series.length === 1);
    });

    it('uses v2 base when apiKey provided', async () => {
      let capturedUrl;
      globalThis.fetch = async (url, opts) => {
        capturedUrl = url;
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve(makeBlsResponse([])),
        };
      };

      await getSeries(['LNS14000000'], { apiKey: 'test-key' });
      assert.ok(capturedUrl.includes('v2'));
    });

    it('returns error on network failure', async () => {
      mockFetchError('Network error');
      const result = await getSeries(['LNS14000000']);
      assert.ok(result.error);
    });
  });

  describe('briefing', () => {
    it('returns indicators and signals on success', async () => {
      const body = makeBlsResponse([
        makeSeriesEntry('CUUR0000SA0', [
          { year: '2026', period: 'M03', value: '318.5' },
          { year: '2026', period: 'M02', value: '316.0' },
        ]),
        makeSeriesEntry('CUUR0000SA0L1E', [
          { year: '2026', period: 'M03', value: '310.1' },
          { year: '2026', period: 'M02', value: '309.0' },
        ]),
        makeSeriesEntry('LNS14000000', [
          { year: '2026', period: 'M03', value: '3.8' },
          { year: '2026', period: 'M02', value: '3.9' },
        ]),
        makeSeriesEntry('CES0000000001', [
          { year: '2026', period: 'M03', value: '157200' },
          { year: '2026', period: 'M02', value: '157050' },
        ]),
        makeSeriesEntry('WPUFD49104', [
          { year: '2026', period: 'M03', value: '142.3' },
          { year: '2026', period: 'M02', value: '141.8' },
        ]),
      ]);

      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
      });

      const result = await briefing();
      assert.equal(result.source, 'BLS');
      assert.ok(Array.isArray(result.indicators));
      assert.equal(result.indicators.length, 5);
      assert.ok(Array.isArray(result.signals));
    });

    it('flags elevated unemployment', async () => {
      const body = makeBlsResponse([
        makeSeriesEntry('CUUR0000SA0', [
          { year: '2026', period: 'M03', value: '315.2' },
          { year: '2026', period: 'M02', value: '314.8' },
        ]),
        makeSeriesEntry('CUUR0000SA0L1E', [
          { year: '2026', period: 'M03', value: '310.0' },
          { year: '2026', period: 'M02', value: '309.5' },
        ]),
        makeSeriesEntry('LNS14000000', [
          { year: '2026', period: 'M03', value: '5.5' },
          { year: '2026', period: 'M02', value: '5.3' },
        ]),
        makeSeriesEntry('CES0000000001', [
          { year: '2026', period: 'M03', value: '157000' },
          { year: '2026', period: 'M02', value: '157050' },
        ]),
        makeSeriesEntry('WPUFD49104', [
          { year: '2026', period: 'M03', value: '142.0' },
          { year: '2026', period: 'M02', value: '141.5' },
        ]),
      ]);

      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
      });

      const result = await briefing();
      assert.ok(result.signals.some(s => s.includes('Unemployment elevated')));
    });

    it('returns error when API fails', async () => {
      globalThis.fetch = async () => { throw new Error('timeout'); };
      const result = await briefing();
      assert.equal(result.source, 'BLS');
      assert.ok(result.error);
    });

    it('handles REQUEST_NOT_SUCCEEDED status', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          status: 'REQUEST_NOT_SUCCEEDED',
          message: ['Too many requests'],
          Results: {},
        }),
      });

      const result = await briefing();
      assert.equal(result.source, 'BLS');
      assert.ok(result.error);
    });

    it('handles missing/unavailable values', async () => {
      const body = makeBlsResponse([
        makeSeriesEntry('CUUR0000SA0', [
          { year: '2026', period: 'M03', value: '-' },
          { year: '2026', period: 'M02', value: '.' },
        ]),
        makeSeriesEntry('CUUR0000SA0L1E', []),
        makeSeriesEntry('LNS14000000', []),
        makeSeriesEntry('CES0000000001', []),
        makeSeriesEntry('WPUFD49104', []),
      ]);

      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
      });

      const result = await briefing();
      assert.equal(result.source, 'BLS');
      // Should have indicators with null values
      const cpi = result.indicators.find(i => i.id === 'CUUR0000SA0');
      assert.equal(cpi.value, null);
    });
  });
});
