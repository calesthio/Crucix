// Yahoo Finance — Live market quotes (no API key required)
// Provides real-time prices for stocks, ETFs, crypto, commodities
// Replaces the need for Alpaca or any paid market data provider

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Symbols to track — covers broad market, rates, commodities, crypto, volatility
const SYMBOLS = {
  // Indexes / ETFs
  '^GSPC': 'S&P 500',
  '^IXIC': 'Nasdaq Composite',
  '^DJI': 'Dow Jones',
  '^RUT': 'Russell 2000',
  // Rates / Credit
  TLT: '20Y+ Treasury',
  HYG: 'High Yield Corp',
  LQD: 'IG Corporate',
  // Commodities
  'GC=F': 'Gold',
  'SI=F': 'Silver',
  'CL=F': 'WTI Crude',
  'BZ=F': 'Brent Crude',
  'NG=F': 'Natural Gas',
  // Crypto
  'BTC-USD': 'Bitcoin',
  'ETH-USD': 'Ethereum',
  // Volatility
  '^VIX': 'VIX',
};

// Every symbol the dashboard shows — also the allowlist for on-demand history
export const MARKET_SYMBOLS = Object.keys(SYMBOLS);

// History ranges offered by the dashboard chart → Yahoo range/interval
export const HISTORY_RANGES = {
  '1d':  { range: '1d',  interval: '5m' },
  '5d':  { range: '5d',  interval: '30m' },
  '1mo': { range: '1mo', interval: '1d' },
  '6mo': { range: '6mo', interval: '1d' },
  '1y':  { range: '1y',  interval: '1d' },
};

async function fetchChart(symbol, range, interval) {
  const url = `${BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const data = await safeFetch(url, {
    timeout: 8000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  if (data?.error) throw new Error(data.error);
  return data?.chart?.result?.[0] || null;
}

// Chart result → [{ t: epochMs, close }], skipping gaps
export function parseChartPoints(result) {
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const timestamps = result?.timestamp || [];
  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null) points.push({ t: timestamps[i] * 1000, close: Math.round(closes[i] * 100) / 100 });
  }
  return points;
}

/**
 * On-demand price history for one dashboard symbol.
 * @param {string} symbol - must be in MARKET_SYMBOLS
 * @param {string} rangeKey - must be a HISTORY_RANGES key
 */
export async function fetchHistory(symbol, rangeKey) {
  if (!MARKET_SYMBOLS.includes(symbol)) throw new Error(`Unknown symbol: ${symbol}`);
  const spec = HISTORY_RANGES[rangeKey];
  if (!spec) throw new Error(`Unknown range: ${rangeKey}`);

  const result = await fetchChart(symbol, spec.range, spec.interval);
  if (!result) throw new Error(`No chart data for ${symbol}`);

  const points = parseChartPoints(result);
  const closes = points.map(p => p.close);
  const first = closes[0] ?? null;
  const last = closes[closes.length - 1] ?? null;
  return {
    symbol,
    name: SYMBOLS[symbol],
    range: rangeKey,
    currency: result.meta?.currency || 'USD',
    points,
    first,
    last,
    high: closes.length ? Math.max(...closes) : null,
    low: closes.length ? Math.min(...closes) : null,
    changePct: first ? Math.round(((last - first) / first) * 10000) / 100 : null,
  };
}

async function fetchQuote(symbol) {
  try {
    const result = await fetchChart(symbol, '5d', '1d');
    if (!result) return null;

    const meta = result.meta || {};
    const quotes = result.indicators?.quote?.[0] || {};
    const closes = quotes.close || [];

    // Get current price and previous close
    const price = meta.regularMarketPrice ?? closes[closes.length - 1];
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? closes[closes.length - 2];
    const change = price && prevClose ? price - prevClose : 0;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    // Build 5-day history
    const history = parseChartPoints(result).map(p => ({
      date: new Date(p.t).toISOString().split('T')[0],
      close: p.close,
    }));

    return {
      symbol,
      name: SYMBOLS[symbol] || meta.shortName || symbol,
      price: Math.round(price * 100) / 100,
      prevClose: Math.round((prevClose || 0) * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      currency: meta.currency || 'USD',
      exchange: meta.exchangeName || '',
      marketState: meta.marketState || 'UNKNOWN',
      history,
    };
  } catch (e) {
    return { symbol, name: SYMBOLS[symbol] || symbol, error: e.message };
  }
}

export async function briefing() {
  return collect();
}

export async function collect() {
  const symbols = Object.keys(SYMBOLS);
  const results = await Promise.allSettled(
    symbols.map(s => fetchQuote(s))
  );

  const quotes = {};
  let ok = 0;
  let failed = 0;

  for (const r of results) {
    const q = r.status === 'fulfilled' ? r.value : null;
    if (q && !q.error) {
      quotes[q.symbol] = q;
      ok++;
    } else {
      failed++;
      const sym = q?.symbol || 'unknown';
      quotes[sym] = q || { symbol: sym, error: 'fetch failed' };
    }
  }

  // Categorize for easy dashboard consumption
  return {
    quotes,
    summary: {
      totalSymbols: symbols.length,
      ok,
      failed,
      timestamp: new Date().toISOString(),
    },
    indexes: pickGroup(quotes, ['^GSPC', '^IXIC', '^DJI', '^RUT']),
    rates: pickGroup(quotes, ['TLT', 'HYG', 'LQD']),
    commodities: pickGroup(quotes, ['GC=F', 'SI=F', 'CL=F', 'BZ=F', 'NG=F']),
    crypto: pickGroup(quotes, ['BTC-USD', 'ETH-USD']),
    volatility: pickGroup(quotes, ['^VIX']),
  };
}

function pickGroup(quotes, symbols) {
  return symbols.map(s => quotes[s]).filter(Boolean);
}
