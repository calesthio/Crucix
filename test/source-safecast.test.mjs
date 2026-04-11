// Safecast source — unit tests

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

describe('Safecast source', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('getMeasurements', () => {
    it('should call the measurements API with default params', async () => {
      let capturedUrl;
      mockFetch([]);
      const origFetch = globalThis.fetch;
      globalThis.fetch = (url, opts) => { capturedUrl = url; return origFetch(url, opts); };

      const { getMeasurements } = await import('../apis/sources/safecast.mjs');
      await getMeasurements();

      assert.ok(capturedUrl.includes('measurements.json'));
      assert.ok(capturedUrl.includes('limit=50'));
    });

    it('should include lat/lon/distance when provided', async () => {
      let capturedUrl;
      mockFetch([]);
      const origFetch = globalThis.fetch;
      globalThis.fetch = (url, opts) => { capturedUrl = url; return origFetch(url, opts); };

      const { getMeasurements } = await import('../apis/sources/safecast.mjs');
      await getMeasurements({ latitude: 47.51, longitude: 34.58, distance: 100 });

      assert.ok(capturedUrl.includes('latitude=47.51'));
      assert.ok(capturedUrl.includes('longitude=34.58'));
      assert.ok(capturedUrl.includes('distance=100000')); // km * 1000
    });
  });

  describe('briefing', () => {
    it('should return structured briefing with site readings', async () => {
      const measurements = [
        { value: 35, captured_at: '2026-04-10T10:00:00Z' },
        { value: 42, captured_at: '2026-04-10T09:00:00Z' },
        { value: 28, captured_at: '2026-04-10T08:00:00Z' },
      ];
      mockFetch(measurements);

      const { briefing } = await import('../apis/sources/safecast.mjs');
      const result = await briefing();

      assert.equal(result.source, 'Safecast');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.sites));
      assert.ok(result.sites.length > 0);
      assert.ok(Array.isArray(result.signals));
    });

    it('should compute avgCPM and maxCPM for normal readings', async () => {
      const measurements = [
        { value: 30, captured_at: '2026-04-10T10:00:00Z' },
        { value: 50, captured_at: '2026-04-10T09:00:00Z' },
        { value: 40, captured_at: '2026-04-10T08:00:00Z' },
      ];
      mockFetch(measurements);

      const { briefing } = await import('../apis/sources/safecast.mjs');
      const result = await briefing();

      const site = result.sites[0];
      assert.equal(site.recentReadings, 3);
      assert.equal(site.avgCPM, 40);
      assert.equal(site.maxCPM, 50);
      assert.equal(site.anomaly, false);
    });

    it('should flag anomaly when avgCPM exceeds 100', async () => {
      const measurements = [
        { value: 150, captured_at: '2026-04-10T10:00:00Z' },
        { value: 200, captured_at: '2026-04-10T09:00:00Z' },
      ];
      mockFetch(measurements);

      const { briefing } = await import('../apis/sources/safecast.mjs');
      const result = await briefing();

      const site = result.sites[0];
      assert.equal(site.anomaly, true);
      assert.ok(result.signals.some(s => s.includes('ELEVATED RADIATION')));
    });

    it('should report normal levels when all readings are low', async () => {
      const measurements = [
        { value: 25, captured_at: '2026-04-10T10:00:00Z' },
        { value: 30, captured_at: '2026-04-10T09:00:00Z' },
      ];
      mockFetch(measurements);

      const { briefing } = await import('../apis/sources/safecast.mjs');
      const result = await briefing();

      assert.ok(result.signals.some(s => s.includes('normal radiation levels')));
    });

    it('should handle empty measurement arrays', async () => {
      mockFetch([]);

      const { briefing } = await import('../apis/sources/safecast.mjs');
      const result = await briefing();

      const site = result.sites[0];
      assert.equal(site.recentReadings, 0);
      assert.equal(site.avgCPM, null);
      assert.equal(site.maxCPM, null);
      assert.equal(site.anomaly, false);
    });

    it('should handle non-array API response', async () => {
      mockFetch({ error: 'server error', source: 'https://api.safecast.org' });

      const { briefing } = await import('../apis/sources/safecast.mjs');
      const result = await briefing();

      // Non-array data should be treated as empty
      const site = result.sites[0];
      assert.equal(site.recentReadings, 0);
      assert.equal(site.avgCPM, null);
    });

    it('should handle API error gracefully', async () => {
      mockFetchError('Connection refused');

      const { briefing } = await import('../apis/sources/safecast.mjs');
      const result = await briefing();

      assert.equal(result.source, 'Safecast');
      assert.ok(result.sites.every(s => s.recentReadings === 0));
    });

    it('should monitor key nuclear sites', async () => {
      mockFetch([]);

      const { briefing } = await import('../apis/sources/safecast.mjs');
      const result = await briefing();

      const keys = result.sites.map(s => s.key);
      assert.ok(keys.includes('zaporizhzhia'));
      assert.ok(keys.includes('fukushima'));
      assert.ok(keys.includes('chernobyl'));
    });
  });
});
