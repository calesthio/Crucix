import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrbitTrack, propagateOrbit } from '../lib/orbit.mjs';

const ISS = {
  epoch: '2026-09-29T19:40:36+00:00',
  inclination: 51.6314,
  raan: 140.6663,
  eccentricity: 0.0007036,
  argPerigee: 204.8576,
  meanAnomaly: 155.2074,
  meanMotion: 15.48692916,
  period: 92.98,
};

describe('orbit propagation', () => {
  it('produces a plausible ISS position', () => {
    const point = propagateOrbit(ISS, new Date('2026-09-30T12:00:00Z'));
    assert.ok(point);
    assert.ok(point.lat >= -52 && point.lat <= 52, `latitude ${point.lat}`);
    assert.ok(point.lon >= -180 && point.lon <= 180, `longitude ${point.lon}`);
    assert.ok(point.altitude >= 380 && point.altitude <= 450, `altitude ${point.altitude}`);
  });

  it('builds complete previous and next orbit tracks', () => {
    const at = new Date('2026-09-30T12:00:00Z');
    const track = buildOrbitTrack(ISS, at);
    assert.equal(track.periodMinutes, 92.98);
    assert.ok(track.previous.length >= 93);
    assert.ok(track.next.length >= 93);
    assert.equal(track.previous.at(-1).timestamp, at.toISOString());
    assert.equal(track.next[0].timestamp, at.toISOString());
    assert.ok(track.previous.some(point => point.lat > 50));
    assert.ok(track.next.some(point => point.lat < -50));
  });

  it('returns null when required orbital elements are unavailable', () => {
    assert.equal(buildOrbitTrack({ inclination: 51.6, period: 93 }), null);
  });
});
