import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

let mod;
before(async () => {
  saveFetch();
  mod = await import('../apis/sources/space.mjs');
});
after(() => { restoreFetch(); });

// Sample CelesTrak TLE data
function sampleStations() {
  return [
    { OBJECT_NAME: 'ISS (ZARYA)', NORAD_CAT_ID: 25544, APOAPSIS: 422.1, PERIAPSIS: 418.3, INCLINATION: 51.6, PERIOD: 92.9, EPOCH: '2026-04-09T12:00:00' },
    { OBJECT_NAME: 'CSS (TIANHE)', NORAD_CAT_ID: 48274, APOAPSIS: 389.0, PERIAPSIS: 382.0, INCLINATION: 41.5, PERIOD: 92.2, EPOCH: '2026-04-09T11:00:00' },
  ];
}

function sampleLaunches() {
  return [
    { OBJECT_NAME: 'STARLINK-1001', NORAD_CAT_ID: 90001, CLASSIFICATION_TYPE: 'U', LAUNCH_DATE: '2026-04-01', DECAY_DATE: null, PERIOD: 95.5, INCLINATION: 53.0, APOAPSIS: 550, PERIAPSIS: 540, EPOCH: '2026-04-08T12:00:00', COUNTRY_CODE: 'US', OBJECT_TYPE: 'PAY' },
    { OBJECT_NAME: 'COSMOS 2999', NORAD_CAT_ID: 90002, CLASSIFICATION_TYPE: 'C', LAUNCH_DATE: '2026-03-28', DECAY_DATE: null, PERIOD: 100.0, INCLINATION: 65.0, APOAPSIS: 800, PERIAPSIS: 790, EPOCH: '2026-04-07T10:00:00', COUNTRY_CODE: 'CIS', OBJECT_TYPE: 'PAY' },
    { OBJECT_NAME: 'YAOGAN-40', NORAD_CAT_ID: 90003, CLASSIFICATION_TYPE: 'U', LAUNCH_DATE: '2026-04-02', DECAY_DATE: null, PERIOD: 97.0, INCLINATION: 97.5, APOAPSIS: 700, PERIAPSIS: 690, EPOCH: '2026-04-06T08:00:00', COUNTRY_CODE: 'PRC', OBJECT_TYPE: 'PAY' },
  ];
}

function sampleMilitary() {
  return Array.from({ length: 10 }, (_, i) => ({
    OBJECT_NAME: `MIL-SAT-${i}`, NORAD_CAT_ID: 80000 + i, COUNTRY_CODE: i < 5 ? 'US' : 'CIS',
  }));
}

// The space module makes 4 parallel safeFetch calls via getTLEs
// We need to route different URLs to different data
function mockSpaceFetch(opts = {}) {
  const { stations, launches, military, starlink, oneweb } = {
    stations: sampleStations(),
    launches: sampleLaunches(),
    military: sampleMilitary(),
    starlink: Array.from({ length: 50 }, (_, i) => ({ OBJECT_NAME: `STARLINK-${i}` })),
    oneweb: Array.from({ length: 20 }, (_, i) => ({ OBJECT_NAME: `ONEWEB-${i}` })),
    ...opts,
  };

  globalThis.fetch = async (url) => {
    let data;
    if (url.includes('GROUP=stations')) data = stations;
    else if (url.includes('GROUP=last-30-days')) data = launches;
    else if (url.includes('GROUP=military')) data = military;
    else if (url.includes('GROUP=starlink')) data = starlink;
    else if (url.includes('GROUP=oneweb')) data = oneweb;
    else data = [];

    const json = JSON.stringify(data);
    return {
      ok: true, status: 200,
      text: async () => json,
      json: async () => data,
      headers: new Headers({ 'content-type': 'application/json' }),
    };
  };
}

describe('Space/CelesTrak source', () => {
  describe('briefing()', () => {
    it('returns structured briefing with all sections', async () => {
      mockSpaceFetch();

      const result = await mod.briefing();
      assert.equal(result.source, 'Space/CelesTrak');
      assert.equal(result.status, 'active');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.recentLaunches));
      assert.ok(result.totalNewObjects >= 0);
      assert.ok(result.launchByCountry);
      assert.ok(Array.isArray(result.spaceStations));
      assert.ok(result.militarySatellites >= 0);
      assert.ok(result.constellations);
      assert.ok(Array.isArray(result.signals));
    });

    it('identifies ISS in station data', async () => {
      mockSpaceFetch();

      const result = await mod.briefing();
      assert.ok(result.iss);
      assert.ok(result.iss.name.includes('ISS'));
    });

    it('counts military satellites', async () => {
      mockSpaceFetch();

      const result = await mod.briefing();
      assert.equal(result.militarySatellites, 10);
      assert.ok(result.militaryByCountry);
    });

    it('counts constellation satellites', async () => {
      mockSpaceFetch();

      const result = await mod.briefing();
      assert.equal(result.constellations.starlink, 50);
      assert.equal(result.constellations.oneweb, 20);
    });

    it('groups launches by country', async () => {
      mockSpaceFetch();

      const result = await mod.briefing();
      assert.ok(result.launchByCountry.US >= 1);
      assert.ok(result.launchByCountry.CIS >= 1);
      assert.ok(result.launchByCountry.PRC >= 1);
    });

    it('generates high launch tempo signal when many objects', async () => {
      const manyLaunches = Array.from({ length: 60 }, (_, i) => ({
        OBJECT_NAME: `OBJ-${i}`, NORAD_CAT_ID: 99000 + i,
        EPOCH: '2026-04-01', COUNTRY_CODE: 'US', OBJECT_TYPE: 'PAY',
      }));
      mockSpaceFetch({ launches: manyLaunches });

      const result = await mod.briefing();
      assert.ok(result.signals.some(s => s.includes('HIGH LAUNCH TEMPO')));
    });

    it('generates military constellation signal when count > 500', async () => {
      const bigMilitary = Array.from({ length: 510 }, (_, i) => ({
        OBJECT_NAME: `MIL-${i}`, NORAD_CAT_ID: 70000 + i, COUNTRY_CODE: 'US',
      }));
      mockSpaceFetch({ military: bigMilitary });

      const result = await mod.briefing();
      assert.ok(result.signals.some(s => s.includes('MILITARY CONSTELLATION')));
    });

    it('returns error status when all fetches fail', async () => {
      mockFetchError('Connection refused');

      const result = await mod.briefing();
      assert.equal(result.source, 'Space/CelesTrak');
      assert.equal(result.status, 'error');
      assert.ok(result.error);
    });

    it('handles partial failures gracefully', async () => {
      // Stations succeed, launches fail (return error object from safeFetch)
      globalThis.fetch = async (url) => {
        if (url.includes('GROUP=stations')) {
          const data = sampleStations();
          return {
            ok: true, status: 200,
            text: async () => JSON.stringify(data),
            headers: new Headers({ 'content-type': 'application/json' }),
          };
        }
        // Everything else returns error
        return {
          ok: false, status: 500,
          text: async () => 'Internal Server Error',
          headers: new Headers(),
        };
      };

      const result = await mod.briefing();
      // Should still return active since stations succeeded
      assert.equal(result.status, 'active');
    });
  });
});
