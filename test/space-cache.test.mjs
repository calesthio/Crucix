// Space/CelesTrak cache — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies, no network

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getTLEs, briefing } from '../apis/sources/space.mjs';

const realFetch = globalThis.fetch;
let dir;
let calls;
let respond;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crucix-celestrak-'));
  process.env.CELESTRAK_CACHE_DIR = dir;
  calls = 0;
  respond = () => new Response(JSON.stringify([{ OBJECT_NAME: 'SAT-1', NORAD_CAT_ID: 1 }]), { status: 200 });
  globalThis.fetch = async () => { calls++; return respond(); };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.CELESTRAK_CACHE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function seedCache(category, data, ageMs) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${category}.json`), JSON.stringify({ fetchedAt: Date.now() - ageMs, data }));
}

describe('CelesTrak cache', () => {
  it('downloads once, then serves from cache within 2 hours', async () => {
    assert.equal((await getTLEs('stations')).length, 1);
    assert.equal((await getTLEs('stations')).length, 1);
    assert.equal(calls, 1);
    const saved = JSON.parse(readFileSync(join(dir, 'stations.json'), 'utf8'));
    assert.equal(saved.data[0].OBJECT_NAME, 'SAT-1');
  });

  it('refreshes once the cache is older than 2 hours', async () => {
    seedCache('military', [{ OBJECT_NAME: 'OLD' }], 3 * 60 * 60 * 1000);
    const data = await getTLEs('military');
    assert.equal(calls, 1);
    assert.equal(data[0].OBJECT_NAME, 'SAT-1');
  });

  it('serves stale data when CelesTrak refuses, without retrying', async () => {
    seedCache('stations', [{ OBJECT_NAME: 'ISS (ZARYA)', NORAD_CAT_ID: 25544 }], 3 * 60 * 60 * 1000);
    respond = () => new Response('GP data has not updated since your last successful download', { status: 200 });
    const data = await getTLEs('stations');
    assert.equal(calls, 1);
    assert.equal(data[0].OBJECT_NAME, 'ISS (ZARYA)');
  });

  it('reports the CelesTrak notice when there is nothing cached', async () => {
    respond = () => new Response('Access denied: too many requests', { status: 200 });
    const data = await getTLEs('oneweb');
    assert.match(data.error, /CelesTrak: Access denied/);
  });

  it('marks the briefing stale when any group came from stale cache', async () => {
    for (const g of ['stations', 'lastDay', 'military', 'starlink', 'oneweb']) seedCache(g, [], 3 * 60 * 60 * 1000);
    respond = () => new Response('refused', { status: 200 });
    const result = await briefing();
    assert.equal(result.stale, true);
    assert.ok(result.staleGroups.includes('stations'));
  });
});
