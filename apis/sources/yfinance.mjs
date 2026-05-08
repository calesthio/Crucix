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

function round2(n) {
  return Math.round(n * 100) / 100;
}

function addFlag(quote, flag) {
  if (!quote?.validation) return;
  if (!quote.validation.flags.includes(flag)) quote.validation.flags.push(flag);
}

function downgradeFromFlags(quote) {
  if (!quote?.validation) return;
  if (quote.validation.flags.length >= 2) {
    quote.validation.confidence = 'low';
    quote.effectivePrice = quote.prevClose;
  } else if (quote.validation.flags.length === 1) {
    quote.validation.confidence = 'medium';
  }
}

function annotateMarketValidation(quotes) {
  for (const quote of Object.values(quotes)) {
    if (!quote || quote.error) continue;
    quote.validation = { confidence: 'high', flags: [] };
    quote.effectivePrice = quote.price;

    if (Math.abs(quote.changePct || 0) >= 8) {
      addFlag(quote, `Large single-sweep move of ${round2(quote.changePct)}% requires corroboration`);
    }

    const history = quote.history || [];
    if (history.length >= 2) {
      const closes = history.map(h => h.close).filter(v => v != null);
      const priorClose = closes[closes.length - 2];
      const latestClose = closes[closes.length - 1];
      if (priorClose && latestClose) {
        const histPct = round2(((latestClose - priorClose) / Math.abs(priorClose)) * 100);
        if (Math.abs((quote.changePct || 0) - histPct) >= 3) {
          addFlag(quote, `Live move ${round2(quote.changePct)}% diverges from session history move ${histPct}%`);
        }
      }
    }
  }

  const brent = quotes['BZ=F'];
  const wti = quotes['CL=F'];
  const natgas = quotes['NG=F'];
  const gold = quotes['GC=F'];
  const silver = quotes['SI=F'];
  const vix = quotes['^VIX'];
  const spx = quotes['^GSPC'];
  const nasdaq = quotes['^IXIC'];
  const tlt = quotes.TLT;
  const hyg = quotes.HYG;

  if (brent && wti && !brent.error && !wti.error) {
    const spreadNow = brent.price - wti.price;
    const spreadPrev = brent.prevClose - wti.prevClose;
    const spreadShift = spreadNow - spreadPrev;
    const moveDivergence = Math.abs((brent.changePct || 0) - (wti.changePct || 0));
    const oppositeDirection = Math.sign(brent.change || 0) !== Math.sign(wti.change || 0);

    if (Math.abs(brent.changePct || 0) >= 3 && moveDivergence >= 3 && Math.abs(spreadShift) >= 4) {
      addFlag(brent, `Brent move diverges from WTI by ${round2(moveDivergence)} pct points and shifted the spread by $${round2(Math.abs(spreadShift))}`);
    }

    if (Math.abs(brent.changePct || 0) >= 5 && oppositeDirection && Math.abs(wti.changePct || 0) <= 1.5) {
      addFlag(brent, `Brent moved ${round2(brent.changePct)}% while WTI moved ${round2(wti.changePct)}% in the opposite direction`);
    }
  }

  if (natgas && wti && !natgas.error && !wti.error) {
    const energyDivergence = Math.abs((natgas.changePct || 0) - (wti.changePct || 0));
    if (Math.abs(natgas.changePct || 0) >= 6 && energyDivergence >= 5) {
      addFlag(natgas, `NatGas moved ${round2(natgas.changePct)}% without confirmation from crude (${round2(wti.changePct)}%)`);
    }
  }

  if (gold && spx && !gold.error && !spx.error) {
    if (Math.abs(gold.changePct || 0) >= 3.5 && Math.abs(spx.changePct || 0) <= 0.5 && !vix) {
      addFlag(gold, `Gold moved ${round2(gold.changePct)}% while equities were flat and no live VIX confirmation is available`);
    }
  }

  if (silver && gold && !silver.error && !gold.error) {
    const metalDivergence = Math.abs((silver.changePct || 0) - (gold.changePct || 0));
    if (Math.abs(silver.changePct || 0) >= 5 && metalDivergence >= 4) {
      addFlag(silver, `Silver move diverges from gold by ${round2(metalDivergence)} pct points`);
    }
  }

  if (vix && spx && nasdaq && !vix.error && !spx.error && !nasdaq.error) {
    const equityAvg = ((spx.changePct || 0) + (nasdaq.changePct || 0)) / 2;
    if (Math.abs(vix.changePct || 0) >= 15 && Math.abs(equityAvg) <= 0.75) {
      addFlag(vix, `VIX moved ${round2(vix.changePct)}% while major equity indexes moved only ${round2(equityAvg)}% on average`);
    }
    if (Math.sign(vix.change || 0) === Math.sign(equityAvg) && Math.abs(vix.changePct || 0) >= 10 && Math.abs(equityAvg) >= 0.75) {
      addFlag(vix, `VIX moved in the same direction as equities, which is atypical for a move of this size`);
    }
  }

  if (tlt && hyg && !tlt.error && !hyg.error) {
    if (Math.abs(tlt.changePct || 0) >= 2.5 && Math.sign(tlt.change || 0) === Math.sign(hyg.change || 0) && Math.abs(hyg.changePct || 0) >= 1) {
      addFlag(tlt, `TLT and HYG moved together despite a large duration move`);
      addFlag(hyg, `HYG moved with TLT despite a large duration move`);
    }
  }

  for (const quote of [brent, wti, natgas, gold, silver, vix, tlt, hyg]) {
    downgradeFromFlags(quote);
  }
}

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
    // Yahoo's chartPreviousClose can refer to the close before the requested range,
    // which makes intraday deltas wrong for 5d windows. Prefer the most recent
    // completed close from the returned series, then fall back to metadata.
    const validCloses = closes.filter(v => v != null);
    const price = meta.regularMarketPrice ?? validCloses[validCloses.length - 1];
    const inferredPrevClose = validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null;
    const prevClose = inferredPrevClose ?? meta.previousClose ?? meta.chartPreviousClose ?? 0;
    const change = price && prevClose ? price - prevClose : 0;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    // Build 5-day history
    const history = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        history.push({
          date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
          close: round2(closes[i]),
        });
      }
    }

    return {
      symbol,
      name: SYMBOLS[symbol] || meta.shortName || symbol,
      price: round2(price),
      prevClose: round2(prevClose || 0),
      change: round2(change),
      changePct: round2(changePct),
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

  annotateMarketValidation(quotes);

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
