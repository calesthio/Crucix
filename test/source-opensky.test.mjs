import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

import { getAllFlights, getFlightsInArea, getFlightsByIcao, getDepartures, getArrivals, briefing } from '../apis/sources/opensky.mjs';

before(() => saveFetch());
after(() => restoreFetch());

const sampleState = ['abc123', 'UAL123 ', 'United States', 1712000000, 1712000000, -73.78, 40.64, 10000, false, 250, 180, 5.0, null, 10500, '1234', false, 0];

describe('opensky - getAllFlights', () => {
  it('returns state vectors', async () => {
    mockFetch({ time: 1712000000, states: [sampleState] });
    const result = await getAllFlights();
    assert.equal(result.states.length, 1);
    assert.equal(result.states[0][0], 'abc123');
  });

  it('handles API error', async () => {
    mockFetchError('Timeout');
    const result = await getAllFlights();
    assert.ok(result.error);
  });
});

describe('opensky - getFlightsInArea', () => {
  it('passes bounding box params', async () => {
    const fn = mockFetch({ states: [] });
    await getFlightsInArea(40, -74, 42, -72);
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('lamin=40'));
    assert.ok(url.includes('lomin=-74'));
    assert.ok(url.includes('lamax=42'));
    assert.ok(url.includes('lomax=-72'));
  });
});

describe('opensky - getFlightsByIcao', () => {
  it('accepts array of ICAO codes', async () => {
    const fn = mockFetch({ states: [sampleState] });
    await getFlightsByIcao(['abc123', 'def456']);
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('icao24=abc123'));
    assert.ok(url.includes('icao24=def456'));
  });

  it('accepts single ICAO code string', async () => {
    const fn = mockFetch({ states: [] });
    await getFlightsByIcao('abc123');
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('icao24=abc123'));
  });
});

describe('opensky - getDepartures', () => {
  it('passes airport and time range', async () => {
    const fn = mockFetch([{ icao24: 'abc123', callsign: 'UAL123' }]);
    const begin = 1712000000000;
    const end = 1712100000000;
    await getDepartures('KJFK', begin, end);
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('airport=KJFK'));
    assert.ok(url.includes('begin=1712000000'));
    assert.ok(url.includes('end=1712100000'));
  });
});

describe('opensky - getArrivals', () => {
  it('passes airport and time range', async () => {
    const fn = mockFetch([{ icao24: 'xyz789' }]);
    const begin = 1712000000000;
    const end = 1712100000000;
    await getArrivals('EGLL', begin, end);
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('airport=EGLL'));
  });
});

describe('opensky - briefing', () => {
  it('returns structured hotspot data', async () => {
    const states = [
      ['abc123', 'UAL123 ', 'United States', 1712000000, 1712000000, -73.78, 40.64, 13000, false, 250, 180, 5.0, null, 10500, '1234', false, 0],
      ['def456', '        ', 'Russia', 1712000000, 1712000000, 35.0, 48.0, 8000, false, 200, 90, 3.0, null, 8000, '5678', false, 0],
    ];
    mockFetch({ time: 1712000000, states });

    const result = await briefing();
    assert.equal(result.source, 'OpenSky');
    assert.ok(result.timestamp);
    assert.equal(result.hotspots.length, 10); // 10 HOTSPOTS
    // Each hotspot should have aggregated data
    const hotspot = result.hotspots[0];
    assert.ok(typeof hotspot.totalAircraft === 'number');
    assert.ok(typeof hotspot.noCallsign === 'number');
    assert.ok(typeof hotspot.highAltitude === 'number');
    assert.ok(hotspot.byCountry);
    assert.ok(!result.error); // no errors when all succeed
  });

  it('handles empty states array', async () => {
    mockFetch({ time: 1712000000, states: [] });
    const result = await briefing();
    assert.equal(result.source, 'OpenSky');
    for (const h of result.hotspots) {
      assert.equal(h.totalAircraft, 0);
    }
  });

  it('reports errors when API fails', async () => {
    mockFetchError('Service down');
    const result = await briefing();
    assert.equal(result.source, 'OpenSky');
    assert.ok(result.error);
    assert.ok(result.hotspotErrors.length > 0);
  });

  it('handles missing states key', async () => {
    mockFetch({ time: 1712000000 }); // no states
    const result = await briefing();
    for (const h of result.hotspots) {
      assert.equal(h.totalAircraft, 0);
    }
  });

  it('counts high altitude aircraft correctly', async () => {
    const states = [
      ['a', 'CALL1', 'US', 0, 0, 0, 0, 13000, false, 0, 0, 0, null, 0, '', false, 0], // >12000
      ['b', 'CALL2', 'US', 0, 0, 0, 0, 11000, false, 0, 0, 0, null, 0, '', false, 0], // <12000
    ];
    mockFetch({ states });
    const result = await briefing();
    // All hotspots get the same data since we mock globally
    assert.equal(result.hotspots[0].highAltitude, 1);
  });
});
