import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/cloudflare-radar.mjs';
import { summarizeCyber } from '../lib/cyber.mjs';

test('Radar reports missing credentials and distinguishes a failed endpoint from zero outages', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.CLOUDFLARE_API_TOKEN;
  try {
    delete process.env.CLOUDFLARE_API_TOKEN;
    assert.equal((await briefing()).status, 'no_credentials');
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    globalThis.fetch = async url => new Response(JSON.stringify(url.includes('/annotations/outages')
      ? { success: false, errors: [{ message: 'Denied' }] }
      : url.includes('/traffic_anomalies')
        ? { success: true, result: { trafficAnomalies: [] } }
        : { success: true, result: { summary_0: { UDP: '50' } } }));
    const data = await briefing();
    assert.ok(data.outages.error);
    assert.equal(data.anomalies.total, 0);
    const { internet } = summarizeCyber({ 'Cloudflare-Radar': data });
    assert.equal(internet.status, 'degraded');
    assert.equal(internet.active, null);
    assert.equal(internet.anomalies, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalToken;
  }
});

test('Radar separates active outages, resolved outages and anomaly annotations', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.CLOUDFLARE_API_TOKEN;
  try {
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    globalThis.fetch = async url => new Response(JSON.stringify(url.includes('/annotations/outages')
      ? { success: true, result: { annotations: [
        { id: 'active', eventType: 'OUTAGE', locations: ['IR'], startDate: '2020-01-01', endDate: null },
        { id: 'resolved', eventType: 'OUTAGE', locations: ['US'], startDate: '2020-01-01', endDate: '2020-01-02' },
        { id: 'anomaly', eventType: 'TRAFFIC_ANOMALY', locations: ['RU'] },
      ] } }
      : url.includes('/traffic_anomalies') ? { success: true, result: { trafficAnomalies: [] } }
        : { success: true, result: { summary_0: { UDP: '50' } } }));
    const data = await briefing();
    assert.equal(data.outages.active, 1);
    assert.equal(data.outages.total, 2);
    assert.equal(data.outages.recentResolved[0].id, 'resolved');
    assert.ok(!data.signals[0].signal.includes('infrastructure attack'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalToken;
  }
});
