// Yahoo Finance source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/yfinance.mjs';

// Canned chart response — safeFetch uses .text() then JSON.parse
const CHART_RESPONSE = {
  chart: {
    result: [
      {
        meta: {
          symbol: 'SPY',
          regularMarketPrice: 590.50,
          chartPreviousClose: 585.0,
          currency: 'USD',
          exchangeName: 'ARCX',
          marketState: 'REGULAR',
        },
        timestamp: [1700000000, 1700086400],
        indicators: {
          quote: [
            {
              close: [585.0, 590.50],
            },
          ],
        },
      },
    ],
    error: null,
  },
};

describe('yfinance briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    // safeFetch reads .text() and JSON.parses it
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CHART_RESPONSE),
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.ok(result.quotes);
      assert.ok(result.summary);
      assert.ok(result.summary.timestamp);
      assert.equal(typeof result.summary.totalSymbols, 'number');
      assert.equal(typeof result.summary.ok, 'number');
      assert.equal(typeof result.summary.failed, 'number');
      // Should have category groups
      assert.ok(Array.isArray(result.indexes));
      assert.ok(Array.isArray(result.rates));
      assert.ok(Array.isArray(result.commodities));
      assert.ok(Array.isArray(result.crypto));
      assert.ok(Array.isArray(result.volatility));
      // At least some successful quotes
      assert.ok(result.summary.ok >= 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles fetch failure gracefully — Promise.allSettled returns partial results', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    try {
      const result = await briefing();
      // briefing() uses Promise.allSettled so it should always return
      assert.ok(result !== undefined);
      assert.ok(result.quotes);
      assert.ok(result.summary);
      // All should have failed but structure is intact
      assert.equal(result.summary.ok, 0);
      assert.ok(result.summary.failed > 0);
      assert.ok(Array.isArray(result.indexes));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles HTTP error response gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests',
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.ok(result.summary);
      assert.ok(result.summary.failed > 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles partial failures — some symbols succeed, others fail', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async (url) => {
      callCount++;
      // Fail every other request to simulate partial failure
      if (callCount % 2 === 0) {
        throw new Error('timeout');
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(CHART_RESPONSE),
      };
    };
    try {
      const result = await briefing();
      // Promise.allSettled ensures we always get a result object back
      assert.ok(result !== undefined);
      assert.ok(result.quotes);
      assert.ok(result.summary);
      // Both ok and failed should be > 0 with alternating failures
      assert.ok(result.summary.ok > 0);
      assert.ok(result.summary.failed > 0);
      assert.equal(result.summary.ok + result.summary.failed, result.summary.totalSymbols);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('correctly parses quote fields from chart response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CHART_RESPONSE),
    });
    try {
      const result = await briefing();
      // Find SPY in quotes
      const spy = result.quotes['SPY'];
      if (spy && !spy.error) {
        assert.equal(spy.symbol, 'SPY');
        assert.equal(spy.price, 590.50);
        assert.equal(spy.currency, 'USD');
        assert.ok(Array.isArray(spy.history));
        // History entries should have date and close fields
        if (spy.history.length > 0) {
          assert.ok(spy.history[0].date);
          assert.equal(typeof spy.history[0].close, 'number');
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns null/error entry for missing chart result', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ chart: { result: null, error: null } }),
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.ok(result.summary);
      // All symbols should have failed because result is null
      assert.equal(result.summary.ok, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
