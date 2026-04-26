// Memory Manager — hot/cold storage for sweep history and alert tracking
// v2: Atomic writes, decay-based alert cooldowns, configurable retention

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { computeDelta } from './engine.mjs';
import { RuntimeHistoryStore } from './runtime-history-store.mjs';

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
    this.runtimeHistoryStore = new RuntimeHistoryStore(join(this.runsDir, 'runtime-history.sqlite'));

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
    normalized.sourcePerformanceSnapshot = normalized.sourcePerformanceSnapshot && typeof normalized.sourcePerformanceSnapshot === 'object'
      ? normalized.sourcePerformanceSnapshot
      : null;
    normalized.noiseSuppressionTelemetrySnapshot = normalized.noiseSuppressionTelemetrySnapshot && typeof normalized.noiseSuppressionTelemetrySnapshot === 'object'
      ? normalized.noiseSuppressionTelemetrySnapshot
      : null;
    normalized._compatibility = {
      healthBackfilled: normalized.healthSummary.compatibilityBackfilled,
      reviewPressureBackfilled: normalized.clusterReviewStats.compatibilityBackfilled,
      sourcePerformanceBackfilled: !normalized.sourcePerformanceSnapshot,
      noiseSuppressionBackfilled: !normalized.noiseSuppressionTelemetrySnapshot,
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

    const timestamp = synthesizedData.meta?.timestamp || new Date().toISOString();
    this.hot.runs.unshift({
      timestamp,
      data: compact,
      delta,
    });

    this.runtimeHistoryStore.upsertRun({ timestamp, compact, delta });

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
    const persisted = this.runtimeHistoryStore.getSignalState(signalKey);
    if (persisted != null) return persisted;
    return this.hot.signalStates?.[signalKey] || null;
  }

  setSignalState(signalKey, state) {
    this.hot.signalStates = this.hot.signalStates || {};
    if (state == null) delete this.hot.signalStates[signalKey];
    else this.hot.signalStates[signalKey] = state;
    this.runtimeHistoryStore.setSignalState(signalKey, state);
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

    const sourcePerformance = data?.sourceOps?.performance || null;

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
      sourcePerformanceSnapshot: sourcePerformance ? {
        version: sourcePerformance.version || 'source-performance-workflow-v1',
        totalMeasuredSources: sourcePerformance.totalMeasuredSources || 0,
        withClusterAttribution: sourcePerformance.withClusterAttribution || 0,
        withSignalContribution: sourcePerformance.withSignalContribution || 0,
        degradedOrFailing: sourcePerformance.degradedOrFailing || 0,
        byTrustOutcome: sourcePerformance.byTrustOutcome || { supportive: 0, mixed: 0, degraded: 0, none: 0 },
        attributionCoverage: sourcePerformance.attributionCoverage || null,
        validationViews: sourcePerformance.workflow?.validationViews || null,
        attributionHeadlines: Array.isArray(sourcePerformance.workflow?.attributionHeadlines)
          ? sourcePerformance.workflow.attributionHeadlines.slice(0, 5).map(item => ({
              id: item.id || null,
              name: item.name || null,
              impactLabel: item.impactLabel || null,
              trustOutcome: item.trustOutcome || null,
              attentionScore: item.attentionScore || 0,
            }))
          : [],
        runtimeBucketDrift: sourcePerformance.workflow?.attributionDiagnostics?.runtimeBucketDrift ? {
          version: sourcePerformance.workflow.attributionDiagnostics.runtimeBucketDrift.version || 'source-runtime-bucket-drift-v1',
          totalDriftCount: sourcePerformance.workflow.attributionDiagnostics.runtimeBucketDrift.totalDriftCount || 0,
          singlePublisherMismatchCount: sourcePerformance.workflow.attributionDiagnostics.runtimeBucketDrift.singlePublisherMismatchCount || 0,
          missingAggregatorAliasCount: sourcePerformance.workflow.attributionDiagnostics.runtimeBucketDrift.missingAggregatorAliasCount || 0,
          highSeverityCount: sourcePerformance.workflow.attributionDiagnostics.runtimeBucketDrift.highSeverityCount || 0,
          items: Array.isArray(sourcePerformance.workflow.attributionDiagnostics.runtimeBucketDrift.items)
            ? sourcePerformance.workflow.attributionDiagnostics.runtimeBucketDrift.items.slice(0, 6).map(item => ({
                runtimeSource: item.runtimeSource || null,
                driftKind: item.driftKind || null,
                severity: item.severity || 'none',
                observedPublisherCount: item.observedPublisherCount || 0,
                clusterCount: item.clusterCount || 0,
                summary: item.summary || null,
              }))
            : [],
        } : null,
        topImpactSources: Array.isArray(sourcePerformance.topImpactSources)
          ? sourcePerformance.topImpactSources.slice(0, 8).map(item => ({
              name: item.name || null,
              attentionScore: item.attentionScore || 0,
              impactLabel: item.impactLabel || null,
              trustOutcome: item.trustOutcome || null,
              contribution: item.contribution || null,
            }))
          : [],
      } : undefined,
      noiseSuppressionTelemetrySnapshot: data?.noiseSuppressionTelemetrySnapshot ? {
        version: data.noiseSuppressionTelemetrySnapshot.version || 'noise-suppression-history-trend-v1',
        summary: data.noiseSuppressionTelemetrySnapshot.summary || {},
        bucketCounts: data.noiseSuppressionTelemetrySnapshot.bucketCounts || {},
        candidateCounts: data.noiseSuppressionTelemetrySnapshot.candidateCounts || {},
      } : undefined,
    };
  }

  _getAllRunsNewestFirst() {
    const byTimestamp = new Map();
    const addRun = (run) => {
      const timestamp = run?.timestamp || run?.data?.meta?.timestamp || null;
      if (!timestamp) return;
      if (!byTimestamp.has(timestamp)) byTimestamp.set(timestamp, run);
    };

    for (const run of this.runtimeHistoryStore.getAllRuns()) addRun(run);
    for (const run of this.hot.runs || []) addRun(run);

    try {
      const coldFiles = existsSync(this.coldDir)
        ? readdirSync(this.coldDir).filter(name => name.endsWith('.json')).sort().reverse()
        : [];
      for (const file of coldFiles) {
        const runs = JSON.parse(readFileSync(join(this.coldDir, file), 'utf8'));
        if (Array.isArray(runs)) {
          for (const run of runs) addRun(run);
        }
      }
    } catch (err) {
      console.error('[Memory] Failed to read cold history:', err.message);
    }

    return Array.from(byTimestamp.values())
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

  getSourcePerformanceHistory(limit = 8) {
    const runs = this._getAllRunsNewestFirst()
      .filter(run => run?.data?.sourcePerformanceSnapshot)
      .slice(0, Math.max(1, limit));

    const trustKeys = ['supportive', 'mixed', 'degraded', 'none'];
    const snapshots = runs.map(run => {
      const perf = run.data.sourcePerformanceSnapshot;
      return {
        timestamp: run.timestamp || new Date(run._ts).toISOString(),
        version: perf.version || 'source-performance-workflow-v1',
        summary: {
          totalMeasuredSources: perf.totalMeasuredSources || 0,
          withClusterAttribution: perf.withClusterAttribution || 0,
          withSignalContribution: perf.withSignalContribution || 0,
          degradedOrFailing: perf.degradedOrFailing || 0,
          byTrustOutcome: perf.byTrustOutcome || { supportive: 0, mixed: 0, degraded: 0, none: 0 },
          attributionCoverage: perf.attributionCoverage || null,
        },
        validationViews: perf.validationViews || null,
        runtimeBucketDrift: perf.runtimeBucketDrift || null,
        attributionHeadlines: Array.isArray(perf.attributionHeadlines) ? perf.attributionHeadlines : [],
        topImpactSources: Array.isArray(perf.topImpactSources) ? perf.topImpactSources : [],
      };
    });

    const deltaViews = [];
    for (let index = 0; index < snapshots.length - 1; index += 1) {
      const current = snapshots[index];
      const previous = snapshots[index + 1];
      const currentSources = new Map((current.topImpactSources || []).map(item => [item.name, item]));
      const previousSources = new Map((previous.topImpactSources || []).map(item => [item.name, item]));
      const currentDriftItems = new Map(((current.runtimeBucketDrift?.items) || []).map(item => [item.runtimeSource, item]));
      const previousDriftItems = new Map(((previous.runtimeBucketDrift?.items) || []).map(item => [item.runtimeSource, item]));
      const sourceNames = Array.from(new Set([...currentSources.keys(), ...previousSources.keys()]));
      const driftSourceNames = Array.from(new Set([...currentDriftItems.keys(), ...previousDriftItems.keys()]));
      const topSourceShifts = sourceNames.map(name => {
        const currentItem = currentSources.get(name) || null;
        const previousItem = previousSources.get(name) || null;
        return {
          name,
          currentAttentionScore: currentItem?.attentionScore || 0,
          previousAttentionScore: previousItem?.attentionScore || 0,
          attentionScoreDelta: (currentItem?.attentionScore || 0) - (previousItem?.attentionScore || 0),
          currentTrustOutcome: currentItem?.trustOutcome || 'none',
          previousTrustOutcome: previousItem?.trustOutcome || 'none',
          status: currentItem && !previousItem ? 'new' : !currentItem && previousItem ? 'dropped' : 'retained',
        };
      }).sort((a, b) => Math.abs(b.attentionScoreDelta) - Math.abs(a.attentionScoreDelta) || b.currentAttentionScore - a.currentAttentionScore || a.name.localeCompare(b.name)).slice(0, 6);
      const severityRank = { none: 0, low: 1, medium: 2, high: 3 };
      const topRuntimeBucketShifts = driftSourceNames.map(runtimeSource => {
        const currentItem = currentDriftItems.get(runtimeSource) || null;
        const previousItem = previousDriftItems.get(runtimeSource) || null;
        return {
          runtimeSource,
          status: currentItem && !previousItem ? 'new' : !currentItem && previousItem ? 'resolved' : 'retained',
          currentSeverity: currentItem?.severity || 'none',
          previousSeverity: previousItem?.severity || 'none',
          currentObservedPublisherCount: currentItem?.observedPublisherCount || 0,
          previousObservedPublisherCount: previousItem?.observedPublisherCount || 0,
          observedPublisherDelta: (currentItem?.observedPublisherCount || 0) - (previousItem?.observedPublisherCount || 0),
          driftKind: currentItem?.driftKind || previousItem?.driftKind || null,
          severityDelta: (severityRank[currentItem?.severity || 'none'] || 0) - (severityRank[previousItem?.severity || 'none'] || 0),
        };
      }).sort((a, b) => Math.abs(b.severityDelta) - Math.abs(a.severityDelta) || Math.abs(b.observedPublisherDelta) - Math.abs(a.observedPublisherDelta) || a.runtimeSource.localeCompare(b.runtimeSource)).slice(0, 6);

      deltaViews.push({
        currentTimestamp: current.timestamp,
        previousTimestamp: previous.timestamp,
        summaryDelta: {
          withClusterAttribution: current.summary.withClusterAttribution - previous.summary.withClusterAttribution,
          withSignalContribution: current.summary.withSignalContribution - previous.summary.withSignalContribution,
          degradedOrFailing: current.summary.degradedOrFailing - previous.summary.degradedOrFailing,
          byTrustOutcome: Object.fromEntries(trustKeys.map(key => [key, (current.summary.byTrustOutcome?.[key] || 0) - (previous.summary.byTrustOutcome?.[key] || 0)])),
          clusterQuality: Object.fromEntries((current.validationViews?.clusterQuality || []).map(item => {
            const previousValue = (previous.validationViews?.clusterQuality || []).find(candidate => candidate.label === item.label)?.value || 0;
            return [item.label, (item.value || 0) - previousValue];
          })),
          reviewPressure: Object.fromEntries((current.validationViews?.reviewPressure || []).map(item => {
            const previousValue = (previous.validationViews?.reviewPressure || []).find(candidate => candidate.label === item.label)?.value || 0;
            return [item.label, (item.value || 0) - previousValue];
          })),
          runtimeBucketDrift: {
            totalDriftCount: (current.runtimeBucketDrift?.totalDriftCount || 0) - (previous.runtimeBucketDrift?.totalDriftCount || 0),
            singlePublisherMismatchCount: (current.runtimeBucketDrift?.singlePublisherMismatchCount || 0) - (previous.runtimeBucketDrift?.singlePublisherMismatchCount || 0),
            missingAggregatorAliasCount: (current.runtimeBucketDrift?.missingAggregatorAliasCount || 0) - (previous.runtimeBucketDrift?.missingAggregatorAliasCount || 0),
            highSeverityCount: (current.runtimeBucketDrift?.highSeverityCount || 0) - (previous.runtimeBucketDrift?.highSeverityCount || 0),
          },
        },
        topSourceShifts,
        topRuntimeBucketShifts,
      });
    }

    return {
      version: 'source-performance-history-v1',
      generatedAt: new Date().toISOString(),
      snapshotCount: snapshots.length,
      snapshots,
      deltaViews,
    };
  }

  getSourceHealthHistory(limit = 8) {
    const runs = this._getAllRunsNewestFirst()
      .filter(run => run?.data?.healthSummary)
      .slice(0, Math.max(1, limit));

    const snapshots = runs.map(run => ({
      timestamp: run.timestamp || new Date(run._ts).toISOString(),
      summary: run.data.healthSummary,
    }));

    const deltaViews = [];
    for (let index = 0; index < snapshots.length - 1; index += 1) {
      const current = snapshots[index];
      const previous = snapshots[index + 1];
      deltaViews.push({
        currentTimestamp: current.timestamp,
        previousTimestamp: previous.timestamp,
        summaryDelta: {
          ok: (current.summary?.ok || 0) - (previous.summary?.ok || 0),
          degraded: (current.summary?.degraded || 0) - (previous.summary?.degraded || 0),
          stale: (current.summary?.stale || 0) - (previous.summary?.stale || 0),
          failed: (current.summary?.failed || 0) - (previous.summary?.failed || 0),
        },
      });
    }

    return {
      version: 'source-health-history-v1',
      generatedAt: new Date().toISOString(),
      snapshotCount: snapshots.length,
      snapshots,
      deltaViews,
    };
  }

  getReviewPressureHistory(limit = 8) {
    const runs = this._getAllRunsNewestFirst()
      .filter(run => run?.data?.clusterReviewStats)
      .slice(0, Math.max(1, limit));

    const snapshots = runs.map(run => ({
      timestamp: run.timestamp || new Date(run._ts).toISOString(),
      summary: run.data.clusterReviewStats,
    }));

    const deltaViews = [];
    for (let index = 0; index < snapshots.length - 1; index += 1) {
      const current = snapshots[index];
      const previous = snapshots[index + 1];
      deltaViews.push({
        currentTimestamp: current.timestamp,
        previousTimestamp: previous.timestamp,
        summaryDelta: {
          trackedRegionCount: (current.summary?.trackedRegionCount || 0) - (previous.summary?.trackedRegionCount || 0),
          chronicFailureCount: (current.summary?.chronicFailureCount || 0) - (previous.summary?.chronicFailureCount || 0),
          recentFailureCount: (current.summary?.recentFailureCount || 0) - (previous.summary?.recentFailureCount || 0),
        },
      });
    }

    return {
      version: 'review-pressure-history-v1',
      generatedAt: new Date().toISOString(),
      snapshotCount: snapshots.length,
      snapshots,
      deltaViews,
    };
  }

  getLlmFailureHistory(limit = 8) {
    const runs = this._getAllRunsNewestFirst()
      .filter(run => run?.data?.newsClusters || run?.data?.clusterReviewStats)
      .slice(0, Math.max(1, limit));

    const snapshots = runs.map(run => {
      const clusters = Array.isArray(run.data?.newsClusters) ? run.data.newsClusters : [];
      const heuristicOnlyCount = clusters.filter(cluster => (cluster.qualityFlags || []).includes('heuristic-only')).length;
      const singleSourceCount = clusters.filter(cluster => (cluster.qualityFlags || []).includes('single-source')).length;
      return {
        timestamp: run.timestamp || new Date(run._ts).toISOString(),
        summary: {
          heuristicFallbackCount: heuristicOnlyCount,
          weakClusterCount: clusters.filter(cluster => cluster.quality === 'low' || cluster.confidenceLabel === 'weak').length,
          singleSourceWeakClusterCount: singleSourceCount,
          chronicFailureCount: run.data?.clusterReviewStats?.chronicFailureCount || 0,
          recentFailureCount: run.data?.clusterReviewStats?.recentFailureCount || 0,
        },
      };
    });

    return {
      version: 'llm-failure-history-v1',
      generatedAt: new Date().toISOString(),
      snapshotCount: snapshots.length,
      snapshots,
    };
  }

  getNoiseSuppressionTelemetryHistory(limit = 8) {
    const runs = this._getAllRunsNewestFirst()
      .filter(run => run?.data?.noiseSuppressionTelemetrySnapshot)
      .slice(0, Math.max(1, limit));

    const snapshots = runs.map(run => {
      const telemetry = run.data.noiseSuppressionTelemetrySnapshot;
      return {
        timestamp: run.timestamp || new Date(run._ts).toISOString(),
        version: telemetry.version || 'noise-suppression-history-trend-v1',
        summary: {
          agedOutSuggestionCount: telemetry.summary?.agedOutSuggestionCount || 0,
          retainedEntries: telemetry.summary?.retainedEntries || 0,
          totalEntries: telemetry.summary?.totalEntries || 0,
          expiredEntriesRemoved: telemetry.summary?.expiredEntriesRemoved || 0,
          overflowEntriesRemoved: telemetry.summary?.overflowEntriesRemoved || 0,
          pruningActive: Boolean(telemetry.summary?.pruningActive),
        },
        bucketCounts: telemetry.bucketCounts || {},
        candidateCounts: telemetry.candidateCounts || {},
      };
    });

    const deltaViews = [];
    for (let index = 0; index < snapshots.length - 1; index += 1) {
      const current = snapshots[index];
      const previous = snapshots[index + 1];
      const bucketNames = Array.from(new Set([...Object.keys(current.bucketCounts || {}), ...Object.keys(previous.bucketCounts || {})]));
      const candidateNames = Array.from(new Set([...Object.keys(current.candidateCounts || {}), ...Object.keys(previous.candidateCounts || {})]));
      deltaViews.push({
        currentTimestamp: current.timestamp,
        previousTimestamp: previous.timestamp,
        summaryDelta: {
          agedOutSuggestionCount: current.summary.agedOutSuggestionCount - previous.summary.agedOutSuggestionCount,
          retainedEntries: current.summary.retainedEntries - previous.summary.retainedEntries,
          totalEntries: current.summary.totalEntries - previous.summary.totalEntries,
          expiredEntriesRemoved: current.summary.expiredEntriesRemoved - previous.summary.expiredEntriesRemoved,
          overflowEntriesRemoved: current.summary.overflowEntriesRemoved - previous.summary.overflowEntriesRemoved,
        },
        bucketCountDelta: Object.fromEntries(bucketNames.map(name => [name, (current.bucketCounts?.[name] || 0) - (previous.bucketCounts?.[name] || 0)])),
        candidateCountDelta: Object.fromEntries(candidateNames.map(name => [name, (current.candidateCounts?.[name] || 0) - (previous.candidateCounts?.[name] || 0)])),
      });
    }

    return {
      version: 'noise-suppression-history-trend-v1',
      generatedAt: new Date().toISOString(),
      snapshotCount: snapshots.length,
      snapshots,
      deltaViews,
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
