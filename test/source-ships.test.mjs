// Ships/AIS source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies
// NOTE: ships.mjs is STATIC — no fetch calls. No mocking needed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing, getWebSocketConfig } from '../apis/sources/ships.mjs';

describe('ships briefing', () => {
  it('returns structured data without any fetch calls', async () => {
    const result = await briefing();
    assert.ok(result.source);
    assert.ok(result.timestamp);
    assert.equal(result.source, 'Maritime/AIS');
  });

  it('includes chokepoints data', async () => {
    const result = await briefing();
    assert.ok(result.chokepoints);
    assert.ok(typeof result.chokepoints === 'object');
    // Should include the 9 standard chokepoints
    assert.ok('straitOfHormuz' in result.chokepoints);
    assert.ok('suezCanal' in result.chokepoints);
    assert.ok('straitOfMalacca' in result.chokepoints);
    assert.ok('taiwanStrait' in result.chokepoints);
  });

  it('chokepoint entries have label, lat, lon, and note', async () => {
    const result = await briefing();
    const hormuz = result.chokepoints.straitOfHormuz;
    assert.ok(hormuz.label);
    assert.ok(typeof hormuz.lat === 'number');
    assert.ok(typeof hormuz.lon === 'number');
    assert.ok(hormuz.note);
  });

  it('includes monitoring capabilities list', async () => {
    const result = await briefing();
    assert.ok(Array.isArray(result.monitoringCapabilities));
    assert.ok(result.monitoringCapabilities.length > 0);
  });

  it('returns a valid ISO timestamp', async () => {
    const result = await briefing();
    assert.ok(!isNaN(Date.parse(result.timestamp)));
  });

  it('reflects AISSTREAM_API_KEY presence in status', async () => {
    // Without key
    delete process.env.AISSTREAM_API_KEY;
    const noKeyResult = await briefing();
    assert.equal(noKeyResult.status, 'limited');

    // With key
    process.env.AISSTREAM_API_KEY = 'test-key';
    const withKeyResult = await briefing();
    assert.equal(withKeyResult.status, 'ready');

    // Restore
    delete process.env.AISSTREAM_API_KEY;
  });
});

describe('ships getWebSocketConfig', () => {
  it('returns wss URL and a valid JSON message', () => {
    const config = getWebSocketConfig('test-api-key');
    assert.ok(config.url.startsWith('wss://'));
    const msg = JSON.parse(config.message);
    assert.equal(msg.APIKey, 'test-api-key');
    assert.ok(Array.isArray(msg.BoundingBoxes));
    assert.ok(msg.BoundingBoxes.length > 0);
  });
});
