// Market history cache — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies, no network

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryCache } from '../lib/markets/history.mjs';

function setup() {
  let clock = 0;
  let calls = 0;
  let fail = false;
  const cache = createHistoryCache({
    now: () => clock,
    fetchFn: async (symbol, range) => {
      calls++;
      await Promise.resolve();
      if (fail) throw new Error('upstream down');
      return { symbol, range, n: calls };
    },
  });
  return {
    cache,
    advance: ms => { clock += ms; },
    calls: () => calls,
    setFail: v => { fail = v; },
  };
}

describe('market history cache', () => {
  it('serves cached data within the TTL and refetches after', async () => {
    const t = setup();
    assert.equal((await t.cache.get('^GSPC', '1mo')).n, 1);
    t.advance(9 * 60 * 1000);
    assert.equal((await t.cache.get('^GSPC', '1mo')).n, 1);
    t.advance(2 * 60 * 1000);
    assert.equal((await t.cache.get('^GSPC', '1mo')).n, 2);
  });

  it('expires intraday data sooner', async () => {
    const t = setup();
    await t.cache.get('^GSPC', '1d');
    t.advance(3 * 60 * 1000);
    await t.cache.get('^GSPC', '1d');
    assert.equal(t.calls(), 2);
  });

  it('keys by symbol and range', async () => {
    const t = setup();
    await t.cache.get('^GSPC', '1mo');
    await t.cache.get('^GSPC', '1y');
    await t.cache.get('GC=F', '1mo');
    assert.equal(t.calls(), 3);
  });

  it('shares one fetch between concurrent requests', async () => {
    const t = setup();
    const [a, b] = await Promise.all([t.cache.get('^VIX', '5d'), t.cache.get('^VIX', '5d')]);
    assert.equal(t.calls(), 1);
    assert.equal(a, b);
  });

  it('serves stale data when a refresh fails, and throws with nothing cached', async () => {
    const t = setup();
    await t.cache.get('^GSPC', '1mo');
    t.advance(60 * 60 * 1000);
    t.setFail(true);
    assert.equal((await t.cache.get('^GSPC', '1mo')).n, 1);
    await assert.rejects(() => t.cache.get('BTC-USD', '1mo'), /upstream down/);
  });
});
