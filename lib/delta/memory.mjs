// Memory Manager — hot/cold storage for sweep history and alert tracking
// v2: Atomic writes, decay-based alert cooldowns, configurable retention

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'fs';
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

  _loadHot() {
    // Try primary file first, then backup
    for (const path of [this.hotPath, this.hotPath + '.bak']) {
      try {
        const raw = readFileSync(path, 'utf8');
        const data = JSON.parse(raw);
        // Validate structure
        if (data && Array.isArray(data.runs) && typeof data.alertedSignals === 'object') {
          return data;
        }
      } catch { /* try next */ }
    }
    console.warn('[Memory] No valid hot memory found — starting fresh');
    return { runs: [], alertedSignals: {} };
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

  // Get the delta from the most recent run
  getLastDelta() {
    if (this.hot.runs.length === 0) return null;
    return this.hot.runs[0].delta;
  }

  // ─── Alert Signal Tracking (Decay-Based) ───────────────────────────────

  getAlertedSignals() {
    return this.hot.alertedSignals || {};
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
    return {
      meta: data.meta,
      fred: data.fred,
      energy: data.energy,
      bls: data.bls,
      treasury: data.treasury,
      gscpi: data.gscpi,
      tg: {
        posts: data.tg?.posts,
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
      ideas: (data.ideas || []).map(i => ({ title: i.title, type: i.type, confidence: i.confidence })),
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
