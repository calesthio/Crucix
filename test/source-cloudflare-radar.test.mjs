import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError, withEnv } from './helpers.mjs';

import { briefing } from '../apis/sources/cloudflare-radar.mjs';

function makeAnnotation(overrides = {}) {
  return {
    id: 'ann-1',
    description: 'Internet outage in Iran',
    startDate: '2026-03-10T00:00:00Z',
    endDate: null,
    linkedUrl: 'https://example.com',
    scope: 'country',
    asns: [{ asn: 12345 }],
    locations: ['IR'],
    eventType: 'outage',
    ...overrides,
  };
}

function makeAnomaly(overrides = {}) {
  return {
    startDate: '2026-03-12T00:00:00Z',
    endDate: '2026-03-12T06:00:00Z',
    type: 'traffic_anomaly',
    status: 'resolved',
    asnDetails: null,
    locationDetails: null,
    visibleInAllDataSources: false,
    ...overrides,
  };
}

describe('cloudflare-radar', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('briefing', () => {
    it('returns no_credentials when CLOUDFLARE_API_TOKEN not set', async () => {
      await withEnv({ CLOUDFLARE_API_TOKEN: undefined }, async () => {
        const result = await briefing();
        assert.equal(result.source, 'Cloudflare-Radar');
        assert.equal(result.status, 'no_credentials');
        assert.ok(result.message);
      });
    });

    it('returns outages, anomalies, and attacks on success', async () => {
      await withEnv({ CLOUDFLARE_API_TOKEN: 'test-token' }, async () => {
        let callCount = 0;
        globalThis.fetch = async (url) => {
          callCount++;
          let body;
          if (url.includes('annotations')) {
            body = { result: { annotations: [makeAnnotation()] } };
          } else if (url.includes('attacks') && url.includes('protocol')) {
            body = { result: { summary_0: { TCP: '60', UDP: '30', ICMP: '10' } } };
          } else if (url.includes('attacks') && url.includes('vector')) {
            body = { result: { summary_0: { SYN: '50', DNS: '30', NTP: '20' } } };
          } else if (url.includes('traffic_anomalies')) {
            body = { result: { trafficAnomalies: [makeAnomaly()] } };
          } else {
            body = {};
          }
          const text = JSON.stringify(body);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(text),
          };
        };

        const result = await briefing();
        assert.equal(result.source, 'Cloudflare-Radar');
        assert.ok(result.outages);
        assert.equal(result.outages.total, 1);
        assert.ok(result.anomalies);
        assert.equal(result.anomalies.total, 1);
        assert.ok(result.attacks);
        assert.ok(Array.isArray(result.signals));
      });
    });

    it('generates signal for watchlist country outages', async () => {
      await withEnv({ CLOUDFLARE_API_TOKEN: 'test-token' }, async () => {
        globalThis.fetch = async (url) => {
          let body;
          if (url.includes('annotations')) {
            body = {
              result: {
                annotations: [
                  makeAnnotation({ locations: ['RU'], description: 'Outage in Russia' }),
                  makeAnnotation({ id: 'ann-2', locations: ['UA'], description: 'Outage in Ukraine' }),
                ],
              },
            };
          } else if (url.includes('traffic_anomalies')) {
            body = { result: { trafficAnomalies: [] } };
          } else {
            body = { result: { summary_0: {} } };
          }
          const text = JSON.stringify(body);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(text),
          };
        };

        const result = await briefing();
        assert.ok(result.signals.some(s => s.signal && s.signal.includes('Internet outages detected')));
      });
    });

    it('detects sustained disruptions (3+ events in same location)', async () => {
      await withEnv({ CLOUDFLARE_API_TOKEN: 'test-token' }, async () => {
        globalThis.fetch = async (url) => {
          let body;
          if (url.includes('annotations')) {
            body = {
              result: {
                annotations: [
                  makeAnnotation({ id: '1', locations: ['MM'] }),
                  makeAnnotation({ id: '2', locations: ['MM'] }),
                  makeAnnotation({ id: '3', locations: ['MM'] }),
                ],
              },
            };
          } else if (url.includes('traffic_anomalies')) {
            body = { result: { trafficAnomalies: [] } };
          } else {
            body = { result: { summary_0: {} } };
          }
          const text = JSON.stringify(body);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(text),
          };
        };

        const result = await briefing();
        assert.ok(result.signals.some(s => s.signal && s.signal.includes('Sustained internet disruptions')));
      });
    });

    it('handles complete API failure', async () => {
      await withEnv({ CLOUDFLARE_API_TOKEN: 'test-token' }, async () => {
        // safeFetch returns { error, source } on failure
        globalThis.fetch = async () => {
          throw new Error('Unauthorized');
        };

        const result = await briefing();
        assert.equal(result.source, 'Cloudflare-Radar');
        assert.ok(result.error);
      });
    });

    it('handles empty outages and anomalies', async () => {
      await withEnv({ CLOUDFLARE_API_TOKEN: 'test-token' }, async () => {
        globalThis.fetch = async (url) => {
          let body;
          if (url.includes('annotations')) {
            body = { result: { annotations: [] } };
          } else if (url.includes('traffic_anomalies')) {
            body = { result: { trafficAnomalies: [] } };
          } else {
            body = { result: { summary_0: {} } };
          }
          const text = JSON.stringify(body);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(text),
          };
        };

        const result = await briefing();
        assert.equal(result.outages.total, 0);
        assert.equal(result.anomalies.total, 0);
        assert.deepStrictEqual(result.signals, []);
      });
    });
  });
});
