// Adanos — Social Sentiment Intelligence for Stocks
// Multi-platform sentiment analysis: Reddit, X/Twitter, Polymarket
// Provides trending stocks, buzz scores, sentiment breakdowns, and sector analysis
// Free API key required: https://api.adanos.org/docs
// Updates every ~15 minutes (Reddit), ~2 hours (X/Twitter)

import { safeFetch } from '../utils/fetch.mjs';
import '../utils/env.mjs';

const BASE = 'https://api.adanos.org';

async function apiFetch(path, apiKey) {
  return safeFetch(`${BASE}${path}`, {
    timeout: 12000,
    headers: { 'X-API-Key': apiKey },
  });
}

// Fetch trending stocks from a platform
async function fetchTrending(platform, apiKey, limit = 20) {
  const data = await apiFetch(`/${platform}/stocks/v1/trending?days=7&limit=${limit}`, apiKey);
  if (data?.error) return [];
  return (Array.isArray(data) ? data : []).map(s => ({
    ticker: s.ticker,
    name: s.company_name || null,
    buzz: s.buzz_score,
    trend: s.trend,
    mentions: s.mentions,
    sentiment: s.sentiment_score,
    bullishPct: s.bullish_pct,
    bearishPct: s.bearish_pct,
    upvotes: s.total_upvotes || 0,
  }));
}

// Fetch sector-level aggregation
async function fetchSectors(apiKey) {
  const data = await apiFetch('/reddit/stocks/v1/trending/sectors?days=7', apiKey);
  if (data?.error) return [];
  return (Array.isArray(data) ? data : []).map(s => ({
    sector: s.sector,
    buzz: s.buzz_score,
    trend: s.trend,
    mentions: s.mentions,
    sentiment: s.sentiment_score,
    bullishPct: s.bullish_pct,
    bearishPct: s.bearish_pct,
    topTickers: s.top_tickers || [],
  }));
}

export async function briefing() {
  const apiKey = process.env.ADANOS_API_KEY;
  if (!apiKey) {
    return {
      source: 'Adanos',
      timestamp: new Date().toISOString(),
      status: 'no_key',
      message: 'Adanos API key required. Register free at https://api.adanos.org/docs and set ADANOS_API_KEY in .env',
    };
  }

  const [reddit, x, sectors] = await Promise.all([
    fetchTrending('reddit', apiKey),
    fetchTrending('x', apiKey),
    fetchSectors(apiKey),
  ]);

  // Compute aggregate market sentiment from Reddit (larger sample)
  const allStocks = reddit.length ? reddit : x;
  const totalMentions = allStocks.reduce((s, t) => s + t.mentions, 0);
  let avgSentiment = 0;
  let avgBullish = 0;
  let avgBearish = 0;
  if (totalMentions > 0) {
    for (const t of allStocks) {
      const w = t.mentions / totalMentions;
      avgSentiment += t.sentiment * w;
      avgBullish += t.bullishPct * w;
      avgBearish += t.bearishPct * w;
    }
  }

  const sorted = [...allStocks].sort((a, b) => b.sentiment - a.sentiment);
  const topBullish = sorted.slice(0, 5).filter(t => t.sentiment > 0);
  const topBearish = sorted.slice(-5).reverse().filter(t => t.sentiment < 0);

  // Generate signals
  const signals = [];
  if (avgBullish > 65) signals.push(`Extreme bullish consensus at ${avgBullish.toFixed(0)}% — contrarian caution`);
  if (avgBearish > 45) signals.push(`Elevated bearish sentiment at ${avgBearish.toFixed(0)}% — fear may be peaking`);

  const risingCount = allStocks.filter(t => t.trend === 'rising').length;
  const fallingCount = allStocks.filter(t => t.trend === 'falling').length;
  if (risingCount > allStocks.length * 0.6) signals.push(`Broad momentum: ${risingCount}/${allStocks.length} tickers rising`);
  if (fallingCount > allStocks.length * 0.5) signals.push(`Broad weakness: ${fallingCount}/${allStocks.length} tickers falling`);

  const hotSectors = [...sectors].sort((a, b) => b.buzz - a.buzz).slice(0, 3);
  for (const s of hotSectors) {
    if (s.buzz > 60) signals.push(`${s.sector} sector buzz elevated at ${s.buzz.toFixed(0)} — ${s.trend}`);
  }

  return {
    source: 'Adanos',
    timestamp: new Date().toISOString(),
    reddit: { trending: reddit, sectors },
    x: { trending: x },
    aggregate: {
      totalTickers: allStocks.length,
      avgSentiment: parseFloat(avgSentiment.toFixed(3)),
      bullishPct: Math.round(avgBullish),
      bearishPct: Math.round(avgBearish),
      topBullish,
      topBearish,
      hotSectors,
    },
    signals,
  };
}

if (process.argv[1]?.endsWith('adanos.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
