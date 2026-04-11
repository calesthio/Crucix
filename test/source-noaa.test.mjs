// NOAA source — unit tests

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

describe('NOAA source', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('getActiveAlerts', () => {
    it('should call the NWS alerts endpoint', async () => {
      let capturedUrl;
      mockFetch({ features: [] });
      const origFetch = globalThis.fetch;
      globalThis.fetch = (url, opts) => { capturedUrl = url; return origFetch(url, opts); };

      const { getActiveAlerts } = await import('../apis/sources/noaa.mjs');
      await getActiveAlerts();

      assert.ok(capturedUrl.includes('api.weather.gov/alerts/active'));
      assert.ok(capturedUrl.includes('status=actual'));
    });

    it('should pass severity and urgency filters', async () => {
      let capturedUrl;
      mockFetch({ features: [] });
      const origFetch = globalThis.fetch;
      globalThis.fetch = (url, opts) => { capturedUrl = url; return origFetch(url, opts); };

      const { getActiveAlerts } = await import('../apis/sources/noaa.mjs');
      await getActiveAlerts({ severity: 'Extreme', urgency: 'Immediate' });

      assert.ok(capturedUrl.includes('severity=Extreme'));
      assert.ok(capturedUrl.includes('urgency=Immediate'));
    });
  });

  describe('briefing', () => {
    it('should return structured briefing with categorized alerts', async () => {
      const alertData = {
        features: [
          {
            properties: {
              event: 'Hurricane Warning',
              severity: 'Extreme',
              urgency: 'Immediate',
              headline: 'Hurricane Warning for coastal areas',
              areaDesc: 'Gulf Coast',
              onset: '2026-04-10T12:00:00Z',
              expires: '2026-04-11T12:00:00Z',
            },
            geometry: { type: 'Point', coordinates: [-90.0, 30.0] },
          },
          {
            properties: {
              event: 'Tornado Warning',
              severity: 'Extreme',
              urgency: 'Immediate',
              headline: 'Tornado Warning',
              areaDesc: 'Central Oklahoma',
              onset: '2026-04-10T14:00:00Z',
              expires: '2026-04-10T16:00:00Z',
            },
            geometry: null,
          },
          {
            properties: {
              event: 'Flash Flood Warning',
              severity: 'Severe',
              urgency: 'Immediate',
              headline: 'Flash Flood Warning',
              areaDesc: 'Eastern Tennessee',
              onset: '2026-04-10T10:00:00Z',
              expires: '2026-04-10T18:00:00Z',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [[[-84.0, 35.0], [-83.0, 35.0], [-83.0, 36.0], [-84.0, 36.0], [-84.0, 35.0]]],
            },
          },
        ],
      };
      mockFetch(alertData);

      const { briefing } = await import('../apis/sources/noaa.mjs');
      const result = await briefing();

      assert.equal(result.source, 'NOAA/NWS');
      assert.ok(result.timestamp);
      assert.equal(result.totalSevereAlerts, 3);
      assert.equal(result.summary.hurricanes, 1);
      assert.equal(result.summary.tornadoes, 1);
      assert.equal(result.summary.floods, 1);
      assert.equal(result.summary.winterStorms, 0);
      assert.equal(result.summary.wildfires, 0);
      assert.equal(result.summary.other, 0);
    });

    it('should extract Point geometry coordinates', async () => {
      const alertData = {
        features: [
          {
            properties: { event: 'Severe Thunderstorm', severity: 'Severe' },
            geometry: { type: 'Point', coordinates: [-95.5, 32.5] },
          },
        ],
      };
      mockFetch(alertData);

      const { briefing } = await import('../apis/sources/noaa.mjs');
      const result = await briefing();

      const alert = result.topAlerts[0];
      assert.equal(alert.lat, 32.5);
      assert.equal(alert.lon, -95.5);
    });

    it('should compute centroid for Polygon geometry', async () => {
      const alertData = {
        features: [
          {
            properties: { event: 'Flood Warning', severity: 'Severe' },
            geometry: {
              type: 'Polygon',
              coordinates: [[[-84.0, 35.0], [-83.0, 35.0], [-83.0, 36.0], [-84.0, 36.0]]],
            },
          },
        ],
      };
      mockFetch(alertData);

      const { briefing } = await import('../apis/sources/noaa.mjs');
      const result = await briefing();

      const alert = result.topAlerts[0];
      // Centroid of the four corners
      assert.equal(alert.lat, 35.5);
      assert.equal(alert.lon, -83.5);
    });

    it('should compute centroid for MultiPolygon geometry', async () => {
      const alertData = {
        features: [
          {
            properties: { event: 'Winter Storm', severity: 'Severe' },
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [[[-100.0, 40.0], [-99.0, 40.0], [-99.0, 41.0], [-100.0, 41.0]]],
              ],
            },
          },
        ],
      };
      mockFetch(alertData);

      const { briefing } = await import('../apis/sources/noaa.mjs');
      const result = await briefing();

      const alert = result.topAlerts[0];
      assert.equal(alert.lat, 40.5);
      assert.equal(alert.lon, -99.5);
    });

    it('should handle null geometry', async () => {
      const alertData = {
        features: [
          {
            properties: { event: 'Wind Advisory', severity: 'Moderate' },
            geometry: null,
          },
        ],
      };
      mockFetch(alertData);

      const { briefing } = await import('../apis/sources/noaa.mjs');
      const result = await briefing();

      const alert = result.topAlerts[0];
      assert.equal(alert.lat, null);
      assert.equal(alert.lon, null);
    });

    it('should handle empty features array', async () => {
      mockFetch({ features: [] });

      const { briefing } = await import('../apis/sources/noaa.mjs');
      const result = await briefing();

      assert.equal(result.source, 'NOAA/NWS');
      assert.equal(result.totalSevereAlerts, 0);
      assert.deepEqual(result.topAlerts, []);
    });

    it('should handle API error gracefully', async () => {
      mockFetchError('Service unavailable');

      const { briefing } = await import('../apis/sources/noaa.mjs');
      const result = await briefing();

      // safeFetch returns { error, source } on failure; briefing uses ?.features || []
      assert.equal(result.source, 'NOAA/NWS');
      assert.equal(result.totalSevereAlerts, 0);
    });

    it('should limit topAlerts to 15', async () => {
      const features = Array.from({ length: 20 }, (_, i) => ({
        properties: { event: `Event ${i}`, severity: 'Severe' },
        geometry: null,
      }));
      mockFetch({ features });

      const { briefing } = await import('../apis/sources/noaa.mjs');
      const result = await briefing();

      assert.equal(result.topAlerts.length, 15);
      assert.equal(result.totalSevereAlerts, 20);
    });

    it('should categorize winter and fire events correctly', async () => {
      const alertData = {
        features: [
          { properties: { event: 'Blizzard Warning' }, geometry: null },
          { properties: { event: 'Ice Storm Warning' }, geometry: null },
          { properties: { event: 'Red Flag Fire Warning' }, geometry: null },
        ],
      };
      mockFetch(alertData);

      const { briefing } = await import('../apis/sources/noaa.mjs');
      const result = await briefing();

      assert.equal(result.summary.winterStorms, 2);
      assert.equal(result.summary.wildfires, 1);
    });
  });
});
