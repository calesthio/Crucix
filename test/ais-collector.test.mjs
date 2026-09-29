// AIS collector + Maritime source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies, no network

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AisCollector, aisCollector, shipCategory, cleanText } from '../lib/maritime/ais-collector.mjs';
import { findChokepoint } from '../lib/maritime/chokepoints.mjs';
import { computeDelta } from '../lib/delta/engine.mjs';

// ─── Test doubles ───

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; }
  // helpers
  open() { this.onopen?.(); }
  receive(obj) { this.onmessage?.({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
  drop(code = 1006) { this.onclose?.({ code, reason: '' }); }
}

const quiet = { log() {}, warn() {}, error() {} };
let clock;

function makeCollector(extra = {}) {
  return new AisCollector({
    WebSocketImpl: FakeWebSocket,
    now: () => clock,
    logger: quiet,
    backoffBaseMs: 5,
    backoffMaxMs: 20,
    housekeepingMs: 60_000,
    ...extra,
  });
}

function position(mmsi, lat, lon, { sog = 12, nav = 0, type = 'PositionReport', name = 'TEST SHIP' } = {}) {
  return {
    MessageType: type,
    MetaData: { MMSI: mmsi, ShipName: name, latitude: lat, longitude: lon },
    Message: { [type]: { UserID: mmsi, Latitude: lat, Longitude: lon, Sog: sog, Cog: 90, NavigationalStatus: nav } },
  };
}

function staticData(mmsi, shipType, name = 'STATIC NAME') {
  return {
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: mmsi },
    Message: { ShipStaticData: { UserID: mmsi, Type: shipType, Name: name, Destination: 'FUJAIRAH' } },
  };
}

const HORMUZ = [26.5, 56.5];
const MALACCA = [2.5, 101.5];

beforeEach(() => {
  FakeWebSocket.instances = [];
  clock = Date.parse('2026-09-29T12:00:00Z');
});

// ─── Helpers ───

describe('helpers', () => {
  it('maps AIS ship type codes to categories', () => {
    assert.equal(shipCategory(84), 'tanker');
    assert.equal(shipCategory(70), 'cargo');
    assert.equal(shipCategory(60), 'passenger');
    assert.equal(shipCategory(35), 'military');
    assert.equal(shipCategory(0), 'unknown');
    assert.equal(shipCategory(undefined), 'unknown');
    assert.equal(shipCategory(52), 'other');
  });

  it('cleans untrusted vessel text', () => {
    assert.equal(cleanText('MV EXAMPLE@@@@@'), 'MV EXAMPLE');
    assert.equal(cleanText('<img src=x>\u0007'), '<img src=x>'); // escaping is the renderer's job; control chars stripped
    assert.equal(cleanText('A'.repeat(40)).length, 20);
    assert.equal(cleanText('@@@@'), null);
    assert.equal(cleanText(42), null);
  });

  it('assigns positions to the containing chokepoint only', () => {
    assert.equal(findChokepoint(...HORMUZ), 'straitOfHormuz');
    assert.equal(findChokepoint(50.0, 0.0), null);
  });
});

// ─── Connection lifecycle ───

describe('AisCollector connection', () => {
  it('subscribes to every chokepoint box as soon as the socket opens', () => {
    const c = makeCollector();
    c.start('key-123');
    const ws = FakeWebSocket.instances[0];
    assert.equal(ws.url, 'wss://stream.aisstream.io/v0/stream');
    ws.open();
    assert.equal(ws.sent.length, 1);
    const sub = ws.sent[0];
    assert.equal(sub.APIKey, 'key-123');
    assert.equal(sub.BoundingBoxes.length, 9);
    assert.deepEqual(sub.BoundingBoxes[0], [[24.5, 54.5], [28.5, 58.5]]);
    assert.ok(sub.FilterMessageTypes.includes('PositionReport'));
    c.stop();
  });

  it('goes live on the first data message', () => {
    const c = makeCollector();
    c.start('k');
    const ws = FakeWebSocket.instances[0];
    ws.open();
    assert.equal(c.state, 'connecting');
    ws.receive(position(123456789, ...HORMUZ));
    assert.equal(c.state, 'live');
    c.stop();
  });

  it('stops on an API key error instead of reconnecting', async () => {
    const c = makeCollector();
    c.start('bad');
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive({ error: 'Api Key Is Not Valid' });
    ws.drop(1000);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(c.state, 'auth_failed');
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.match(c.getStatus().lastError, /Api Key/);
    c.stop();
  });

  it('reconnects with backoff after the connection drops', async () => {
    const c = makeCollector();
    c.start('k');
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].drop(1006);
    assert.equal(c.state, 'reconnecting');
    await new Promise(r => setTimeout(r, 40));
    assert.equal(FakeWebSocket.instances.length, 2);
    FakeWebSocket.instances[1].open();
    FakeWebSocket.instances[1].receive(position(123456789, ...HORMUZ));
    assert.equal(c.state, 'live');
    assert.equal(c.getStatus().reconnects, 1);
    c.stop();
  });

  it('reconnects a stream that has gone silent', async () => {
    const c = makeCollector({ stallMinutes: 5 });
    c.start('k');
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive(position(123456789, ...HORMUZ));
    clock += 6 * 60_000;
    c._housekeeping();
    assert.ok(ws.closed);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(FakeWebSocket.instances.length, 2);
    c.stop();
  });

  // Node's WebSocket fires error but never close when the handshake fails
  it('reconnects when the handshake fails with only an error event', async () => {
    const c = makeCollector();
    c.start('k');
    FakeWebSocket.instances[0].onerror({ message: 'Received network error or non-101 status code.' });
    assert.equal(c.state, 'reconnecting');
    assert.ok(FakeWebSocket.instances[0].closed);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(FakeWebSocket.instances.length, 2);
    assert.match(c.getStatus().lastError, /non-101/);
    c.stop();
  });

  it('gives up on a handshake that never completes', async () => {
    const c = makeCollector({ connectTimeoutMs: 10 });
    c.start('k');
    await new Promise(r => setTimeout(r, 60));
    assert.ok(FakeWebSocket.instances.length >= 2);
    assert.match(c.getStatus().lastError, /timed out/);
    c.stop();
  });

  it('reconnects only once when an open socket errors and then closes', async () => {
    const c = makeCollector();
    c.start('k');
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive(position(123456789, ...HORMUZ));
    ws.onerror({ message: 'boom' });
    ws.drop(1006);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(FakeWebSocket.instances.length, 2);
    assert.equal(c.getStatus().reconnects, 1);
    c.stop();
  });

  it('does not reconnect after stop()', async () => {
    const c = makeCollector();
    c.start('k');
    const ws = FakeWebSocket.instances[0];
    ws.open();
    c.stop();
    ws.drop(1000);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(c.state, 'stopped');
  });

  it('reports unsupported when WebSocket is unavailable', () => {
    const c = new AisCollector({ WebSocketImpl: null, logger: quiet });
    c.WebSocketImpl = undefined;
    c.start('k');
    assert.equal(c.state, 'unsupported');
  });
});

