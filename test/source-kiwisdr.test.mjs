// KiwiSDR Network — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/kiwisdr.mjs';

// receiverbook.de format: var receivers = [...] with GeoJSON-style location
const CANNED_HTML = `<!DOCTYPE html>
<html>
<head><title>KiwiSDR Map</title></head>
<body>
<script>
var receivers = [{"label":"Test Receiver, GB","location":{"type":"Point","coordinates":[-0.1,51.5]},"receivers":[{"label":"Test Receiver","url":"http://test.kiwisdr.com","version":"1.6"}]}];
</script>
</body>
</html>`;

// Minimal HTML with multiple receivers for richer coverage tests
const MULTI_RECEIVER_HTML = `<!DOCTYPE html>
<html><body>
<script>
var receivers = [
  {"label":"UK Receiver, GB","location":{"type":"Point","coordinates":[-0.1,51.5]},"receivers":[{"label":"UK Receiver","url":"http://uk.kiwisdr.com","version":"1.6"}]},
  {"label":"US Receiver, US","location":{"type":"Point","coordinates":[-77.0,38.9]},"receivers":[{"label":"US Receiver","url":"http://us.kiwisdr.com","version":"1.6"}]},
  {"label":"Ukraine Receiver, UA","location":{"type":"Point","coordinates":[32.0,49.0]},"receivers":[{"label":"Ukraine Receiver","url":"http://ua.kiwisdr.com","version":"1.6"}]}
];
</script>
</body></html>`;

describe('kiwisdr briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => CANNED_HTML,
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'KiwiSDR');
      assert.ok(result.timestamp);
      assert.ok(result.status === 'active' || result.status === 'error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns active status with valid receiver data', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => CANNED_HTML,
    });
    try {
      const result = await briefing();
      assert.equal(result.status, 'active');
      assert.ok(result.network);
      assert.ok(typeof result.network.totalReceivers === 'number');
      assert.ok(result.network.totalReceivers >= 1);
      assert.ok(result.geographic);
      assert.ok(result.conflictZones);
      assert.ok(Array.isArray(result.topActive));
      assert.ok(Array.isArray(result.signals));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('includes geographic distribution in output', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => MULTI_RECEIVER_HTML,
    });
    try {
      const result = await briefing();
      assert.ok(result.geographic);
      assert.ok(result.geographic.byContinent);
      assert.ok(Array.isArray(result.geographic.topCountries));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles fetch failure gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    try {
      const result = await briefing();
      assert.ok(result !== undefined); // must not throw
      assert.equal(result.source, 'KiwiSDR');
      assert.equal(result.status, 'error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles non-ok HTTP response gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'KiwiSDR');
      assert.equal(result.status, 'error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles HTML without embedded receivers variable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '<html><body>No receiver data here</body></html>',
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'KiwiSDR');
      assert.equal(result.status, 'error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
