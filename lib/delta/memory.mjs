// Memory Manager — hot/cold storage for sweep history and alert tracking
// v2: Atomic writes, decay-based alert cooldowns, configurable retention

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { computeDelta } from './engine.mjs';

const MAX_HOT_RUNS = 3;

// Alert cooldown tiers — repeated signals get progressively longer suppression
// First alert: 0h wait. Second occurrence within 24h: 6h cooldown. Third: 12h. Fourth+: 24h.
const ALERT_DECAY_TIERS = [0, 6, 12, 24]; // hours

export class MemoryManager {
  constructor(runsDir) {
    this.runsDir = runsDir;
    this.memoryDir = join(runsDir, 'memory');
    this.hotPath = join(this.memoryDir, 'hot.json');
    this.coldDir = join(this.memoryDir, 'cold');

    // Ensure dirs exist
    for (const dir of [this.memoryDir, this.coldDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // Load hot memory from disk
    this.hot = this._loadHot();
  }

  _normalizeCompactRunData(data = {}) {
    const normalized = data && typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : {};
    const health = normalized.healthSummary && typeof normalized.healthSummary === 'object' ? normalized.healthSummary : {};
    const clusterReview = normalized.clusterReviewStats && typeof normalized.clusterReviewStats === 'object' ? normalized.clusterReviewStats : {};
    normalized.tg = normalized.tg && typeof normalized.tg === 'object'
      ? {
          ...normalized.tg,
          posts: normalized.tg.posts ?? null,
          urgentCount: normalized.tg.urgentCount ?? (Array.isArray(normalized.tg.urgent) ? normalized.tg.urgent.length : null),
        }
      : { posts: null, urgentCount: null, urgent: [] };
    normalized.healthSummary = {
      total: health.total ?? null,
      ok: health.ok ?? null,
      degraded: health.degraded ?? null,
      stale: health.stale ?? null,
      failed: health.failed ?? null,
      byTrustClass: health.byTrustClass || {},
      byCategory: health.byCategory || {},
      compatibilityBackfilled: !normalized.healthSummary,
    };
    normalized.clusterReviewStats = {
      trackedRegionCount: clusterReview.trackedRegionCount ?? null,
      chronicFailureCount: clusterReview.chronicFailureCount ?? null,
      recentFailureCount: clusterReview.recentFailureCount ?? null,
      compatibilityBackfilled: !normalized.clusterReviewStats,
    };
    normalized.corroboratedSignalsSummary = normalized.corroboratedSignalsSummary || { total: null, byCategory: {}, byConfidence: {} };
    normalized.suspectSignalsSummary = normalized.suspectSignalsSummary || { total: null, byCategory: {}, byConfidence: {} };
    normalized.news = normalized.news && typeof normalized.news === 'object'
      ? { count: normalized.news.count ?? null }
      : { count: Array.isArray(normalized.news) ? normalized.news.length : null };
    normalized.markets = normalized.markets || { indexes: [], commodities: [], vix: null };
    normalized.energy = normalized.energy || { wti: null, brent: null, natgas: null, wtiRecent: [], signals: [] };
    normalized.metals = normalized.metals || { gold: null, goldChangePct: null, silver: null, silverChangePct: null };
    normalized._compatibility = {
      healthBackfilled: normalized.healthSummary.compatibilityBackfilled,
      reviewPressureBackfilled: normalized.clusterReviewStats.compatibilityBackfilled,
    };
    return normalized;
  }

  _loadHot() {
    // Try primary file first, then backup
    for (const path of [this.hotPath, this.hotPath + '.bak']) {
      try {
        const raw = readFileSync(path, 'utf8');
        const data = JSON.parse(raw);
        // Validate structure
        if (data && Array.isArray(data.runs) && typeof data.alertedSignals === 'object') {
          data.signalStates = (data.signalStates && typeof data.signalStates === 'object') ? data.signalStates : {};
          data.runs = data.runs.map(run => ({ ...run, data: this._normalizeCompactRunData(run?.data || {}) }));
          return data;
        }
      } catch { /* try next */ }
    }
    console.warn('[Memory] No valid hot memory found — starting fresh');
    return { runs: [], alertedSignals: {}, signalStates: {} };
  }

  /**
   * Atomic write: write to .tmp, then rename over target.
   * Keeps a .bak of the previous version for crash recovery.
   */
  _saveHot() {
    const tmpPath = this.hotPath + '.tmp';
    const bakPath = this.hotPath + '.bak';
    try {
      // 1. Write to temp file (if this crashes, original is untouched)
      writeFileSync(tmpPath, JSON.stringify(this.hot, null, 2));

      // 2. Back up current file (if it exists)
      try {
        if (existsSync(this.hotPath)) {
          // Copy current → .bak (overwrite previous backup)
          renameSync(this.hotPath, bakPath);
        }
      } catch { /* backup failure is non-fatal */ }

      // 3. Atomic rename: .tmp → hot.json
      renameSync(tmpPath, this.hotPath);
    } catch (err) {
      console.error('[Memory] Failed to save hot memory:', err.message);
      // Clean up tmp if it exists
      try { unlinkSync(tmpPath); } catch { }
    }
  }

  // Add a new run to hot memory
  addRun(synthesizedData) {
    const previous = this.getLastRun();
    // Collect urgent post hashes from all hot runs for broader dedup window
    const priorRuns = this.hot.runs.map(r => r.data);
    const delta = computeDelta(synthesizedData, previous, {}, priorRuns);

    // Compact the data for storage (strip large arrays)
    const compact = this._compactForStorage(synthesizedData);

    this.hot.runs.unshift({
      timestamp: synthesizedData.meta?.timestamp || new Date().toISOString(),
      data: compact,
      delta,
    });

    // Keep only MAX_HOT_RUNS
    if (this.hot.runs.length > MAX_HOT_RUNS) {
      const archived = this.hot.runs.splice(MAX_HOT_RUNS);
      this._archiveToCold(archived);
    }

    this._saveHot();
    return delta;
  }

  // Get last run's synthesized data
  getLastRun() {
    if (this.hot.runs.length === 0) return null;
    return this.hot.runs[0].data;
  }

  // Get last N runs
  getRunHistory(n = 3) {
    return this.hot.runs.slice(0, n);
  }

  getBaselineRun(hoursAgo = 6) {
    const targetTime = Date.now() - hoursAgo * 60 * 60 * 1000;
    const candidates = [];

    for (const run of this.hot.runs || []) {
      candidates.push(run);
    }

    try {
      const coldFiles = existsSync(this.coldDir)
        ? readdirSync(this.coldDir).filter(name => name.endsWith('.json')).sort().reverse()
        : [];
      for (const file of coldFiles) {
        const runs = JSON.parse(readFileSync(join(this.coldDir, file), 'utf8'));
        if (Array.isArray(runs)) candidates.push(...runs);
      }
    } catch (err) {
      console.error('[Memory] Failed to read cold baseline history:', err.message);
    }

    let best = null;
    let bestDiff = Infinity;
    for (const run of candidates) {
      const ts = new Date(run?.timestamp || run?.data?.meta?.timestamp || 0).getTime();
      if (!ts) continue;
      const diff = Math.abs(ts - targetTime);
      if (diff < bestDiff) {
        best = run;
        bestDiff = diff;
      }
    }

    return best?.data || null;
  }

  // Get the delta from the most recent run
  getLastDelta() {
    if (this.hot.runs.length === 0) return null;
    return this.hot.runs[0].delta;
  }

  // ─── Alert Signal Tracking (Decay-Based) ───────────────────────────────

  getAlertedSignals() {
    return this.hot.alertedSignals || {};
  }

  getSignalState(signalKey) {
    return this.hot.signalStates?.[signalKey] || null;
  }

  setSignalState(signalKey, state) {
    this.hot.signalStates = this.hot.signalStates || {};
    if (state == null) delete this.hot.signalStates[signalKey];
    else this.hot.signalStates[signalKey] = state;
    this._saveHot();
  }

  /**
   * Check if a signal should be suppressed based on decay-based cooldown.
   * Returns true if the signal is still in cooldown.
   */
  isSignalSuppressed(signalKey) {
    const entry = this.hot.alertedSignals[signalKey];
    if (!entry) return false;

    const now = Date.now();
    const occurrences = typeof entry === 'object' ? (entry.count || 1) : 1;
    const lastAlerted = typeof entry === 'object' ? new Date(entry.lastAlerted).getTime() : new Date(entry).getTime();

    // Pick cooldown tier based on how many times this signal has fired
    const tierIndex = Math.min(occurrences, ALERT_DECAY_TIERS.length - 1);
    const cooldownHours = ALERT_DECAY_TIERS[tierIndex];
    const cooldownMs = cooldownHours * 60 * 60 * 1000;

    return (now - lastAlerted) < cooldownMs;
  }

  /**
   * Mark a signal as alerted, incrementing its occurrence counter.
   * Supports both legacy (string timestamp) and new (object with count) formats.
   */
  markAsAlerted(signalKey, timestamp) {
    const now = timestamp || new Date().toISOString();
    const existing = this.hot.alertedSignals[signalKey];

    if (existing && typeof existing === 'object') {
      // Increment existing
      existing.count = (existing.count || 1) + 1;
      existing.lastAlerted = now;
      existing.firstSeen = existing.firstSeen || now;
    } else {
      // New entry (or migrate from legacy string format)
      this.hot.alertedSignals[signalKey] = {
        firstSeen: typeof existing === 'string' ? existing : now,
        lastAlerted: now,
        count: typeof existing === 'string' ? 2 : 1,
      };
    }
    this._saveHot();
  }

  /**
   * Prune stale alerted signals.
   * Signals with 1 occurrence: pruned after 24h.
   * Signals with 2+ occurrences: pruned after 48h from last alert.
   * This prevents infinite accumulation while keeping recurring signal awareness.
   */
  pruneAlertedSignals() {
    const now = Date.now();
    for (const [key, entry] of Object.entries(this.hot.alertedSignals)) {
      let lastTime, count;

      if (typeof entry === 'object') {
        lastTime = new Date(entry.lastAlerted).getTime();
        count = entry.count || 1;
      } else {
        // Legacy string format
        lastTime = new Date(entry).getTime();
        count = 1;
      }

      const maxAge = count >= 2 ? 48 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      if ((now - lastTime) > maxAge) {
        delete this.hot.alertedSignals[key];
      }
    }
    this._saveHot();
  }

  // Compact data for storage — strip heavy arrays
  _compactForStorage(data) {
    const summarizeSignals = (signals = []) => ({
      total: signals.length,
      byCategory: signals.reduce((acc, signal) => {
        const key = signal?.category || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      byConfidence: signals.reduce((acc, signal) => {
        const key = signal?.confidence || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    });

    return {
      meta: data.meta,
      fred: data.fred,
      energy: data.energy ? {
        wti: data.energy.wti,
        brent: data.energy.brent,
        natgas: data.energy.natgas,
        wtiRecent: data.energy.wtiRecent,
        signals: data.energy.signals,
      } : undefined,
      metals: data.metals ? {
        gold: data.metals.gold,
        goldChangePct: data.metals.goldChangePct,
        silver: data.metals.silver,
        silverChangePct: data.metals.silverChangePct,
      } : undefined,
      bls: data.bls,
      treasury: data.treasury,
      gscpi: data.gscpi,
      tg: {
        posts: data.tg?.posts,
        urgentCount: (data.tg?.urgent || []).length,
        urgent: (data.tg?.urgent || []).map(p => ({
          text: p.text,
          date: p.date,
          channel: p.channel || p.chat || null,
          postId: p.postId || null,
        })),
      },
      thermal: (data.thermal || []).map(t => ({ region: t.region, det: t.det, night: t.night, hc: t.hc })),
      air: (data.air || []).map(a => ({ region: a.region, total: a.total })),
      nuke: (data.nuke || []).map(n => ({ site: n.site, anom: n.anom, cpm: n.cpm })),
      who: (data.who || []).map(w => ({ title: w.title })),
      acled: { totalEvents: data.acled?.totalEvents, totalFatalities: data.acled?.totalFatalities },
      sdr: { total: data.sdr?.total, online: data.sdr?.online },
      news: { count: data.news?.length || 0 },
      newsClusters: (data.newsClusters || []).slice(0, 12).map(cluster => ({
        id: cluster.id,
        region: cluster.region,
        headline: cluster.headline,
        storyCount: cluster.storyCount,
        sourceCount: cluster.sourceCount,
        quality: cluster.quality,
        qualityFlags: cluster.qualityFlags || [],
      })),
      corroboratedSignalsSummary: summarizeSignals(data.corroboratedSignals || []),
      suspectSignalsSummary: summarizeSignals(data.suspectSignals || []),
      healthSummary: data.healthSummary ? {
        total: data.healthSummary.total,
        ok: data.healthSummary.ok,
        degraded: data.healthSummary.degraded,
        stale: data.healthSummary.stale,
        failed: data.healthSummary.failed,
        byTrustClass: data.healthSummary.byTrustClass || {},
        byCategory: data.healthSummary.byCategory || {},
      } : undefined,
      markets: data.markets ? {
        indexes: (data.markets.indexes || []).map(i => ({ symbol: i.symbol, price: i.price, changePct: i.changePct })),
        commodities: (data.markets.commodities || []).map(c => ({ symbol: c.symbol, price: c.price, changePct: c.changePct })),
        vix: data.markets.vix ? { value: data.markets.vix.value, changePct: data.markets.vix.changePct } : null,
      } : undefined,
      ideas: (data.ideas || []).map(i => ({ title: i.title, type: i.type, confidence: i.confidence })),
      clusterReviewStats: data.clusterReviewStats ? {
        trackedRegionCount: data.clusterReviewStats.trackedRegionCount,
        chronicFailureCount: data.clusterReviewStats.chronicFailureCount,
        recentFailureCount: data.clusterReviewStats.recentFailureCount,
      } : undefined,
    };
  }

  _getAllRunsNewestFirst() {
    const candidates = [];
    for (const run of this.hot.runs || []) candidates.push(run);

    try {
      const coldFiles = existsSync(this.coldDir)
        ? readdirSync(this.coldDir).filter(name => name.endsWith('.json')).sort().reverse()
        : [];
      for (const file of coldFiles) {
        const runs = JSON.parse(readFileSync(join(this.coldDir, file), 'utf8'));
        if (Array.isArray(runs)) candidates.push(...runs);
      }
    } catch (err) {
      console.error('[Memory] Failed to read cold history:', err.message);
    }

    return candidates
      .map(run => ({ ...run, data: this._normalizeCompactRunData(run?.data || {}), _ts: new Date(run?.timestamp || run?.data?.meta?.timestamp || 0).getTime() }))
      .filter(run => run._ts)
      .sort((a, b) => b._ts - a._ts);
  }

  getTrendSummary(windowsHours = [24, 72, 168]) {
    const allRuns = this._getAllRunsNewestFirst();
    const now = Date.now();

    const summarizeWindow = (hours) => {
      const cutoff = now - hours * 60 * 60 * 1000;
      const runs = allRuns.filter(run => run._ts >= cutoff);
      if (!runs.length) return { hours, status: 'empty', runCount: 0, windowStart: null, windowEnd: null };

      const newest = runs[0].data || {};
      const oldest = runs[runs.length - 1].data || {};
      const numericValues = values => values.filter(value => Number.isFinite(value));
      const avg = values => {
        const present = numericValues(values);
        return present.length ? Number((present.reduce((a, b) => a + b, 0) / present.length).toFixed(2)) : null;
      };
      const max = values => {
        const present = numericValues(values);
        return present.length ? Math.max(...present) : null;
      };
      const current = value => Number.isFinite(value) ? value : null;
      const sumBy = (items, getter) => items.reduce((acc, item) => acc + (getter(item) || 0), 0);
      const topicCounts = {};
      const regionCounts = {};

      for (const run of runs) {
        for (const cluster of run.data?.newsClusters || []) {
          const topicKey = cluster.id || cluster.headline || 'unknown';
          topicCounts[topicKey] = {
            id: cluster.id || null,
            headline: cluster.headline || cluster.id || 'unknown',
            region: cluster.region || 'unknown',
            count: (topicCounts[topicKey]?.count || 0) + 1,
            maxStoryCount: Math.max(topicCounts[topicKey]?.maxStoryCount || 0, cluster.storyCount || 0),
          };
          const region = cluster.region || 'unknown';
          regionCounts[region] = (regionCounts[region] || 0) + 1;
        }
      }

      return {
        hours,
        status: runs.length >= 2 ? 'ready' : 'thin-history',
        runCount: runs.length,
        windowStart: new Date(runs[runs.length - 1]._ts).toISOString(),
        windowEnd: new Date(runs[0]._ts).toISOString(),
        urgentTempo: {
          current: current(newest.tg?.urgentCount),
          average: avg(runs.map(run => run.data?.tg?.urgentCount)),
          max: max(runs.map(run => run.data?.tg?.urgentCount)),
          totalPostsCurrent: current(newest.tg?.posts),
        },
        signals: {
          corroboratedCurrent: current(newest.corroboratedSignalsSummary?.total),
          corroboratedAverage: avg(runs.map(run => run.data?.corroboratedSignalsSummary?.total)),
          suspectCurrent: current(newest.suspectSignalsSummary?.total),
          suspectAverage: avg(runs.map(run => run.data?.suspectSignalsSummary?.total)),
          suspectPeak: max(runs.map(run => run.data?.suspectSignalsSummary?.total)),
        },
        marketRegime: {
          indexes: (newest.markets?.indexes || []).map(index => ({
            symbol: index.symbol,
            current: index.price ?? null,
            driftFromWindowStart: (() => {
              const old = (oldest.markets?.indexes || []).find(item => item.symbol === index.symbol);
              if (!old || old.price == null || index.price == null) return null;
              return Number((index.price - old.price).toFixed(2));
            })(),
            changePct: index.changePct ?? null,
          })),
          vix: newest.markets?.vix ? {
            current: newest.markets.vix.value ?? null,
            changePct: newest.markets.vix.changePct ?? null,
            driftFromWindowStart: oldest.markets?.vix?.value != null && newest.markets?.vix?.value != null
              ? Number((newest.markets.vix.value - oldest.markets.vix.value).toFixed(2))
              : null,
          } : null,
        },
        commodityDrift: {
          energy: {
            wtiCurrent: newest.energy?.wti ?? null,
            wtiWindowDrift: oldest.energy?.wti != null && newest.energy?.wti != null ? Number((newest.energy.wti - oldest.energy.wti).toFixed(2)) : null,
            brentCurrent: newest.energy?.brent ?? null,
            brentWindowDrift: oldest.energy?.brent != null && newest.energy?.brent != null ? Number((newest.energy.brent - oldest.energy.brent).toFixed(2)) : null,
            natgasCurrent: newest.energy?.natgas ?? null,
            natgasWindowDrift: oldest.energy?.natgas != null && newest.energy?.natgas != null ? Number((newest.energy.natgas - oldest.energy.natgas).toFixed(2)) : null,
          },
          metals: {
            goldCurrent: newest.metals?.gold ?? null,
            goldWindowDrift: oldest.metals?.gold != null && newest.metals?.gold != null ? Number((newest.metals.gold - oldest.metals.gold).toFixed(2)) : null,
            silverCurrent: newest.metals?.silver ?? null,
            silverWindowDrift: oldest.metals?.silver != null && newest.metals?.silver != null ? Number((newest.metals.silver - oldest.metals.silver).toFixed(2)) : null,
          },
        },
        anomalyPersistence: {
          thermalRuns: runs.filter(run => sumBy(run.data?.thermal || [], item => item.det || 0) > 0).length,
          airRuns: runs.filter(run => sumBy(run.data?.air || [], item => item.total || 0) > 0).length,
          nuclearRuns: runs.filter(run => (run.data?.nuke || []).some(item => item.anom)).length,
        },
        sourceHealth: {
          degradedRuns: runs.filter(run => Number.isFinite(run.data?.healthSummary?.degraded) && run.data.healthSummary.degraded > 0).length,
          staleRuns: runs.filter(run => Number.isFinite(run.data?.healthSummary?.stale) && run.data.healthSummary.stale > 0).length,
          failedRuns: runs.filter(run => Number.isFinite(run.data?.healthSummary?.failed) && run.data.healthSummary.failed > 0).length,
          currentFailed: current(newest.healthSummary?.failed),
          maxFailed: max(runs.map(run => run.data?.healthSummary?.failed)),
          compatibilityBackfilledRuns: runs.filter(run => run.data?._compatibility?.healthBackfilled).length,
        },
        recurringNews: {
          topTopics: Object.values(topicCounts).sort((a, b) => b.count - a.count || b.maxStoryCount - a.maxStoryCount).slice(0, 8),
          topRegions: Object.entries(regionCounts).map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count).slice(0, 8),
        },
        reviewPressure: {
          trackedRegionCount: current(newest.clusterReviewStats?.trackedRegionCount),
          chronicFailureCount: current(newest.clusterReviewStats?.chronicFailureCount),
          recentFailureCount: current(newest.clusterReviewStats?.recentFailureCount),
          compatibilityBackfilledRuns: runs.filter(run => run.data?._compatibility?.reviewPressureBackfilled).length,
        },
      };
    };

    return {
      generatedAt: new Date().toISOString(),
      windows: windowsHours.map(summarizeWindow),
    };
  }

  // Archive old runs to cold storage
  _archiveToCold(runs) {
    if (runs.length === 0) return;
    const dateKey = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const coldPath = join(this.coldDir, `${dateKey}.json`);

    let existing = [];
    try { existing = JSON.parse(readFileSync(coldPath, 'utf8')); } catch { }

    existing.push(...runs);
    // Use atomic write for cold storage too
    const tmpPath = coldPath + '.tmp';
    try {
      writeFileSync(tmpPath, JSON.stringify(existing, null, 2));
      renameSync(tmpPath, coldPath);
    } catch (err) {
      console.error('[Memory] Failed to archive to cold storage:', err.message);
      try { unlinkSync(tmpPath); } catch { }
    }
  }
}
