import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch } from './helpers.mjs';

let mod;
before(async () => {
  saveFetch();
  mod = await import('../apis/sources/kiwisdr.mjs');
});
after(() => { restoreFetch(); });

// Build a realistic receiverbook.de HTML page with embedded JS
function makeReceiverHTML(sites) {
  const json = JSON.stringify(sites);
  return `<html><head><title>ReceiverBook</title></head><body>
<script>var receivers = ${json};</script>
</body></html>`;
}

function sampleSites() {
  return [
    {
      label: 'KiwiSDR Berlin, Germany',
      location: { coordinates: [13.405, 52.52] },
      url: 'http://berlin.kiwisdr.com',
      receivers: [
        { label: 'Berlin SDR 1', url: 'http://berlin1.kiwisdr.com', version: '1.5' },
        { label: 'Berlin SDR 2', url: 'http://berlin2.kiwisdr.com', version: '1.6' },
      ],
    },
    {
      label: 'KiwiSDR Tokyo, Japan',
      location: { coordinates: [139.6917, 35.6895] },
      url: 'http://tokyo.kiwisdr.com',
      receivers: [
        { label: 'Tokyo HF', url: 'http://tokyo1.kiwisdr.com', version: '1.5' },
      ],
    },
    {
      label: 'KiwiSDR Kyiv, Ukraine',
      location: { coordinates: [30.5234, 50.4501] },
      url: 'http://kyiv.kiwisdr.com',
      receivers: [
        { label: 'Kyiv SDR', url: 'http://kyiv1.kiwisdr.com', version: '1.4' },
      ],
    },
    {
      label: 'KiwiSDR New York, USA',
      location: { coordinates: [-74.006, 40.7128] },
      url: 'http://ny.kiwisdr.com',
      receivers: [
        { label: 'NYC SDR', url: 'http://ny1.kiwisdr.com', version: '1.5' },
      ],
    },
  ];
}

function mockReceiverBookFetch(html) {
  globalThis.fetch = async (url, opts) => {
    return {
      ok: true,
      status: 200,
      text: async () => html,
      headers: new Headers({ 'content-type': 'text/html' }),
    };
  };
}

describe('KiwiSDR source', () => {
  describe('getAllReceivers()', () => {
    it('parses receiver data from HTML page', async () => {
      const html = makeReceiverHTML(sampleSites());
      mockReceiverBookFetch(html);

      const result = await mod.getAllReceivers();
      assert.ok(Array.isArray(result));
      // 2 + 1 + 1 + 1 = 5 receivers total
      assert.equal(result.length, 5);
      assert.ok(result[0].name);
      assert.ok(result[0].url);
    });

    it('returns error when HTML has no receiver data', async () => {
      globalThis.fetch = async () => ({
        ok: true, status: 200,
        text: async () => '<html><body>No data</body></html>',
        headers: new Headers(),
      });

      const result = await mod.getAllReceivers();
      assert.ok(result.error);
      assert.ok(result.error.includes('parse'));
    });

    it('returns error on HTTP failure', async () => {
      globalThis.fetch = async () => ({
        ok: false, status: 503,
        text: async () => 'Service Unavailable',
        headers: new Headers(),
      });

      const result = await mod.getAllReceivers();
      assert.ok(result.error);
      assert.ok(result.error.includes('503'));
    });

    it('returns error on network failure', async () => {
      globalThis.fetch = async () => { throw new Error('DNS resolution failed'); };

      const result = await mod.getAllReceivers();
      assert.ok(result.error);
      assert.ok(result.error.includes('DNS'));
    });
  });

  describe('briefing()', () => {
    it('returns structured briefing with geographic data', async () => {
      const html = makeReceiverHTML(sampleSites());
      mockReceiverBookFetch(html);

      const result = await mod.briefing();
      assert.equal(result.source, 'KiwiSDR');
      assert.equal(result.status, 'active');
      assert.ok(result.network);
      assert.equal(result.network.totalReceivers, 5);
      assert.equal(result.network.online, 5);
      assert.equal(result.network.offline, 0);
      assert.ok(result.geographic);
      assert.ok(result.geographic.byContinent);
      assert.ok(Array.isArray(result.geographic.topCountries));
      assert.ok(result.conflictZones);
      assert.ok(Array.isArray(result.topActive));
      assert.ok(Array.isArray(result.signals));
    });

    it('identifies receivers in conflict zones', async () => {
      const html = makeReceiverHTML(sampleSites());
      mockReceiverBookFetch(html);

      const result = await mod.briefing();
      // Kyiv (50.45, 30.52) should be in Ukraine bounding box (44-53, 22-41)
      const ukraine = result.conflictZones.ukraine;
      assert.ok(ukraine);
      assert.ok(ukraine.count >= 1, `Expected Ukraine count >= 1, got ${ukraine.count}`);
    });

    it('handles error from getAllReceivers', async () => {
      globalThis.fetch = async () => { throw new Error('Timeout'); };

      const result = await mod.briefing();
      assert.equal(result.source, 'KiwiSDR');
      assert.equal(result.status, 'error');
      assert.ok(result.message);
    });

    it('handles empty receiver list', async () => {
      const html = makeReceiverHTML([]);
      mockReceiverBookFetch(html);

      const result = await mod.briefing();
      assert.equal(result.source, 'KiwiSDR');
      assert.equal(result.status, 'active');
      assert.equal(result.network.totalReceivers, 0);
    });

    it('calculates utilization correctly', async () => {
      const sites = [
        {
          label: 'Busy SDR, Germany',
          location: { coordinates: [13.0, 52.0] },
          receivers: [{ label: 'Busy', url: 'http://busy.com', version: '1.5' }],
        },
      ];
      const html = makeReceiverHTML(sites);
      mockReceiverBookFetch(html);

      const result = await mod.briefing();
      // With users: 0 and usersMax: 0, utilization should be 0
      assert.equal(result.network.utilizationPct, 0);
    });
  });
});
