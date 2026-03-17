// Delta Engine v2 — compares two synthesized sweep results and produces structured changes
// Improvements: count metric thresholds, semantic TG dedup, configurable thresholds, null-safety

import { createHash } from 'crypto';

// ─── Default Thresholds ──────────────────────────────────────────────────────
// Override via config.delta.thresholds in crucix.config.mjs

const DEFAULT_NUMERIC_THRESHOLDS = {
  vix: 5,            // % change to flag
  hy_spread: 5,
  '10y2y': 10,
  wti: 3,
  brent: 3,
  natgas: 5,
  unemployment: 2,
  fed_funds: 1,
  '10y_yield': 3,
  usd_index: 1,
  mortgage: 2,
  social_sentiment: 15,    // % swing in aggregate social sentiment
};

const DEFAULT_COUNT_THRESHOLDS = {
  urgent_posts: 2,         // need ±2 to matter (was 0 — any change)
  thermal_total: 500,      // ±500 detections (was 0 — +1 was noise)
  air_total: 50,           // ±50 aircraft
  who_alerts: 1,           // any new WHO alert matters
  conflict_events: 5,      // ±5 ACLED events
  conflict_fatalities: 10,  // ±10 fatalities
  sdr_online: 3,           // ±3 receivers
  news_count: 5,           // ±5 news items
  sources_ok: 1,           // any source going down matters
  sentiment_trending: 3,   // ±3 trending tickers
};

// ─── Metric Definitions ──────────────────────────────────────────────────────

const NUMERIC_METRICS = [
  { key: 'vix', extract: d => d.fred?.find(f => f.id === 'VIXCLS')?.value, label: 'VIX' },
  { key: 'hy_spread', extract: d => d.fred?.find(f => f.id === 'BAMLH0A0HYM2')?.value, label: 'HY Spread' },
  { key: '10y2y', extract: d => d.fred?.find(f => f.id === 'T10Y2Y')?.value, label: '10Y-2Y Spread' },
  { key: 'wti', extract: d => d.energy?.wti, label: 'WTI Crude' },
  { key: 'brent', extract: d => d.energy?.brent, label: 'Brent Crude' },
  { key: 'natgas', extract: d => d.energy?.natgas, label: 'Natural Gas' },
  { key: 'unemployment', extract: d => d.bls?.find(b => b.id === 'LNS14000000' || b.id === 'UNRATE')?.value, label: 'Unemployment' },
  { key: 'fed_funds', extract: d => d.fred?.find(f => f.id === 'DFF')?.value, label: 'Fed Funds Rate' },
  { key: '10y_yield', extract: d => d.fred?.find(f => f.id === 'DGS10')?.value, label: '10Y Yield' },
  { key: 'usd_index', extract: d => d.fred?.find(f => f.id === 'DTWEXBGS')?.value, label: 'USD Index' },
  { key: 'mortgage', extract: d => d.fred?.find(f => f.id === 'MORTGAGE30US')?.value, label: '30Y Mortgage' },
  { key: 'social_sentiment', extract: d => d.sentiment?.aggregate?.avgSentiment, label: 'Social Sentiment (Avg)' },
];

const COUNT_METRICS = [
  { key: 'urgent_posts', extract: d => d.tg?.urgent?.length || 0, label: 'Urgent OSINT Posts' },
  { key: 'thermal_total', extract: d => d.thermal?.reduce((s, t) => s + t.det, 0) || 0, label: 'Thermal Detections' },
  { key: 'air_total', extract: d => d.air?.reduce((s, a) => s + a.total, 0) || 0, label: 'Air Activity' },
  { key: 'who_alerts', extract: d => d.who?.length || 0, label: 'WHO Alerts' },
  { key: 'conflict_events', extract: d => d.acled?.totalEvents || 0, label: 'Conflict Events' },
  { key: 'conflict_fatalities', extract: d => d.acled?.totalFatalities || 0, label: 'Conflict Fatalities' },
  { key: 'sdr_online', extract: d => d.sdr?.online || 0, label: 'SDR Receivers' },
  { key: 'news_count', extract: d => (d.news?.length ?? d.news?.count) || 0, label: 'News Items' },
  { key: 'sources_ok', extract: d => d.meta?.sourcesOk || 0, label: 'Sources OK' },
  { key: 'sentiment_trending', extract: d => d.sentiment?.trending?.length || 0, label: 'Trending Tickers (Sentiment)' },
];

// Risk-sensitive keys: used for determining overall direction
const RISK_KEYS = ['vix', 'hy_spread', 'urgent_posts', 'conflict_events', 'thermal_total'];

// ─── Semantic Hashing for Telegram Posts ─────────────────────────────────────

/**
 * Produce a normalized hash of a post's content.
 * Strips timestamps, normalizes numbers, lowercases — so "BREAKING: 5 missiles at 14:32"
 * and "Breaking: 7 missiles at 15:01" produce the same hash (both are "missile strike" signals).
 */
function contentHash(text) {
  if (!text) return '';
  const normalized = text
    .toLowerCase()
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, '')       // strip times
    .replace(/\d+/g, 'N')                           // normalize all numbers
    .replace(/[^\w\s]/g, '')                         // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
  return createHash('sha256').update(normalized).digest('hex').substring(0, 12);
}

// ─── Core Delta Computation ──────────────────────────────────────────────────

