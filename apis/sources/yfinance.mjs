// Yahoo Finance — Live market quotes (no API key required)
// UK-centric view: FTSE indices, sterling, UK gilts, Brent crude, NBP gas
// Provides real-time prices for stocks, ETFs, crypto, commodities

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Symbols to track — UK/European focus with global commodities and crypto
const SYMBOLS = {
  // UK Indexes / ETFs
  '^FTSE':     'FTSE 100',
  '^MCX':      'FTSE 250',
  'ISF.L':     'iShares FTSE 100 ETF',
  // Sterling FX
  'GBPUSD=X':  'GBP/USD',
  'EURGBP=X':  'EUR/GBP',
  'GBPJPY=X':  'GBP/JPY',
  // UK Gilts / Fixed Income
  'IGLT.L':    'iShares Core UK Gilts ETF',
  'SLXX.L':    'iShares Core £ Corp Bond ETF',
  // European / Global Context
  '^STOXX50E': 'Euro Stoxx 50',
  '^GDAXI':    'DAX (Germany)',
  'SPY':       'S&P 500 (US reference)',
  // Commodities (global — Brent is UK/EU benchmark)
  'GC=F':      'Gold',
  'SI=F':      'Silver',
  'BZ=F':      'Brent Crude',       // UK/European oil benchmark
  'CL=F':      'WTI Crude',         // US benchmark (for spread)
  'NG=F':      'Natural Gas (Henry Hub)',
  // Crypto
  'BTC-USD':   'Bitcoin',
  'ETH-USD':   'Ethereum',
  // Volatility
  '^VIX':      'VIX (US Fear Index)',
  '^VFTSE':    'VFTSE (UK Volatility)',
};

async function fetchQuote(symbol) {
  try {
    const url = `${BASE}/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
    const data = await safeFetch(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const quotes = result.indicators?.quote?.[0] || {};
    const closes = quotes.close || [];
    const timestamps = result.timestamp || [];

    // Get current price and previous close
    const price = meta.regularMarketPrice ?? closes[closes.length - 1];
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? closes[closes.length - 2];
    const change = price && prevClose ? price - prevClose : 0;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    // Build 5-day history
    const history = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        history.push({
          date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
          close: Math.round(closes[i] * 100) / 100,
        });
      }
    }

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

  // Categorize for easy dashboard consumption — UK-centric groupings
  return {
    quotes,
    summary: {
      totalSymbols: symbols.length,
      ok,
      failed,
      timestamp: new Date().toISOString(),
    },
    ukIndexes: pickGroup(quotes, ['^FTSE', '^MCX', 'ISF.L']),
    sterling: pickGroup(quotes, ['GBPUSD=X', 'EURGBP=X', 'GBPJPY=X']),
    ukFixedIncome: pickGroup(quotes, ['IGLT.L', 'SLXX.L']),
    european: pickGroup(quotes, ['^STOXX50E', '^GDAXI']),
    usReference: pickGroup(quotes, ['SPY']),
    commodities: pickGroup(quotes, ['GC=F', 'SI=F', 'BZ=F', 'CL=F', 'NG=F']),
    crypto: pickGroup(quotes, ['BTC-USD', 'ETH-USD']),
    volatility: pickGroup(quotes, ['^VIX', '^VFTSE']),
    brentWtiSpread: (() => {
      const brent = quotes['BZ=F'];
      const wti = quotes['CL=F'];
      if (brent?.price && wti?.price) {
        return { spread: Math.round((brent.price - wti.price) * 100) / 100, note: 'Brent premium over WTI ($/bbl)' };
      }
      return null;
    })(),
  };
}

function pickGroup(quotes, symbols) {
  return symbols.map(s => quotes[s]).filter(Boolean);
}
