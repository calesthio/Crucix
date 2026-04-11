import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

import { briefing, collect } from '../apis/sources/yfinance.mjs';

before(() => saveFetch());
after(() => restoreFetch());

function makeChartResponse(symbol, price = 100, prevClose = 98) {
  return {
    chart: {
      result: [{
        meta: {
          regularMarketPrice: price,
          chartPreviousClose: prevClose,
          currency: 'USD',
          exchangeName: 'NYSE',
          marketState: 'REGULAR',
          shortName: symbol,
        },
        timestamp: [1711900000, 1712000000, 1712100000],
        indicators: {
          quote: [{
            close: [97, 98, price],
          }],
        },
      }],
    },
  };
}

describe('yfinance - collect', () => {
  it('returns quotes for all symbols', async () => {
    // Mock fetch to return valid chart data for any symbol
    globalThis.fetch = async (url) => {
      const symbol = decodeURIComponent(url.split('/chart/')[1]?.split('?')[0] || 'TEST');
      const body = makeChartResponse(symbol, 150, 145);
      return {
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body),
      };
    };

    const result = await collect();
    assert.ok(result.quotes);
    assert.ok(result.summary);
    assert.equal(result.summary.totalSymbols, 15); // 15 symbols defined
    assert.equal(result.summary.ok, 15);
    assert.equal(result.summary.failed, 0);
    assert.ok(result.summary.timestamp);

    // Check categorized groups
    assert.ok(Array.isArray(result.indexes));
    assert.ok(Array.isArray(result.rates));
    assert.ok(Array.isArray(result.commodities));
    assert.ok(Array.isArray(result.crypto));
    assert.ok(Array.isArray(result.volatility));
  });

  it('calculates price change correctly', async () => {
    globalThis.fetch = async () => {
      const body = makeChartResponse('SPY', 450, 440);
      return {
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body),
      };
    };

    const result = await collect();
    const spx = result.quotes['^GSPC'];
    assert.equal(spx.price, 450);
    assert.equal(spx.prevClose, 440);
    assert.equal(spx.change, 10);
    assert.equal(spx.changePct, 2.27); // (10/440)*100 rounded
  });

  it('builds 5-day history', async () => {
    globalThis.fetch = async () => {
      const body = makeChartResponse('TEST', 100, 95);
      return {
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body),
      };
    };

    const result = await collect();
    const quote = Object.values(result.quotes).find(q => !q.error);
    assert.ok(quote);
    assert.ok(Array.isArray(quote.history));
    assert.ok(quote.history.length > 0);
    assert.ok(quote.history[0].date);
    assert.ok(typeof quote.history[0].close === 'number');
  });

  it('handles failed fetches gracefully', async () => {
    mockFetchError('Network timeout');
    const result = await collect();
    assert.equal(result.summary.ok, 0);
    assert.equal(result.summary.failed, 15);
  });

  it('handles null chart result', async () => {
    mockFetch({ chart: { result: null } });
    const result = await collect();
    assert.equal(result.summary.failed, 15);
  });

  it('handles empty chart result array', async () => {
    mockFetch({ chart: { result: [] } });
    const result = await collect();
    assert.equal(result.summary.failed, 15);
  });
});

describe('yfinance - briefing', () => {
  it('is an alias for collect', async () => {
    mockFetch(makeChartResponse('TEST', 100, 95));
    const result = await briefing();
    assert.ok(result.quotes);
    assert.ok(result.summary);
  });
});
