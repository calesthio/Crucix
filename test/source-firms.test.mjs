import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetchError, withEnv } from './helpers.mjs';

import { briefing } from '../apis/sources/firms.mjs';

before(() => saveFetch());
after(() => restoreFetch());

const csvHeader = 'latitude,longitude,bright_ti4,frp,confidence,acq_date,acq_time,daynight';
const csvRow1 = '48.5,35.2,340.5,15.3,h,2026-04-10,0130,N';   // high confidence, night, high FRP
const csvRow2 = '48.3,34.8,310.2,8.1,n,2026-04-10,1400,D';     // nominal, day, lower FRP
const csvRow3 = '48.1,35.0,380.0,25.0,h,2026-04-10,0200,N';    // high confidence, night, very high FRP

function mockFirmsFetch(csvBody) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(csvBody),
  });
}

describe('firms - briefing', () => {
  it('returns no_key status when FIRMS_MAP_KEY is not set', async () => {
    await withEnv({ FIRMS_MAP_KEY: null }, async () => {
      const result = await briefing();
      assert.equal(result.source, 'NASA FIRMS');
      assert.equal(result.status, 'no_key');
      assert.ok(result.message.includes('FIRMS_MAP_KEY'));
    });
  });

  it('returns active status with hotspot data', async () => {
    const csv = [csvHeader, csvRow1, csvRow2, csvRow3].join('\n');
    mockFirmsFetch(csv);

    await withEnv({ FIRMS_MAP_KEY: 'test-key-123' }, async () => {
      const result = await briefing();
      assert.equal(result.source, 'NASA FIRMS');
      assert.equal(result.status, 'active');
      assert.ok(Array.isArray(result.hotspots));
      assert.equal(result.hotspots.length, 6); // 6 HOTSPOTS defined

      const hotspot = result.hotspots[0];
      assert.ok(hotspot.region);
      assert.equal(hotspot.totalDetections, 3);
      assert.equal(hotspot.highConfidence, 2); // 2 with 'h'
      assert.equal(hotspot.nightDetections, 2); // 2 with 'N'

      // High intensity fires (FRP > 10)
      assert.ok(hotspot.highIntensity.length >= 2);
      assert.ok(hotspot.highIntensity[0].frp > hotspot.highIntensity[1].frp); // sorted desc

      assert.ok(typeof hotspot.avgFRP === 'number');
      assert.ok(Array.isArray(result.signals));
    });
  });

  it('handles HTTP error from FIRMS API', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    });

    await withEnv({ FIRMS_MAP_KEY: 'test-key-123' }, async () => {
      const result = await briefing();
      assert.equal(result.status, 'active');
      // All hotspots should have error
      for (const h of result.hotspots) {
        assert.ok(h.error);
      }
    });
  });

  it('handles network error', async () => {
    mockFetchError('ETIMEDOUT');

    await withEnv({ FIRMS_MAP_KEY: 'test-key-123' }, async () => {
      const result = await briefing();
      assert.equal(result.source, 'NASA FIRMS');
      for (const h of result.hotspots) {
        assert.ok(h.error);
      }
    });
  });

  it('handles empty CSV response', async () => {
    mockFirmsFetch(csvHeader); // header only, no data rows

    await withEnv({ FIRMS_MAP_KEY: 'test-key-123' }, async () => {
      const result = await briefing();
      for (const h of result.hotspots) {
        assert.equal(h.totalDetections, 0);
        assert.equal(h.summary, 'No detections');
      }
    });
  });

  it('generates signals for high intensity fire clusters', async () => {
    // Create many high-intensity fires
    const rows = [];
    for (let i = 0; i < 10; i++) {
      rows.push(`48.${i},35.${i},350.0,${20 + i},h,2026-04-10,0${i}30,N`);
    }
    const csv = [csvHeader, ...rows].join('\n');
    mockFirmsFetch(csv);

    await withEnv({ FIRMS_MAP_KEY: 'test-key-123' }, async () => {
      const result = await briefing();
      // Should generate HIGH INTENSITY FIRES signal (>5 detections >10MW)
      const intensitySignal = result.signals.find(s => s.includes('HIGH INTENSITY'));
      assert.ok(intensitySignal);
    });
  });

  it('generates signals for elevated night activity', async () => {
    const rows = [];
    for (let i = 0; i < 25; i++) {
      rows.push(`48.${i % 10},35.${i % 10},300.0,5.0,n,2026-04-10,0200,N`);
    }
    const csv = [csvHeader, ...rows].join('\n');
    mockFirmsFetch(csv);

    await withEnv({ FIRMS_MAP_KEY: 'test-key-123' }, async () => {
      const result = await briefing();
      const nightSignal = result.signals.find(s => s.includes('NIGHT ACTIVITY'));
      assert.ok(nightSignal);
    });
  });

  it('includes API key in request URL', async () => {
    let capturedUrl = '';
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, text: () => Promise.resolve(csvHeader) };
    };

    await withEnv({ FIRMS_MAP_KEY: 'my-secret-key' }, async () => {
      await briefing();
      assert.ok(capturedUrl.includes('my-secret-key'));
    });
  });
});
