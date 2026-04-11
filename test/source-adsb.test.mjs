import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError, withEnv } from './helpers.mjs';

let mod;
before(async () => {
  saveFetch();
  mod = await import('../apis/sources/adsb.mjs');
});
after(() => { restoreFetch(); });

// Sample ADS-B aircraft data
function militaryAircraft() {
  return [
    { hex: 'AE1234', flight: 'RCH501', t: 'C17', lat: 38.5, lon: -77.0, alt_baro: 35000, gs: 450, track: 90, squawk: '1200', mil: true, r: 'N1234' },
    { hex: 'AE5678', flight: 'TOPCAT1', t: 'E6B', lat: 35.0, lon: -120.0, alt_baro: 41000, gs: 500, track: 180, squawk: '7777', mil: true, r: 'N5678' },
    { hex: 'AE9ABC', flight: 'DOOM01', t: 'E4B', lat: 40.0, lon: -100.0, alt_baro: 45000, gs: 550, track: 270, squawk: '0100', mil: true, r: 'N9ABC' },
    { hex: 'AAAAAA', flight: 'BISON1', t: 'B52', lat: 32.0, lon: -110.0, alt_baro: 38000, gs: 480, track: 45, squawk: '1300', mil: true, r: 'NAAAA' },
    { hex: 'ADF800', flight: 'NAVY01', t: 'P8A', lat: 36.0, lon: -75.0, alt_baro: 25000, gs: 380, track: 120, squawk: '1400', mil: false, r: 'NADF8' },
    { hex: 'ADF900', flight: 'KC135A', t: 'KC135', lat: 38.0, lon: -95.0, alt_baro: 32000, gs: 440, track: 270, mil: false, r: 'NADF9' },
  ];
}

function civilianAircraft() {
  return [
    { hex: '123456', flight: 'AAL100', t: 'B738', lat: 40.0, lon: -74.0, alt_baro: 35000, gs: 450, track: 90 },
    { hex: '789ABC', flight: 'UAL200', t: 'A320', lat: 41.0, lon: -87.0, alt_baro: 30000, gs: 430, track: 180 },
  ];
}