// ─── Message handling and snapshots ───

describe('AisCollector snapshots', () => {
  let c;
  let ws;
  afterEach(() => c?.stop());

  function live(extra) {
    c = makeCollector(extra);
    c.start('k');
    ws = FakeWebSocket.instances.at(-1);
    ws.open();
  }

  it('counts vessels per chokepoint by category', () => {
    live();
    ws.receive(position(111111111, ...HORMUZ));
    ws.receive(staticData(111111111, 84, 'GULF TANKER@@@'));
    ws.receive(position(222222222, 26.6, 56.4));
    ws.receive(staticData(222222222, 70));
    ws.receive(position(333333333, ...MALACCA));
    const snap = c.getSnapshot();
    assert.equal(snap.totals.vessels, 3);
    assert.equal(snap.totals.tankers, 1);
    assert.equal(snap.chokepoints.straitOfHormuz.total, 2);
    assert.equal(snap.chokepoints.straitOfHormuz.tanker, 1);
    assert.equal(snap.chokepoints.straitOfHormuz.cargo, 1);
    assert.equal(snap.chokepoints.straitOfMalacca.unknown, 1);
    const tanker = snap.vessels.find(v => v.mmsi === '111111111');
    assert.equal(tanker.name, 'GULF TANKER');
    assert.equal(tanker.cat, 'tanker');
  });

  it('ignores invalid positions, bad MMSIs, out-of-area and malformed messages', () => {
    live();
    ws.receive(position(123456789, 91, 181));         // AIS "not available"
    ws.receive(position(123456789, 0, 0));
    ws.receive(position(12345, ...HORMUZ));           // not a 9-digit MMSI
    ws.receive(position(123456789, 50.0, 0.0));       // outside every box
    ws.receive('not json');
    ws.receive({ MessageType: 'PositionReport' });
    ws.receive(staticData(987654321, 84));            // static data for an unknown vessel
    assert.equal(c.getSnapshot().totals.vessels, 0);
  });

  it('parses binary (ArrayBuffer) frames', () => {
    live();
    const bytes = new TextEncoder().encode(JSON.stringify(position(123456789, ...HORMUZ)));
    ws.onmessage({ data: bytes.buffer });
    assert.equal(c.getSnapshot().totals.vessels, 1);
  });

  it('marks anchored, moored and near-zero-speed vessels as stationary', () => {
    live();
    ws.receive(position(111111111, ...HORMUZ, { nav: 1 }));
    ws.receive(position(222222222, ...HORMUZ, { nav: 5 }));
    ws.receive(position(333333333, ...HORMUZ, { sog: 0.2 }));
    ws.receive(position(444444444, ...HORMUZ, { sog: 14 }));
    assert.equal(c.getSnapshot().chokepoints.straitOfHormuz.stationary, 3);
  });

  it('flags underway vessels that go silent as AIS gaps, not stationary ones', () => {
    live({ gapMinutes: 30 });
    ws.receive(position(111111111, ...HORMUZ, { sog: 12 }));
    ws.receive(position(222222222, ...HORMUZ, { nav: 1, sog: 0 }));
    clock += 40 * 60_000;
    ws.receive(position(333333333, ...HORMUZ));
    const snap = c.getSnapshot();
    assert.equal(snap.totals.aisGaps, 1);
    assert.equal(snap.gaps[0].mmsi, '111111111');
    assert.equal(snap.gaps[0].ageMin, 40);
    assert.ok(!snap.vessels.some(v => v.mmsi === '111111111'));
  });

  it('forgets vessels not heard from within the stale window', () => {
    live({ staleMinutes: 60 });
    ws.receive(position(111111111, ...HORMUZ));
    clock += 61 * 60_000;
    ws.receive(position(222222222, ...HORMUZ));
    const snap = c.getSnapshot();
    assert.equal(snap.totals.vessels, 1);
    assert.equal(snap.vessels[0].mmsi, '222222222');
  });

  it('caps memory by dropping the least recently seen vessels', () => {
    live({ maxVessels: 10 });
    for (let i = 0; i < 12; i++) {
      clock += 1000;
      ws.receive(position(100000000 + i, ...HORMUZ));
    }
    assert.ok(c.vessels.size <= 11);
    assert.ok(c.vessels.has('100000011'));
    assert.ok(!c.vessels.has('100000000'));
  });

  it('limits the vessel sample size and reports warm-up', () => {
    live({ sampleSize: 5, warmupMinutes: 10 });
    for (let i = 0; i < 20; i++) ws.receive(position(100000000 + i, ...HORMUZ));
    let snap = c.getSnapshot();
    assert.equal(snap.vessels.length, 5);
    assert.equal(snap.totals.vessels, 20);
    assert.equal(snap.warmingUp, true);
    clock += 11 * 60_000;
    for (let i = 0; i < 20; i++) ws.receive(position(100000000 + i, ...HORMUZ));
    snap = c.getSnapshot();
    assert.equal(snap.warmingUp, false);
    assert.equal(snap.live, true);
  });
});