/**
 * @param {object} current - current sweep's synthesized data
 * @param {object|null} previous - previous sweep's synthesized data (null on first run)
 * @param {object} [thresholdOverrides] - optional: { numeric: {...}, count: {...} }
 */
export function computeDelta(current, previous, thresholdOverrides = {}) {
  if (!previous) return null;
  if (!current) return null;

  const numThresholds = { ...DEFAULT_NUMERIC_THRESHOLDS, ...(thresholdOverrides.numeric || {}) };
  const cntThresholds = { ...DEFAULT_COUNT_THRESHOLDS, ...(thresholdOverrides.count || {}) };

  const signals = { new: [], escalated: [], deescalated: [], unchanged: [] };
  let criticalChanges = 0;

  // ─── Numeric metrics: track % change ─────────────────────────────────

  for (const m of NUMERIC_METRICS) {
    const curr = m.extract(current);
    const prev = m.extract(previous);
    if (curr == null || prev == null) continue;

    const threshold = numThresholds[m.key] ?? 5;
    const pctChange = prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : 0;

    if (Math.abs(pctChange) > threshold) {
      const entry = {
        key: m.key, label: m.label, from: prev, to: curr,
        pctChange: parseFloat(pctChange.toFixed(2)),
        direction: pctChange > 0 ? 'up' : 'down',
        severity: Math.abs(pctChange) > threshold * 3 ? 'critical' : Math.abs(pctChange) > threshold * 2 ? 'high' : 'moderate',
      };
      if (pctChange > 0) signals.escalated.push(entry);
      else signals.deescalated.push(entry);
      if (Math.abs(pctChange) > 10) criticalChanges++;
    } else {
      signals.unchanged.push(m.key);
    }
  }

  // ─── Count metrics: track absolute change (with minimum thresholds) ──

  for (const m of COUNT_METRICS) {
    const curr = m.extract(current);
    const prev = m.extract(previous);
    const diff = curr - prev;
    const threshold = cntThresholds[m.key] ?? 1;

    if (Math.abs(diff) >= threshold) {
      const pctChange = prev > 0 ? ((diff / prev) * 100) : (diff > 0 ? 100 : 0);
      const entry = {
        key: m.key, label: m.label, from: prev, to: curr,
        change: diff, direction: diff > 0 ? 'up' : 'down',
        pctChange: parseFloat(pctChange.toFixed(1)),
        severity: Math.abs(diff) >= threshold * 5 ? 'critical' : Math.abs(diff) >= threshold * 2 ? 'high' : 'moderate',
      };
      if (diff > 0) signals.escalated.push(entry);
      else signals.deescalated.push(entry);
      // Count metrics only critical if the change is extreme
      if (entry.severity === 'critical') criticalChanges++;
    } else {
      signals.unchanged.push(m.key);
    }
  }

  // ─── New urgent Telegram posts (semantic dedup) ──────────────────────

  const prevHashes = new Set(
    (previous.tg?.urgent || []).map(p => contentHash(p.text))
  );

  for (const post of (current.tg?.urgent || [])) {
    const hash = contentHash(post.text);
    if (hash && !prevHashes.has(hash)) {
      signals.new.push({
        key: `tg_urgent:${hash}`,
        text: post.text?.substring(0, 120),
        item: post,
        reason: 'New urgent OSINT post',
      });
      criticalChanges++;
    }
  }

  // ─── Nuclear anomaly state change ────────────────────────────────────

  const currAnom = current.nuke?.some(n => n.anom) || false;
  const prevAnom = previous.nuke?.some(n => n.anom) || false;
  if (currAnom && !prevAnom) {
    signals.new.push({ key: 'nuke_anomaly', reason: 'Nuclear anomaly detected', severity: 'critical' });
    criticalChanges += 5;
  } else if (!currAnom && prevAnom) {
    signals.deescalated.push({ key: 'nuke_anomaly', label: 'Nuclear Anomaly', direction: 'resolved', severity: 'high' });
  }

  // ─── Source health degradation ───────────────────────────────────────

  const currSourcesDown = current.health?.filter(s => s.err).length || 0;
  const prevSourcesDown = previous.health?.filter(s => s.err).length || 0;
  if (currSourcesDown > prevSourcesDown + 2) {
    signals.new.push({
      key: 'source_degradation',
      reason: `${currSourcesDown - prevSourcesDown} additional sources failing (${currSourcesDown} total down)`,
      severity: currSourcesDown > 5 ? 'critical' : 'moderate',
    });
  }

  // ─── Overall direction ───────────────────────────────────────────────

  let direction = 'mixed';
  const riskUp = signals.escalated.filter(s => RISK_KEYS.includes(s.key)).length;
  const riskDown = signals.deescalated.filter(s => RISK_KEYS.includes(s.key)).length;
  if (riskUp > riskDown + 1) direction = 'risk-off';
  else if (riskDown > riskUp + 1) direction = 'risk-on';

  return {
    timestamp: current.meta?.timestamp || new Date().toISOString(),
    previous: previous.meta?.timestamp || null,
    signals,
    summary: {
      totalChanges: signals.new.length + signals.escalated.length + signals.deescalated.length,
      criticalChanges,
      direction,
      signalBreakdown: {
        new: signals.new.length,
        escalated: signals.escalated.length,
        deescalated: signals.deescalated.length,
        unchanged: signals.unchanged.length,
      },
    },
  };
}

// Export thresholds for external config
export { DEFAULT_NUMERIC_THRESHOLDS, DEFAULT_COUNT_THRESHOLDS };
