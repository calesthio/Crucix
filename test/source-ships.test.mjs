// Ships/Maritime source — unit tests

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch } from './helpers.mjs';
import { withEnv } from './helpers.mjs';

describe('Ships source', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('briefing', () => {
    it('should return limited status when no API key is set', async () => {
      await withEnv({ AISSTREAM_API_KEY: undefined }, async () => {
        const { briefing } = await import('../apis/sources/ships.mjs');
        const result = await briefing();

        assert.equal(result.source, 'Maritime/AIS');
        assert.ok(result.timestamp);
        assert.equal(result.status, 'limited');
        assert.ok(result.message.includes('AISSTREAM_API_KEY'));
        assert.ok(result.chokepoints);
        assert.ok(Array.isArray(result.monitoringCapabilities));
      });
    });

    it('should return ready status when API key is set', async () => {
      await withEnv({ AISSTREAM_API_KEY: 'test-key-123' }, async () => {
        const { briefing } = await import('../apis/sources/ships.mjs');
        const result = await briefing();

        assert.equal(result.source, 'Maritime/AIS');
        assert.equal(result.status, 'ready');
        assert.ok(result.message.includes('AIS stream connected'));
      });
    });

    it('should include all major chokepoints', async () => {
      const { briefing } = await import('../apis/sources/ships.mjs');
      const result = await briefing();

      const chokepoints = result.chokepoints;
      assert.ok(chokepoints.straitOfHormuz);
      assert.ok(chokepoints.suezCanal);
      assert.ok(chokepoints.straitOfMalacca);
      assert.ok(chokepoints.taiwanStrait);
      assert.ok(chokepoints.panamaCanal);

      // Each chokepoint should have lat, lon, label, note
      const hormuz = chokepoints.straitOfHormuz;
      assert.equal(hormuz.label, 'Strait of Hormuz');
      assert.equal(typeof hormuz.lat, 'number');
      assert.equal(typeof hormuz.lon, 'number');
      assert.ok(hormuz.note);
    });

    it('should list monitoring capabilities', async () => {
      const { briefing } = await import('../apis/sources/ships.mjs');
      const result = await briefing();

      assert.ok(result.monitoringCapabilities.length >= 4);
      assert.ok(result.monitoringCapabilities.some(c => c.includes('Dark ship')));
    });
  });

  describe('getWebSocketConfig', () => {
    it('should return valid WebSocket config', async () => {
      const { getWebSocketConfig } = await import('../apis/sources/ships.mjs');
      const config = getWebSocketConfig('test-api-key');

      assert.equal(config.url, 'wss://stream.aisstream.io/v0/stream');
      const msg = JSON.parse(config.message);
      assert.equal(msg.APIKey, 'test-api-key');
      assert.ok(Array.isArray(msg.BoundingBoxes));
      assert.ok(msg.BoundingBoxes.length > 0);
    });

    it('should generate bounding boxes for each chokepoint', async () => {
      const { getWebSocketConfig } = await import('../apis/sources/ships.mjs');
      const config = getWebSocketConfig('key');
      const msg = JSON.parse(config.message);

      // Should have one bounding box per chokepoint (9 total)
      assert.equal(msg.BoundingBoxes.length, 9);
      // Each bounding box is [[lat-2,lon-2],[lat+2,lon+2]]
      for (const box of msg.BoundingBoxes) {
        assert.equal(box.length, 2);
        assert.equal(box[0].length, 2);
        assert.equal(box[1].length, 2);
      }
    });
  });
});