describe('ADS-B source', () => {
  describe('getMilitaryAircraft()', () => {
    it('returns military aircraft from RapidAPI when key is provided', async () => {
      mockFetch({ ac: [...militaryAircraft(), ...civilianAircraft()] });

      const result = await mod.getMilitaryAircraft('test-api-key');
      assert.ok(Array.isArray(result));
      // All should be military
      for (const ac of result) {
        assert.ok(ac.isMilitary, `${ac.callsign} should be military`);
      }
    });

    it('falls back to public feed when no API key', async () => {
      mockFetch({ ac: militaryAircraft() });

      const result = await mod.getMilitaryAircraft(null);
      assert.ok(Array.isArray(result));
      assert.ok(result.length > 0);
    });

    it('returns null when all sources fail', async () => {
      mockFetch({ error: 'Service unavailable', source: 'test' });

      const result = await mod.getMilitaryAircraft(null);
      assert.equal(result, null);
    });

    it('classifies aircraft by hex range correctly', async () => {
      // ADF800 is in the US Military hex range (ADF7C8-AFFFFF)
      mockFetch({ ac: [{ hex: 'ADF800', flight: 'NORMAL1', t: 'UNKN', lat: 36, lon: -75 }] });

      const result = await mod.getMilitaryAircraft(null);
      assert.ok(Array.isArray(result));
      assert.ok(result.length > 0);
      assert.ok(result[0].isMilitary);
      assert.ok(result[0].militaryMatch.includes('US Military'));
    });

    it('classifies aircraft by callsign pattern', async () => {
      mockFetch({ ac: [{ hex: '000001', flight: 'NAVY02', t: 'UNKN', lat: 36, lon: -75 }] });

      const result = await mod.getMilitaryAircraft(null);
      assert.ok(Array.isArray(result));
      assert.ok(result.length > 0);
      assert.ok(result[0].isMilitary);
      assert.equal(result[0].militaryMatch, 'callsign pattern');
    });

    it('classifies aircraft by known military type', async () => {
      mockFetch({ ac: [{ hex: '000002', flight: 'TEST01', t: 'B52', lat: 32, lon: -110 }] });

      const result = await mod.getMilitaryAircraft(null);
      assert.ok(result.length > 0);
      assert.ok(result[0].isMilitary);
      assert.equal(result[0].militaryMatch, 'type match');
      assert.ok(result[0].typeDescription.includes('Stratofortress'));
    });

    it('handles empty aircraft array', async () => {
      mockFetch({ ac: [] });

      const result = await mod.getMilitaryAircraft('test-key');
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 0);
    });
  });

  describe('getAircraftInArea()', () => {
    it('requires API key', async () => {
      const result = await mod.getAircraftInArea(38, -77, 250, undefined);
      assert.ok(result.error);
      assert.ok(result.error.includes('ADSB_API_KEY'));
    });

    it('returns classified aircraft for area search', async () => {
      mockFetch({ ac: [...militaryAircraft(), ...civilianAircraft()] });

      const result = await mod.getAircraftInArea(38, -77, 250, 'test-key');
      assert.ok(Array.isArray(result));
      assert.ok(result.length === 8);
      // Each should have the classified structure
      for (const ac of result) {
        assert.ok('hex' in ac);
        assert.ok('isMilitary' in ac);
        assert.ok('callsign' in ac);
      }
    });
  });

  describe('briefing()', () => {
    it('returns no_key status when no API key is set', async () => {
      // Return error from public feed too
      mockFetch({ error: 'blocked', source: 'test' });

      const result = await withEnv({ ADSB_API_KEY: null, RAPIDAPI_KEY: null }, async () => {
        return mod.briefing();
      });

      assert.equal(result.source, 'ADS-B Exchange');
      assert.equal(result.status, 'no_key');
      assert.ok(result.message.includes('No ADS-B Exchange API key'));
      assert.ok(result.integrationGuide);
    });

    it('returns live briefing with military aircraft data', async () => {
      mockFetch({ ac: militaryAircraft() });

      const result = await withEnv({ ADSB_API_KEY: 'test-key' }, async () => {
        return mod.briefing();
      });

      assert.equal(result.source, 'ADS-B Exchange');
      assert.equal(result.status, 'live');
      assert.ok(result.totalMilitary > 0);
      assert.ok(result.byCountry);
      assert.ok(result.categories);
      assert.ok(result.categories.reconnaissance);
      assert.ok(result.categories.bombers);
      assert.ok(result.categories.tankers);
      assert.ok(result.categories.vipTransport);
      assert.ok(Array.isArray(result.signals));
    });

    it('generates signals for bombers airborne', async () => {
      mockFetch({ ac: [
        { hex: '000001', flight: 'TEST', t: 'B52', lat: 32, lon: -110, mil: true },
      ]});

      const result = await withEnv({ ADSB_API_KEY: 'test-key' }, async () => {
        return mod.briefing();
      });

      assert.ok(result.signals.some(s => s.includes('BOMBERS AIRBORNE')));
    });

    it('generates signals for VIP transport', async () => {
      mockFetch({ ac: [
        { hex: '000001', flight: 'DOOM01', t: 'E4B', lat: 40, lon: -100, mil: true },
      ]});

      const result = await withEnv({ ADSB_API_KEY: 'test-key' }, async () => {
        return mod.briefing();
      });

      assert.ok(result.signals.some(s => s.includes('VIP AIRCRAFT')));
    });

    it('handles network error gracefully', async () => {
      mockFetchError('Network timeout');

      const result = await withEnv({ ADSB_API_KEY: 'test-key' }, async () => {
        return mod.briefing();
      });

      // Should return error or no_key status (since all sources fail)
      assert.equal(result.source, 'ADS-B Exchange');
      assert.ok(result.status === 'error' || result.status === 'no_key');
    });
  });
});
