// Yahoo Finance history + quote parsing — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies, no network

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchHistory, parseChartPoints, collect, HISTORY_RANGES, MARKET_SYMBOLS } from '../apis/sources/yfinance.mjs';

const realFetch = globalThis.fetch;
let requested;

function chart({ timestamps, closes, currency = 'USD', price = 105, prevClose = 100 }) {
  return {
    chart: {
      result: [{
        meta: { currency, regularMarketPrice: price, chartPreviousClose: prevClose },
        timestamp: timestamps,
        indicators: { quote: [{ close: closes }] },
      }],
    },
  };
}

function installFetch(body, status = 200) {
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
}

describe('Yahoo Finance history', () => {
  beforeEach(() => { requested = []; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('rejects symbols and ranges outside the allowlist', async () => {
    installFetch(chart({ timestamps: [], closes: [] }));
    await assert.rejects(() => fetchHistory('AAPL', '1mo'), /Unknown symbol/);
    await assert.rejects(() => fetchHistory('^GSPC', '10y'), /Unknown range/);
    assert.equal(requested.length, 0);
  });

  it('maps each range to Yahoo range/interval and encodes the symbol', async () => {
    installFetch(chart({ timestamps: [1, 2], closes: [1, 2] }));
    for (const [key, spec] of Object.entries(HISTORY_RANGES)) {
      await fetchHistory('^GSPC', key);
      const url = requested.at(-1);
      assert.ok(url.includes('/%5EGSPC?'), url);
      assert.ok(url.includes(`range=${spec.range}&interval=${spec.interval}`), url);
    }
    await fetchHistory('GC=F', '1mo');
    assert.ok(requested.at(-1).includes('/GC%3DF?'));
  });

  it('skips null closes and summarises the range', async () => {
    installFetch(chart({ timestamps: [100, 200, 300, 400], closes: [100, null, 90.123, 110], currency: 'USD' }));
    const h = await fetchHistory('^GSPC', '1mo');
    assert.deepEqual(h.points, [{ t: 100000, close: 100 }, { t: 300000, close: 90.12 }, { t: 400000, close: 110 }]);
    assert.equal(h.first, 100);
    assert.equal(h.last, 110);
    assert.equal(h.high, 110);
    assert.equal(h.low, 90.12);
    assert.equal(h.changePct, 10);
    assert.equal(h.name, 'S&P 500');
  });

  it('throws when upstream fails', async () => {
    installFetch('nope', 500);
    await assert.rejects(() => fetchHistory('^VIX', '1d'), /HTTP 500/);
  });

  it('parseChartPoints tolerates missing data', () => {
    assert.deepEqual(parseChartPoints(null), []);
    assert.deepEqual(parseChartPoints({ timestamp: [1] }), []);
  });

  it('keeps the sweep quote shape', async () => {
    installFetch(chart({ timestamps: [86400, 172800], closes: [100, 105] }));
    const data = await collect();
    const q = data.quotes['^GSPC'];
    assert.equal(q.price, 105);
    assert.equal(q.changePct, 5);
    assert.deepEqual(q.history, [{ date: '1970-01-02', close: 100 }, { date: '1970-01-03', close: 105 }]);
    assert.equal(data.summary.ok, MARKET_SYMBOLS.length);
  });
});
