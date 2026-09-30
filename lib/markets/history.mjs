// Market History Cache — backs GET /api/history for the dashboard's expanded market charts
// Intraday data goes stale fast; daily ranges can be cached longer. Concurrent requests
// for the same chart share one upstream fetch, and a failed refresh serves the stale copy.

import { fetchHistory } from '../../apis/sources/yfinance.mjs';

const INTRADAY_TTL_MS = 2 * 60 * 1000;
const DAILY_TTL_MS = 10 * 60 * 1000;

export function createHistoryCache({ fetchFn = fetchHistory, now = Date.now } = {}) {
  const entries = new Map();   // key → { data, fetchedAt }
  const inFlight = new Map();  // key → Promise

  const ttlFor = range => (range === '1d' ? INTRADAY_TTL_MS : DAILY_TTL_MS);

  async function get(symbol, range) {
    const key = `${symbol}|${range}`;
    const cached = entries.get(key);
    if (cached && now() - cached.fetchedAt < ttlFor(range)) return cached.data;
    if (inFlight.has(key)) return inFlight.get(key);

    const pending = (async () => {
      try {
        const data = await fetchFn(symbol, range);
        entries.set(key, { data, fetchedAt: now() });
        return data;
      } catch (err) {
        if (cached) return cached.data;
        throw err;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, pending);
    return pending;
  }

  return { get };
}
