import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const modulePath = new URL('../apis/sources/opensky.mjs', import.meta.url);

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

test('opensky briefing prunes expired cache artifacts and records maintenance telemetry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'opensky-maint-'));
  const runs = join(root, 'runs');
  const cacheDir = join(runs, 'cache');
  mkdirSync(cacheDir, { recursive: true });

  writeJson(join(cacheDir, 'opensky-state.json'), {
    cursor: 2,
    cooldownUntil: null,
    last429At: null,
    cacheHits: 0,
    staleCachePrunes: 0,
  });
  writeJson(join(cacheDir, 'opensky-latest.json'), {
    source: 'OpenSky',
    timestamp: '2026-04-24T10:00:00.000Z',
    hotspots: [{ key: 'caribbean', region: 'Caribbean', totalAircraft: 12 }],
  });

  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  Date.now = () => new Date('2026-04-24T19:30:00.000Z').getTime();
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => 'stubbed' });
  process.env.OPENSKY_ROOT_OVERRIDE = root;

  const mod = await import(`${modulePath.href}?test=${Math.random()}`);
  const result = await mod.briefing();

  Date.now = originalNow;
  globalThis.fetch = originalFetch;
  delete process.env.OPENSKY_ROOT_OVERRIDE;

  const state = JSON.parse(readFileSync(join(cacheDir, 'opensky-state.json'), 'utf8'));
  assert.equal(existsSync(join(cacheDir, 'opensky-latest.json')), false);
  assert.equal(state.staleCachePrunes, 1);
  assert.ok(state.lastStaleCachePrunedAt);
  assert.equal(result.runtimeState.staleCachePrunes, 1);
});

test('opensky briefing increments cache-hit telemetry when serving cooldown cache', async () => {
  const root = mkdtempSync(join(tmpdir(), 'opensky-cache-hit-'));
  const runs = join(root, 'runs');
  const cacheDir = join(runs, 'cache');
  mkdirSync(cacheDir, { recursive: true });

  writeJson(join(cacheDir, 'opensky-state.json'), {
    cursor: 0,
    cooldownUntil: '2026-04-24T20:00:00.000Z',
    last429At: '2026-04-24T19:00:00.000Z',
    cacheHits: 2,
    staleCachePrunes: 1,
  });
  writeJson(join(cacheDir, 'opensky-latest.json'), {
    source: 'OpenSky',
    timestamp: '2026-04-24T19:10:00.000Z',
    hotspots: [{ key: 'caribbean', region: 'Caribbean', totalAircraft: 12 }],
  });

  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  Date.now = () => new Date('2026-04-24T19:30:00.000Z').getTime();
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => 'stubbed' });
  process.env.OPENSKY_ROOT_OVERRIDE = root;

  const mod = await import(`${modulePath.href}?test=${Math.random()}`);
  const result = await mod.briefing();

  Date.now = originalNow;
  globalThis.fetch = originalFetch;
  delete process.env.OPENSKY_ROOT_OVERRIDE;

  const state = JSON.parse(readFileSync(join(cacheDir, 'opensky-state.json'), 'utf8'));
  assert.equal(result.servedFromCache, true);
  assert.equal(state.cacheHits, 3);
  assert.equal(result.runtimeState.cacheHits, 3);
  assert.ok(result.runtimeState.lastCacheHitAt);
});