// ─── Maritime source briefing() ───

describe('Maritime briefing()', () => {
  const saved = {};
  beforeEach(() => {
    saved.key = process.env.AISSTREAM_API_KEY;
    saved.disabled = process.env.AIS_DISABLED;
    delete process.env.AIS_DISABLED;
  });
  afterEach(() => {
    aisCollector.stop();
    aisCollector._resetState();
    aisCollector.vessels.clear();
    if (saved.key === undefined) delete process.env.AISSTREAM_API_KEY; else process.env.AISSTREAM_API_KEY = saved.key;
    if (saved.disabled === undefined) delete process.env.AIS_DISABLED; else process.env.AIS_DISABLED = saved.disabled;
  });

  it('returns static chokepoints without a key (unchanged behaviour)', async () => {
    delete process.env.AISSTREAM_API_KEY;
    const { briefing } = await import('../apis/sources/ships.mjs');
    const r = await briefing();
    assert.equal(r.status, 'limited');
    assert.equal(Object.keys(r.chokepoints).length, 9);
    assert.equal(r.error, undefined);
  });

  it('respects AIS_DISABLED', async () => {
    process.env.AISSTREAM_API_KEY = 'k';
    process.env.AIS_DISABLED = 'true';
    const { briefing } = await import('../apis/sources/ships.mjs');
    const r = await briefing();
    assert.equal(r.status, 'disabled');
    assert.equal(r.error, undefined);
  });

  it('reports the live snapshot from the server-managed collector', async () => {
    process.env.AISSTREAM_API_KEY = 'k';
    aisCollector.WebSocketImpl = FakeWebSocket;
    aisCollector.log = quiet;
    aisCollector.start('k');
    const ws = FakeWebSocket.instances.at(-1);
    ws.open();
    ws.receive(position(111111111, 26.5, 56.5));
    ws.receive(staticData(111111111, 80));
    const { briefing } = await import('../apis/sources/ships.mjs');
    const r = await briefing();
    assert.equal(r.mode, 'stream');
    assert.equal(r.status, 'live');
    assert.equal(r.totals.tankers, 1);
    assert.equal(r.chokepoints.straitOfHormuz.total, 1);
    assert.equal(r.error, undefined);
  });

  it('surfaces an auth failure as a source error', async () => {
    process.env.AISSTREAM_API_KEY = 'k';
    aisCollector.WebSocketImpl = FakeWebSocket;
    aisCollector.log = quiet;
    aisCollector.start('k');
    const ws = FakeWebSocket.instances.at(-1);
    ws.open();
    ws.receive({ error: 'Api Key Is Not Valid' });
    const { briefing } = await import('../apis/sources/ships.mjs');
    const r = await briefing();
    assert.equal(r.status, 'auth_failed');
    assert.match(r.error, /Api Key/);
  });
});

// ─── Delta engine ───

describe('delta engine maritime metrics', () => {
  const run = (vessels, tankers, opts = {}) => ({
    meta: { sourcesOk: 28 },
    maritime: { live: true, warmingUp: false, totals: { vessels, tankers, aisGaps: 0 }, ...opts },
  });
  const keys = delta => [...delta.signals.escalated, ...delta.signals.deescalated].map(s => s.key);

  it('flags a large drop in chokepoint tankers', () => {
    const delta = computeDelta(run(2000, 300), run(2000, 200));
    assert.ok(keys(delta).includes('tanker_total'));
  });

  it('ignores maritime metrics while warming up or not live', () => {
    const delta = computeDelta(run(2000, 300), run(0, 0, { warmingUp: true }));
    assert.ok(!keys(delta).includes('tanker_total'));
    assert.ok(!keys(delta).includes('vessel_total'));
    const delta2 = computeDelta(run(0, 0, { live: false }), run(2000, 300));
    assert.ok(!keys(delta2).includes('vessel_total'));
  });

  it('ignores runs without maritime data (existing behaviour)', () => {
    const delta = computeDelta({ meta: { sourcesOk: 28 } }, { meta: { sourcesOk: 28 } });
    assert.ok(!keys(delta).some(k => ['vessel_total', 'tanker_total', 'ais_gaps'].includes(k)));
  });
});
