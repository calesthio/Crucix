#!/usr/bin/env node
// Crucix Intelligence Engine — Dev Server
// Serves the Jarvis dashboard, runs sweep cycle, pushes live updates via SSE

import express from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import config from './crucix.config.mjs';
import { getLocale, currentLanguage, getSupportedLocales } from './lib/i18n.mjs';
import { fullBriefing } from './apis/briefing.mjs';
import { synthesize, generateIdeas, buildNewsClusters } from './dashboard/inject.mjs';
import { MemoryManager } from './lib/delta/index.mjs';
import { createLLMProvider } from './lib/llm/index.mjs';
import { generateLLMIdeas } from './lib/llm/ideas.mjs';
import { TelegramAlerter } from './lib/alerts/telegram.mjs';
import { DiscordAlerter } from './lib/alerts/discord.mjs';
import { buildSixHourBaseline } from './lib/baseline-sixhour.mjs';
import { getFreshnessPolicy } from './lib/freshness-policy.mjs';
import { buildSourceOpsSurface } from './lib/source-ops-runtime.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const RUNS_DIR = join(ROOT, 'runs');
const MEMORY_DIR = join(RUNS_DIR, 'memory');
const REVIEW_ACKS_PATH = join(RUNS_DIR, 'cluster-review-acks.json');
const AGENT_ANALYSIS_VALIDATION_SCRIPT = join(ROOT, 'scripts/agent-analysis-validation-summary.mjs');
const OPENSKY_STATE_PATH = join(ROOT, 'runs', 'cache', 'opensky-state.json');
const OPERATOR_SETTINGS_PATH = process.env.OPERATOR_SETTINGS_PATH || join(ROOT, 'runs', 'operator-settings.json');

// Ensure directories exist
for (const dir of [RUNS_DIR, MEMORY_DIR, join(MEMORY_DIR, 'cold')]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// === State ===
let currentData = null;    // Current synthesized dashboard data
let lastSweepTime = null;  // Timestamp of last sweep
let sweepStartedAt = null; // Timestamp when current/last sweep started
let sweepInProgress = false;
const startTime = Date.now();
const sseClients = new Set();
const selectionMemory = new Map();
const selectionMemoryTelemetry = {
  ttlExpired: 0,
  capacityEvicted: 0,
  manualCleared: 0,
  touchHits: 0,
  misses: 0,
};
const SELECTION_MEMORY_TTL_MS = 10 * 60 * 1000;
const SELECTION_MEMORY_MAX_ENTRIES = 100;
const REVIEW_ACK_TTL_MS = Math.max(1, Number(config.review?.ackTtlHours || 72)) * 60 * 60 * 1000;
const REVIEW_ACK_MAX_ENTRIES = Math.max(1, Number(config.review?.ackMaxEntries || 100));
const SWEEP_WATCHDOG_TIMEOUT_MS = Math.max(5 * 60 * 1000, Number(config.review?.sweepWatchdogTimeoutMinutes || Math.max(config.refreshIntervalMinutes * 2, 45)) * 60 * 1000);
const SWEEP_WATCHDOG_POLL_MS = Math.max(5 * 1000, Number(config.review?.sweepWatchdogPollSeconds || 30) * 1000);
const CLUSTER_REVIEW_STATE_KEY = 'cluster-review:regions';
const CLUSTER_REVIEW_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const CLUSTER_REVIEW_DECAY_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000;
const CLUSTER_PRESSURE_STATE_KEY = 'cluster-review:pressure';
const CLUSTER_PRESSURE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const CLUSTER_REPAIR_ARTIFACTS_STATE_KEY = 'cluster-review:repair-artifacts';
const CLUSTER_REPAIR_ARTIFACT_RETENTION_MS = Math.max(1, Number(config.review?.repairArtifactRetentionDays || 14)) * 24 * 60 * 60 * 1000;
const CLUSTER_REPAIR_ARTIFACT_MAX_ENTRIES = Math.max(1, Number(config.review?.repairArtifactMaxEntries || 50));
const reviewAcks = loadReviewAcks();
const sweepWatchdogTelemetry = {
  recoveryCount: 0,
  lastRecoveryAt: null,
  lastRecoveryReason: null,
  lastRecoveredSweepStartedAt: null,
  lastOverdueAt: null,
};

function loadJsonFile(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJsonFile(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function operatorSettingsDefaults() {
  return {
    version: 'operator-settings-store-v1',
    updatedAt: null,
    preferences: {
      layout: {
        visualsMode: 'full',
        mapMode: 'auto',
        displayMode: 'auto',
        defaultRegion: 'world',
        activeLayer: null,
      },
      sources: {
        enabledCategories: [],
        enabledSourceIds: [],
      },
      llm: {
        newsModeDefault: 'auto',
      },
      agentAnalysis: {
        detailLevel: 'standard',
      },
    },
  };
}

function normalizeOperatorSettings(input = {}) {
  const defaults = operatorSettingsDefaults();
  const layout = input?.preferences?.layout || {};
  const sources = input?.preferences?.sources || {};
  const llm = input?.preferences?.llm || {};
  const agentAnalysis = input?.preferences?.agentAnalysis || {};
  const allowedRegions = ['world', 'americas', 'europe', 'middleEast', 'asiaPacific', 'africa'];
  const allowedLayers = ['air', 'thermal', 'sdr', 'maritime', 'nuke', 'conflict', 'health', 'news', 'osint', 'space'];
  const allowedMapModes = ['auto', 'flat', 'globe'];
  const allowedDisplayModes = ['auto', 'narrow', 'desktop', 'wallboard'];
  const allowedVisualsModes = ['full', 'lite'];
  const allowedLlmModes = ['auto', 'off', 'force'];
  const allowedAnalysisDetails = ['standard', 'compact', 'expanded'];
  return {
    version: defaults.version,
    updatedAt: input?.updatedAt || null,
    preferences: {
      layout: {
        visualsMode: allowedVisualsModes.includes(layout.visualsMode) ? layout.visualsMode : defaults.preferences.layout.visualsMode,
        mapMode: allowedMapModes.includes(layout.mapMode) ? layout.mapMode : defaults.preferences.layout.mapMode,
        displayMode: allowedDisplayModes.includes(layout.displayMode) ? layout.displayMode : defaults.preferences.layout.displayMode,
        defaultRegion: allowedRegions.includes(layout.defaultRegion) ? layout.defaultRegion : defaults.preferences.layout.defaultRegion,
        activeLayer: allowedLayers.includes(layout.activeLayer) ? layout.activeLayer : null,
      },
      sources: {
        enabledCategories: Array.isArray(sources.enabledCategories) ? Array.from(new Set(sources.enabledCategories.map(value => String(value).trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)) : [],
        enabledSourceIds: Array.isArray(sources.enabledSourceIds) ? Array.from(new Set(sources.enabledSourceIds.map(value => String(value).trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)) : [],
      },
      llm: {
        newsModeDefault: allowedLlmModes.includes(llm.newsModeDefault) ? llm.newsModeDefault : defaults.preferences.llm.newsModeDefault,
      },
      agentAnalysis: {
        detailLevel: allowedAnalysisDetails.includes(agentAnalysis.detailLevel) ? agentAnalysis.detailLevel : defaults.preferences.agentAnalysis.detailLevel,
      },
    },
  };
}

function loadOperatorSettings() {
  return normalizeOperatorSettings(loadJsonFile(OPERATOR_SETTINGS_PATH, operatorSettingsDefaults()));
}

function saveOperatorSettings(input = {}) {
  const normalized = normalizeOperatorSettings(input);
  const persisted = {
    ...normalized,
    updatedAt: new Date().toISOString(),
  };
  saveJsonFile(OPERATOR_SETTINGS_PATH, persisted);
  return persisted;
}

function mergeOperatorSettingsPatch(patch = {}) {
  const current = loadOperatorSettings();
  const merged = {
    ...current,
    preferences: {
      layout: {
        ...current.preferences.layout,
        ...(patch?.preferences?.layout || {}),
      },
      sources: {
        ...current.preferences.sources,
        ...(patch?.preferences?.sources || {}),
      },
      llm: {
        ...current.preferences.llm,
        ...(patch?.preferences?.llm || {}),
      },
      agentAnalysis: {
        ...current.preferences.agentAnalysis,
        ...(patch?.preferences?.agentAnalysis || {}),
      },
    },
  };
  return saveOperatorSettings(merged);
}

function isLocalRequest(req) {
  const candidates = [
    req.ip,
    req.socket?.remoteAddress,
    req.connection?.remoteAddress,
  ].filter(Boolean).map(value => String(value));
  return candidates.some(value =>
    value === '127.0.0.1' ||
    value === '::1' ||
    value === '::ffff:127.0.0.1' ||
    value.startsWith('::ffff:127.0.0.1')
  );
}

function requireDebugAccess(req, res, next) {
  const exposure = config.debugEndpoints?.exposure || 'local-only';
  if (exposure === 'open') return next();
  if (isLocalRequest(req)) return next();
  return res.status(403).json({
    error: 'debug-endpoint-forbidden',
    detail: 'Debug and review endpoints are restricted to local requests unless DEBUG_ENDPOINT_EXPOSURE=open.',
  });
}

function readOpenSkyRuntimeState() {
  const raw = loadJsonFile(OPENSKY_STATE_PATH, null);
  if (!raw || typeof raw !== 'object') return null;
  return {
    cacheHits: Number.isInteger(raw.cacheHits) ? raw.cacheHits : 0,
    lastCacheHitAt: raw.lastCacheHitAt || null,
    staleCachePrunes: Number.isInteger(raw.staleCachePrunes) ? raw.staleCachePrunes : 0,
    lastStaleCachePrunedAt: raw.lastStaleCachePrunedAt || null,
    cooldownUntil: raw.cooldownUntil || null,
    last429At: raw.last429At || null,
    cursor: Number.isInteger(raw.cursor) ? raw.cursor : 0,
  };
}

function loadReviewAcks() {
  const raw = loadJsonFile(REVIEW_ACKS_PATH, []);
  const entries = Array.isArray(raw) ? raw : [];
  const map = new Map();
  const now = Date.now();
  for (const entry of entries) {
    if (!entry?.key || !entry?.expiresAt) continue;
    const expiresAt = Number(entry.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
    const createdAt = Number(entry.createdAt) || now;
    const lastAckedAt = Number(entry.lastAckedAt) || createdAt;
    map.set(entry.key, {
      ...entry,
      createdAt,
      expiresAt,
      firstAckedAt: Number(entry.firstAckedAt) || createdAt,
      lastAckedAt,
      ackCount: Math.max(1, Number(entry.ackCount) || 1),
      lastClearedAt: Number(entry.lastClearedAt) || null,
    });
  }
  return map;
}

function saveReviewAcks() {
  saveJsonFile(REVIEW_ACKS_PATH, Array.from(reviewAcks.values()).sort((a, b) => (a.lastAckedAt || a.createdAt || 0) - (b.lastAckedAt || b.createdAt || 0)));
}

function reviewAckKey(item = {}) {
  return `${String(item.region || 'unknown').trim().toLowerCase()}::${String(item.reason || 'unknown').trim().toLowerCase()}`;
}

function pruneReviewAcks() {
  const now = Date.now();
  let changed = false;
  for (const [key, value] of reviewAcks.entries()) {
    if (!value || Number(value.expiresAt) <= now) {
      reviewAcks.delete(key);
      changed = true;
    }
  }
  while (reviewAcks.size > REVIEW_ACK_MAX_ENTRIES) {
    const oldestKey = reviewAcks.keys().next().value;
    if (!oldestKey) break;
    reviewAcks.delete(oldestKey);
    changed = true;
  }
  if (changed) saveReviewAcks();
}

function formatReviewAckEntry(entry = {}) {
  return {
    ...entry,
    createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : null,
    firstAckedAt: entry.firstAckedAt ? new Date(entry.firstAckedAt).toISOString() : null,
    lastAckedAt: entry.lastAckedAt ? new Date(entry.lastAckedAt).toISOString() : null,
    expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString() : null,
    lastClearedAt: entry.lastClearedAt ? new Date(entry.lastClearedAt).toISOString() : null,
  };
}

function reviewAckSnapshot(limit = 20) {
  pruneReviewAcks();
  return Array.from(reviewAcks.values())
    .sort((a, b) => (b.lastAckedAt || b.createdAt || 0) - (a.lastAckedAt || a.createdAt || 0))
    .slice(0, Math.max(1, Math.min(Number(limit) || 20, 100)))
    .map(formatReviewAckEntry);
}

function reviewAckStats(limit = 5) {
  pruneReviewAcks();
  let nextExpiry = null;
  let totalAckCount = 0;
  let repeatAckCount = 0;
  for (const value of reviewAcks.values()) {
    if (!nextExpiry || value.expiresAt < nextExpiry) nextExpiry = value.expiresAt;
    totalAckCount += Math.max(1, Number(value.ackCount) || 1);
    if ((value.ackCount || 1) > 1) repeatAckCount += 1;
  }
  const recentDismissals = Array.from(reviewAcks.values())
    .sort((a, b) => (b.lastAckedAt || b.createdAt || 0) - (a.lastAckedAt || a.createdAt || 0))
    .slice(0, Math.max(1, Math.min(Number(limit) || 5, 20)))
    .map(formatReviewAckEntry);
  return {
    active: reviewAcks.size,
    maxEntries: REVIEW_ACK_MAX_ENTRIES,
    ttlMs: REVIEW_ACK_TTL_MS,
    nextExpiry: nextExpiry ? new Date(nextExpiry).toISOString() : null,
    totalAckCount,
    repeatAckCount,
    recentDismissalCount: recentDismissals.length,
    recentDismissals,
  };
}

function ackReviewItem(region = '', reason = '', note = '', options = {}) {
  const trimmedRegion = String(region || '').trim();
  const trimmedReason = String(reason || '').trim();
  if (!trimmedRegion || !trimmedReason) return null;
  pruneReviewAcks();
  const key = reviewAckKey({ region: trimmedRegion, reason: trimmedReason });
  const now = Date.now();
  const existing = reviewAcks.get(key);
  const requestedDurationMs = Number(options?.durationMs);
  const durationMs = Number.isFinite(requestedDurationMs) && requestedDurationMs > 0 ? requestedDurationMs : REVIEW_ACK_TTL_MS;
  const action = String(options?.action || '').trim() || 'ack';
  const entry = {
    key,
    region: trimmedRegion,
    reason: trimmedReason,
    note: String(note || '').trim() || existing?.note || null,
    createdAt: existing?.createdAt || now,
    firstAckedAt: existing?.firstAckedAt || existing?.createdAt || now,
    lastAckedAt: now,
    ackCount: Math.max(1, Number(existing?.ackCount) || 1) + (existing ? 1 : 0),
    expiresAt: now + durationMs,
    durationMs,
    action,
    lastClearedAt: existing?.lastClearedAt || null,
  };
  reviewAcks.delete(key);
  reviewAcks.set(key, entry);
  pruneReviewAcks();
  saveReviewAcks();
  return entry;
}

function clearReviewAck(region = '', reason = '') {
  const key = reviewAckKey({ region, reason });
  const existing = reviewAcks.get(key);
  const existed = reviewAcks.delete(key);
  if (existed && existing) saveReviewAcks();
  return existed;
}

function annotateReview(review = {}) {
  pruneReviewAcks();
  const reviewItems = Array.isArray(review.reviewItems) ? review.reviewItems : [];
  const activeItems = [];
  const dismissedItems = [];
  for (const item of reviewItems) {
    const ack = reviewAcks.get(reviewAckKey(item));
    const annotated = ack
      ? {
          ...item,
          dismissed: true,
          ack: {
            note: ack.note,
            createdAt: new Date(ack.createdAt).toISOString(),
            expiresAt: new Date(ack.expiresAt).toISOString(),
          },
        }
      : { ...item, dismissed: false, ack: null };
    if (ack) dismissedItems.push(annotated);
    else activeItems.push(annotated);
  }
  const ackSummary = reviewAckStats();
  return {
    ...review,
    reviewItems: activeItems,
    dismissedItems,
    dismissedCount: dismissedItems.length,
    activeCount: activeItems.length,
    ackSummary,
    recentDismissals: ackSummary.recentDismissals,
  };
}

function getClusterReviewStatsState() {
  const state = memory.getSignalState(CLUSTER_REVIEW_STATE_KEY);
  return state && typeof state === 'object' ? state : { regions: {}, updatedAt: null };
}

function pruneClusterReviewRegions(regions = {}, now = Date.now()) {
  const pruned = {};
  for (const [region, stats] of Object.entries(regions || {})) {
    const lastSeenAt = new Date(stats?.lastSeenAt || stats?.lastFailureAt || stats?.lastSuccessAt || 0).getTime();
    if (!lastSeenAt || (now - lastSeenAt) > CLUSTER_REVIEW_RETENTION_MS) continue;
    pruned[region] = stats;
  }
  return pruned;
}

function summarizeClusterReviewStats(state = getClusterReviewStatsState()) {
  const now = Date.now();
  const regions = pruneClusterReviewRegions(state?.regions || {}, now);
  const entries = Object.entries(regions).map(([region, stats]) => {
    const failureWindow = Number(stats?.failureWindow || 0);
    const successWindow = Number(stats?.successWindow || 0);
    const lastWindowAtMs = new Date(stats?.lastWindowAt || stats?.lastSeenAt || 0).getTime();
    const decayFactor = lastWindowAtMs && CLUSTER_REVIEW_DECAY_HALF_LIFE_MS > 0
      ? Math.pow(0.5, Math.max(0, now - lastWindowAtMs) / CLUSTER_REVIEW_DECAY_HALF_LIFE_MS)
      : 1;
    const decayedFailureWindow = Number((failureWindow * decayFactor).toFixed(3));
    const decayedSuccessWindow = Number((successWindow * decayFactor).toFixed(3));
    const windowTotal = decayedFailureWindow + decayedSuccessWindow;
    const decayedFailureRate = windowTotal > 0 ? Number((decayedFailureWindow / windowTotal).toFixed(3)) : 0;
    return {
      region,
      ...stats,
      decayedFailureWindow,
      decayedSuccessWindow,
      decayedFailureRate,
      windowTotal: Number(windowTotal.toFixed(3)),
    };
  });
  const recentFailureCutoff = now - (24 * 60 * 60 * 1000);
  const topRegions = entries
    .filter(entry => entry.failureCount || entry.consecutiveFailures || entry.lastFailureAt || entry.decayedFailureWindow > 0.05)
    .sort((a, b) => (b.decayedFailureRate || 0) - (a.decayedFailureRate || 0) || (b.decayedFailureWindow || 0) - (a.decayedFailureWindow || 0) || (b.consecutiveFailures || 0) - (a.consecutiveFailures || 0) || String(a.region).localeCompare(String(b.region)))
    .slice(0, 8)
    .map(entry => ({
      region: entry.region,
      totalSeen: entry.totalSeen || 0,
      failureCount: entry.failureCount || 0,
      successCount: entry.successCount || 0,
      consecutiveFailures: entry.consecutiveFailures || 0,
      lastStatus: entry.lastStatus || null,
      lastReason: entry.lastReason || null,
      lastSeenAt: entry.lastSeenAt || null,
      lastFailureAt: entry.lastFailureAt || null,
      lastSuccessAt: entry.lastSuccessAt || null,
      lastWindowAt: entry.lastWindowAt || null,
      maxItemCount: entry.maxItemCount || 0,
      reasons: entry.reasons || {},
      failureWindow: Number((entry.failureWindow || 0).toFixed ? (entry.failureWindow || 0).toFixed(3) : entry.failureWindow || 0),
      successWindow: Number((entry.successWindow || 0).toFixed ? (entry.successWindow || 0).toFixed(3) : entry.successWindow || 0),
      decayedFailureWindow: entry.decayedFailureWindow,
      decayedSuccessWindow: entry.decayedSuccessWindow,
      decayedFailureRate: entry.decayedFailureRate,
      chronic: (entry.consecutiveFailures || 0) >= 2 || (entry.decayedFailureRate || 0) >= 0.6,
      recovering: (entry.successCount || 0) > 0 && (entry.decayedFailureRate || 0) < 0.4,
      recentlyFailing: entry.lastFailureAt ? new Date(entry.lastFailureAt).getTime() >= recentFailureCutoff : false,
    }));
  return {
    trackedRegionCount: entries.length,
    chronicFailureCount: topRegions.filter(entry => entry.chronic).length,
    recentFailureCount: topRegions.filter(entry => entry.recentlyFailing).length,
    recoveringRegionCount: topRegions.filter(entry => entry.recovering).length,
    decayHalfLifeHours: CLUSTER_REVIEW_DECAY_HALF_LIFE_MS / (60 * 60 * 1000),
    retentionDays: CLUSTER_REVIEW_RETENTION_MS / (24 * 60 * 60 * 1000),
    updatedAt: state?.updatedAt || null,
    topRegions,
  };
}

function recordClusterReviewStats(snapshot = {}) {
  const perRegion = Array.isArray(snapshot.newsLlmDebug?.perRegion) ? snapshot.newsLlmDebug.perRegion : [];
  if (!perRegion.length) return summarizeClusterReviewStats();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const current = getClusterReviewStatsState();
  const regions = pruneClusterReviewRegions({ ...(current.regions || {}) });
  for (const entry of perRegion) {
    const region = String(entry?.region || '').trim();
    if (!region) continue;
    const stats = regions[region] && typeof regions[region] === 'object' ? { ...regions[region] } : {
      firstSeenAt: nowIso,
      lastSeenAt: null,
      lastFailureAt: null,
      lastSuccessAt: null,
      lastStatus: null,
      lastReason: null,
      totalSeen: 0,
      failureCount: 0,
      successCount: 0,
      consecutiveFailures: 0,
      maxItemCount: 0,
      reasons: {},
      failureWindow: 0,
      successWindow: 0,
      lastWindowAt: nowIso,
    };
    const lastWindowAtMs = new Date(stats.lastWindowAt || stats.lastSeenAt || 0).getTime();
    const decayFactor = lastWindowAtMs && CLUSTER_REVIEW_DECAY_HALF_LIFE_MS > 0
      ? Math.pow(0.5, Math.max(0, now - lastWindowAtMs) / CLUSTER_REVIEW_DECAY_HALF_LIFE_MS)
      : 1;
    stats.failureWindow = Number(((Number(stats.failureWindow || 0)) * decayFactor).toFixed(6));
    stats.successWindow = Number(((Number(stats.successWindow || 0)) * decayFactor).toFixed(6));
    stats.lastWindowAt = nowIso;
    stats.lastSeenAt = nowIso;
    stats.lastStatus = entry.status || null;
    stats.lastReason = entry.reason || null;
    stats.totalSeen = (stats.totalSeen || 0) + 1;
    stats.maxItemCount = Math.max(stats.maxItemCount || 0, entry.itemCount || 0);
    if (entry.status === 'heuristic-fallback') {
      stats.failureCount = (stats.failureCount || 0) + 1;
      stats.consecutiveFailures = (stats.consecutiveFailures || 0) + 1;
      stats.lastFailureAt = nowIso;
      stats.failureWindow = Number((stats.failureWindow + 1).toFixed(6));
      const reason = entry.reason || 'unknown';
      stats.reasons = stats.reasons && typeof stats.reasons === 'object' ? stats.reasons : {};
      stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
    } else {
      stats.successCount = (stats.successCount || 0) + 1;
      stats.consecutiveFailures = 0;
      stats.lastSuccessAt = nowIso;
      stats.successWindow = Number((stats.successWindow + 1).toFixed(6));
    }
    regions[region] = stats;
  }
  const nextState = {
    updatedAt: nowIso,
    regions: pruneClusterReviewRegions(regions, Date.now()),
  };
  memory.setSignalState(CLUSTER_REVIEW_STATE_KEY, nextState);
  return summarizeClusterReviewStats(nextState);
}

function attachClusterReviewStats(review = {}) {
  const statsSummary = summarizeClusterReviewStats();
  const pressureSummary = summarizeClusterPressureStats();
  const byRegion = new Map((statsSummary.topRegions || []).map(entry => [entry.region, entry]));
  const pressureByRegion = new Map((pressureSummary.topRegions || []).map(entry => [entry.region, entry]));
  const decorate = item => ({
    ...item,
    persistent: byRegion.get(item.region) || null,
    pressure: pressureByRegion.get(item.region) || null,
  });
  return {
    ...review,
    reviewItems: Array.isArray(review.reviewItems) ? review.reviewItems.map(decorate) : [],
    dismissedItems: Array.isArray(review.dismissedItems) ? review.dismissedItems.map(decorate) : [],
    stats: statsSummary,
    pressure: pressureSummary,
  };
}

function buildOperatorReviewQueue(review = {}, { maxItems = 5, quality = null } = {}) {
  const items = Array.isArray(review.reviewItems) ? review.reviewItems : [];
  const metrics = quality?.reviewMetrics || {};
  const stats = review?.stats || {};
  const pressure = review?.pressure || {};
  const ackSummary = review?.ackSummary || reviewAckStats();
  const duplicateByRegion = new Map();
  for (const entry of Array.isArray(metrics.suspiciousNearDuplicates) ? metrics.suspiciousNearDuplicates : []) {
    const region = entry?.region || 'Unknown';
    duplicateByRegion.set(region, Math.max(duplicateByRegion.get(region) || 0, Number(entry?.similarity || 0)));
  }
  const splitByRegion = new Map((Array.isArray(metrics.topSplitRegions) ? metrics.topSplitRegions : []).map(entry => [entry.region, entry.count || 0]));
  const scored = items.map(item => {
    const region = item?.region || 'Unknown';
    const pressureScore = Number(item?.pressure?.pressureScore || 0);
    const duplicateScore = Math.round((duplicateByRegion.get(region) || 0) * 100);
    const splitCount = Number(splitByRegion.get(region) || 0);
    const consecutiveFailures = Number(item?.persistent?.consecutiveFailures || 0);
    const itemCount = Number(item?.itemCount || 0);
    const chronicBonus = item?.persistent?.chronic ? 25 : 0;
    const severityBonus = item?.severity === 'high' ? 20 : item?.severity === 'medium' ? 10 : 0;
    const priorityScore = pressureScore + duplicateScore + (splitCount * 12) + (consecutiveFailures * 3) + (itemCount * 2) + chronicBonus + severityBonus;
    const drivers = [];
    if (pressureScore > 0) drivers.push(`pressure ${pressureScore}`);
    if (duplicateScore > 0) drivers.push(`near-duplicate ${duplicateScore}`);
    if (splitCount > 0) drivers.push(`split-pattern ${splitCount}`);
    if (consecutiveFailures > 0) drivers.push(`repeat-fail ${consecutiveFailures}`);
    return {
      ...item,
      priorityScore,
      drivers,
      duplicateScore,
      splitCount,
      pressureScore,
    };
  }).sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0) || (b.itemCount || 0) - (a.itemCount || 0) || String(a.region || '').localeCompare(String(b.region || '')));
  const bounded = scored.slice(0, Math.max(1, maxItems));
  const reasonCounts = new Map();
  for (const item of items) {
    const reason = item?.reason || 'unknown';
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  }
  const topReasons = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 4)
    .map(([reason, count]) => ({ reason, count }));
  const hasElevatedMetrics = Boolean(
    (stats?.chronicFailureCount || 0) > 0 ||
    (stats?.recentFailureCount || 0) > 0 ||
    (metrics?.lowConfidenceCount || 0) > 0 ||
    (metrics?.suspiciousNearDuplicateCount || 0) > 0 ||
    (pressure?.pressuredRegionCount || 0) > 0
  );
  const state = items.length > 0
    ? 'active'
    : hasElevatedMetrics
      ? 'empty_elevated_metrics'
      : 'empty_clear';
  const emptyReason = state === 'empty_elevated_metrics'
    ? 'No active review items, but review metrics remain elevated from recent or background conditions.'
    : 'No active review items and no elevated review pressure is currently visible.';
  return {
    state,
    totalItems: items.length,
    visibleItems: bounded.length,
    maxItems: Math.max(1, maxItems),
    hasMore: items.length > Math.max(1, maxItems),
    bounded: true,
    hasElevatedMetrics,
    emptyReason: items.length ? null : emptyReason,
    summary: items.length
      ? `${items.length} active review item${items.length === 1 ? '' : 's'} awaiting operator triage.`
      : emptyReason,
    topReasons,
    ackSummary: {
      active: ackSummary?.active || 0,
      repeatAckCount: ackSummary?.repeatAckCount || 0,
      nextExpiry: ackSummary?.nextExpiry || null,
      recentDismissalCount: ackSummary?.recentDismissalCount || 0,
    },
    metrics: {
      chronicFailureCount: stats?.chronicFailureCount || 0,
      recentFailureCount: stats?.recentFailureCount || 0,
      lowConfidenceCount: metrics?.lowConfidenceCount || 0,
      suspiciousNearDuplicateCount: metrics?.suspiciousNearDuplicateCount || 0,
      pressuredRegionCount: pressure?.pressuredRegionCount || 0,
    },
    items: bounded.map(item => {
      const region = item.region || null;
      const reason = item.reason || 'unknown';
      const artifactRegion = encodeURIComponent(region || '');
      const artifactReason = encodeURIComponent(reason);
      return {
        region,
        reason,
        severity: item.severity || 'medium',
        itemCount: item.itemCount || 0,
        retried: Boolean(item.retried),
        repairAttempted: Boolean(item.repairAttempted),
        chronic: Boolean(item.persistent?.chronic),
        consecutiveFailures: item.persistent?.consecutiveFailures || 0,
        lastStatus: item.persistent?.lastStatus || item.status || null,
        priorityScore: item.priorityScore || 0,
        priorityDrivers: item.drivers || [],
        pressureScore: item.pressureScore || 0,
        duplicateScore: item.duplicateScore || 0,
        splitCount: item.splitCount || 0,
        suggestedAction: reason === 'no-json-match'
          ? 'Inspect response shape and retry/repair behavior.'
          : reason === 'shape-mismatch'
            ? 'Review schema mismatch and fallback parsing path.'
            : 'Inspect clustered output and operator review evidence.',
        actions: [
          {
            id: 'ack',
            label: 'Ack',
            method: 'POST',
            href: `/api/brief/news/review/ack?region=${artifactRegion}&reason=${artifactReason}`,
            intent: 'dismiss',
            detail: 'Dismiss this queue item until the normal ack TTL expires.',
          },
          {
            id: 'snooze',
            label: 'Snooze 24h',
            method: 'POST',
            href: `/api/brief/news/review/snooze?region=${artifactRegion}&reason=${artifactReason}&hours=24`,
            intent: 'snooze',
            detail: 'Dismiss this queue item for 24 hours, then automatically return it if still present.',
          },
          {
            id: 'artifacts',
            label: 'Artifacts',
            method: 'GET',
            href: `/api/brief/news/review/artifacts?region=${artifactRegion}&reason=${artifactReason}`,
            intent: 'inspect',
            detail: 'Open recent repair artifacts for this region and reason.',
          },
        ],
      };
    }),
  };
}

function getClusterPressureStatsState() {
  const state = memory.getSignalState(CLUSTER_PRESSURE_STATE_KEY);
  return state && typeof state === 'object' ? state : { updatedAt: null, regions: {} };
}

function pruneClusterPressureRegions(regions = {}, now = Date.now()) {
  const pruned = {};
  for (const [region, stats] of Object.entries(regions || {})) {
    const lastSeenAt = new Date(stats?.lastSeenAt || 0).getTime();
    if (!lastSeenAt || (now - lastSeenAt) > CLUSTER_PRESSURE_RETENTION_MS) continue;
    pruned[region] = stats;
  }
  return pruned;
}

function summarizeClusterPressureStats(state = getClusterPressureStatsState()) {
  const now = Date.now();
  const regions = pruneClusterPressureRegions(state?.regions || {}, now);
  const entries = Object.entries(regions).map(([region, stats]) => ({ region, ...stats }));
  const topRegions = entries
    .filter(entry => (entry.retryCount || 0) > 0 || (entry.backoffCount || 0) > 0 || (entry.tunedCount || 0) > 0 || (entry.repairAttemptCount || 0) > 0)
    .sort((a, b) => (b.retryCount || 0) - (a.retryCount || 0) || (b.backoffCount || 0) - (a.backoffCount || 0) || (b.tunedCount || 0) - (a.tunedCount || 0) || String(a.region).localeCompare(String(b.region)))
    .slice(0, 8)
    .map(entry => ({
      region: entry.region,
      totalSeen: entry.totalSeen || 0,
      tunedCount: entry.tunedCount || 0,
      retryCount: entry.retryCount || 0,
      backoffCount: entry.backoffCount || 0,
      repairAttemptCount: entry.repairAttemptCount || 0,
      heuristicFallbackCount: entry.heuristicFallbackCount || 0,
      successCount: entry.successCount || 0,
      lastStatus: entry.lastStatus || null,
      lastReason: entry.lastReason || null,
      lastSeenAt: entry.lastSeenAt || null,
      lastTunedAt: entry.lastTunedAt || null,
      lastRetryAt: entry.lastRetryAt || null,
      lastBackoffAt: entry.lastBackoffAt || null,
      maxRetriesConfigured: entry.maxRetriesConfigured || 0,
      maxRepairTimeout: entry.maxRepairTimeout || 0,
      currentTuning: entry.currentTuning || { maxRetries: 0, repairTimeout: 45000 },
      pressureScore: (entry.retryCount || 0) + (entry.backoffCount || 0) + (entry.repairAttemptCount || 0),
    }));
  return {
    trackedRegionCount: entries.length,
    pressuredRegionCount: topRegions.length,
    totalRetries: entries.reduce((sum, entry) => sum + (entry.retryCount || 0), 0),
    totalBackoffs: entries.reduce((sum, entry) => sum + (entry.backoffCount || 0), 0),
    totalTunedRegions: entries.reduce((sum, entry) => sum + ((entry.tunedCount || 0) > 0 ? 1 : 0), 0),
    totalRepairAttempts: entries.reduce((sum, entry) => sum + (entry.repairAttemptCount || 0), 0),
    retentionDays: CLUSTER_PRESSURE_RETENTION_MS / (24 * 60 * 60 * 1000),
    updatedAt: state?.updatedAt || null,
    topRegions,
  };
}

function recordClusterPressureStats(snapshot = {}) {
  const perRegion = Array.isArray(snapshot.newsLlmDebug?.perRegion) ? snapshot.newsLlmDebug.perRegion : [];
  if (!perRegion.length) return summarizeClusterPressureStats();
  const nowIso = new Date().toISOString();
  const current = getClusterPressureStatsState();
  const regions = pruneClusterPressureRegions({ ...(current.regions || {}) });
  for (const entry of perRegion) {
    const region = String(entry?.region || '').trim();
    if (!region) continue;
    const tuning = entry?.tuning && typeof entry.tuning === 'object' ? entry.tuning : {};
    const stats = regions[region] && typeof regions[region] === 'object' ? { ...regions[region] } : {
      firstSeenAt: nowIso,
      lastSeenAt: null,
      lastTunedAt: null,
      lastRetryAt: null,
      lastBackoffAt: null,
      lastStatus: null,
      lastReason: null,
      totalSeen: 0,
      tunedCount: 0,
      retryCount: 0,
      backoffCount: 0,
      repairAttemptCount: 0,
      heuristicFallbackCount: 0,
      successCount: 0,
      maxRetriesConfigured: 0,
      maxRepairTimeout: 0,
      currentTuning: { maxRetries: 0, repairTimeout: 45000 },
    };
    stats.lastSeenAt = nowIso;
    stats.lastStatus = entry.status || null;
    stats.lastReason = entry.reason || null;
    stats.totalSeen = (stats.totalSeen || 0) + 1;
    stats.currentTuning = {
      maxRetries: Number(tuning.maxRetries || 0),
      repairTimeout: Number(tuning.repairTimeout || 45000),
    };
    stats.maxRetriesConfigured = Math.max(stats.maxRetriesConfigured || 0, Number(tuning.maxRetries || 0));
    stats.maxRepairTimeout = Math.max(stats.maxRepairTimeout || 0, Number(tuning.repairTimeout || 45000));
    if ((tuning.maxRetries || 0) > 0 || Number(tuning.repairTimeout || 45000) !== 45000) {
      stats.tunedCount = (stats.tunedCount || 0) + 1;
      stats.lastTunedAt = nowIso;
    }
    if (entry.retried) {
      stats.retryCount = (stats.retryCount || 0) + 1;
      stats.lastRetryAt = nowIso;
      stats.backoffCount = (stats.backoffCount || 0) + 1;
      stats.lastBackoffAt = nowIso;
    }
    if (entry.repairAttempted) stats.repairAttemptCount = (stats.repairAttemptCount || 0) + 1;
    if (entry.status === 'heuristic-fallback') stats.heuristicFallbackCount = (stats.heuristicFallbackCount || 0) + 1;
    else stats.successCount = (stats.successCount || 0) + 1;
    regions[region] = stats;
  }
  const nextState = {
    updatedAt: nowIso,
    regions: pruneClusterPressureRegions(regions, Date.now()),
  };
  memory.setSignalState(CLUSTER_PRESSURE_STATE_KEY, nextState);
  return summarizeClusterPressureStats(nextState);
}

function attachClusterPressureStats(llm = {}) {
  const statsSummary = summarizeClusterPressureStats();
  const byRegion = new Map((statsSummary.topRegions || []).map(entry => [entry.region, entry]));
  return {
    ...llm,
    perRegion: Array.isArray(llm.perRegion) ? llm.perRegion.map(entry => ({
      ...entry,
      persistent: byRegion.get(entry.region) || null,
    })) : [],
    persistentPressure: statsSummary,
  };
}

function getClusterRepairArtifactsState() {
  const state = memory.getSignalState(CLUSTER_REPAIR_ARTIFACTS_STATE_KEY);
  return Array.isArray(state) ? state : [];
}

function pruneClusterRepairArtifacts(artifacts = [], now = Date.now()) {
  return (Array.isArray(artifacts) ? artifacts : [])
    .filter(entry => {
      const ts = new Date(entry?.recordedAt || 0).getTime();
      return ts && (now - ts) <= CLUSTER_REPAIR_ARTIFACT_RETENTION_MS;
    })
    .slice(-CLUSTER_REPAIR_ARTIFACT_MAX_ENTRIES);
}

function summarizeClusterRepairArtifacts(artifacts = getClusterRepairArtifactsState()) {
  const pruned = pruneClusterRepairArtifacts(artifacts);
  const byReason = {};
  const byRegion = {};
  for (const entry of pruned) {
    const reason = entry.reason || 'unknown';
    const region = entry.region || 'unknown';
    byReason[reason] = (byReason[reason] || 0) + 1;
    byRegion[region] = (byRegion[region] || 0) + 1;
  }
  return {
    totalArtifacts: pruned.length,
    retentionDays: CLUSTER_REPAIR_ARTIFACT_RETENTION_MS / (24 * 60 * 60 * 1000),
    maxEntries: CLUSTER_REPAIR_ARTIFACT_MAX_ENTRIES,
    topReasons: Object.entries(byReason).map(([reason, count]) => ({ reason, count })).sort((a,b)=>b.count-a.count).slice(0,6),
    topRegions: Object.entries(byRegion).map(([region, count]) => ({ region, count })).sort((a,b)=>b.count-a.count).slice(0,6),
    items: pruned.slice(-12).reverse(),
  };
}

function recordClusterRepairArtifacts(snapshot = {}) {
  const artifacts = Array.isArray(snapshot.newsLlmDebug?.repairArtifacts) ? snapshot.newsLlmDebug.repairArtifacts : [];
  const current = getClusterRepairArtifactsState();
  if (!artifacts.length) {
    const pruned = pruneClusterRepairArtifacts(current);
    if (pruned.length !== current.length) memory.setSignalState(CLUSTER_REPAIR_ARTIFACTS_STATE_KEY, pruned);
    return summarizeClusterRepairArtifacts(pruned);
  }
  const nowIso = new Date().toISOString();
  const merged = pruneClusterRepairArtifacts([
    ...current,
    ...artifacts.map(entry => ({ ...entry, recordedAt: nowIso })),
  ]);
  memory.setSignalState(CLUSTER_REPAIR_ARTIFACTS_STATE_KEY, merged);
  return summarizeClusterRepairArtifacts(merged);
}

function signalId(kind = 'signal', item = {}, index = 0) {
  const raw = `${kind}:${item.signal || item.category || 'item'}:${index}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return raw || `${kind}-${index}`;
}

function attachSignalIds(kind = 'signal', list = []) {
  return list.map((item, index) => ({ ...item, id: item.id || signalId(kind, item, index) }));
}

function formatSignalTrustLabel(item = {}) {
  const labels = [];
  if (item.sourceHealth) labels.push(item.sourceHealth);
  if (item.evidenceSource) labels.push(item.evidenceSource);
  return labels.length ? ` {${labels.join(' · ')}}` : '';
}

function signalProvenanceLabel(item = {}) {
  const sourceHealth = String(item.sourceHealth || '').toLowerCase();
  const evidenceSource = String(item.evidenceSource || '').toLowerCase();
  if (sourceHealth === 'hard-data') return 'hard-data corroboration';
  if (sourceHealth === 'clean' && evidenceSource.includes('mixed')) return 'multi-source corroboration';
  if (sourceHealth === 'clean') return 'clean source corroboration';
  if (sourceHealth === 'degraded-air-ok' || sourceHealth === 'degraded') return 'degraded but partially corroborated';
  if (sourceHealth === 'single-source') return 'single-source signal';
  if (sourceHealth === 'osint-only') return 'osint-only signal';
  if (sourceHealth === 'air-missing') return 'air picture missing';
  if (evidenceSource.includes('telegram')) return 'telegram-led osint';
  if (evidenceSource.includes('news')) return 'news-led evidence';
  return sourceHealth || evidenceSource ? `${sourceHealth || 'unknown'} via ${evidenceSource || 'mixed'}` : 'unknown provenance';
}

function summarizeEvidenceProvenance(snapshot = {}) {
  const evidence = snapshot.evidenceSummary || {};
  const counts = evidence.counts || {};
  const labels = [];
  if ((counts.carriedForward || 0) > 0) labels.push(`${counts.carriedForward} carried-forward`);
  if ((counts.cached || 0) > 0) labels.push(`${counts.cached} cached/fallback`);
  if ((counts.degraded || 0) > 0) labels.push(`${counts.degraded} degraded`);
  if ((counts.failedSources || 0) > 0) labels.push(`${counts.failedSources} failed sources`);
  return labels.length ? labels.join(', ') : 'mostly live evidence';
}

function trustPhrase(item = {}) {
  const sourceHealth = item.sourceHealth || 'unknown';
  const evidenceSource = item.evidenceSource || 'mixed';
  return `${sourceHealth} via ${evidenceSource}`;
}

function touchSelection(contextKey = '', remembered = null) {
  if (!contextKey || !remembered) return remembered;
  const touched = {
    ...remembered,
    lastAccessAt: Date.now(),
  };
  selectionMemory.delete(contextKey);
  selectionMemory.set(contextKey, touched);
  selectionMemoryTelemetry.touchHits += 1;
  return touched;
}

function pruneSelectionMemory() {
  const now = Date.now();
  let pruned = 0;
  for (const [key, value] of selectionMemory.entries()) {
    if (!value || value.expiresAt <= now) {
      selectionMemory.delete(key);
      selectionMemoryTelemetry.ttlExpired += 1;
      pruned += 1;
    }
  }
  while (selectionMemory.size > SELECTION_MEMORY_MAX_ENTRIES) {
    const lruKey = selectionMemory.keys().next().value;
    if (!lruKey) break;
    selectionMemory.delete(lruKey);
    selectionMemoryTelemetry.capacityEvicted += 1;
    pruned += 1;
  }
  return pruned;
}

function resetSelectionMemoryTelemetry() {
  selectionMemoryTelemetry.ttlExpired = 0;
  selectionMemoryTelemetry.capacityEvicted = 0;
  selectionMemoryTelemetry.manualCleared = 0;
  selectionMemoryTelemetry.touchHits = 0;
  selectionMemoryTelemetry.misses = 0;
}

function selectionMemorySnapshot(limit = 5) {
  pruneSelectionMemory();
  return Array.from(selectionMemory.entries())
    .slice(-Math.max(1, Math.min(Number(limit) || 5, 20)))
    .map(([context, value]) => ({
      context,
      kind: value.kind,
      index: value.index,
      id: value.id,
      expiresAt: new Date(value.expiresAt).toISOString(),
      lastAccessAt: value.lastAccessAt ? new Date(value.lastAccessAt).toISOString() : null,
    }));
}

function selectionMemoryStats() {
  pruneSelectionMemory();
  let nextExpiry = null;
  for (const value of selectionMemory.values()) {
    if (!nextExpiry || value.expiresAt < nextExpiry) nextExpiry = value.expiresAt;
  }
  const oldestKey = selectionMemory.keys().next().value || null;
  const newestKey = selectionMemory.size ? Array.from(selectionMemory.keys()).at(-1) : null;
  return {
    activeContexts: selectionMemory.size,
    maxEntries: SELECTION_MEMORY_MAX_ENTRIES,
    ttlMs: SELECTION_MEMORY_TTL_MS,
    nextExpiry: nextExpiry ? new Date(nextExpiry).toISOString() : null,
    oldestContext: oldestKey,
    newestContext: newestKey,
    telemetry: { ...selectionMemoryTelemetry },
  };
}

function rememberSelection(contextKey = '', selection = null) {
  if (!contextKey || !selection?.id) return;
  pruneSelectionMemory();
  selectionMemory.delete(contextKey);
  selectionMemory.set(contextKey, {
    ...selection,
    expiresAt: Date.now() + SELECTION_MEMORY_TTL_MS,
    lastAccessAt: Date.now(),
  });
  pruneSelectionMemory();
}

function recallSelection(contextKey = '') {
  if (!contextKey) return null;
  const remembered = selectionMemory.get(contextKey);
  if (!remembered) {
    selectionMemoryTelemetry.misses += 1;
    return null;
  }
  if (remembered.expiresAt <= Date.now()) {
    selectionMemory.delete(contextKey);
    selectionMemoryTelemetry.ttlExpired += 1;
    selectionMemoryTelemetry.misses += 1;
    return null;
  }
  return touchSelection(contextKey, remembered);
}

function clearSelection(contextKey = '') {
  if (!contextKey) return false;
  pruneSelectionMemory();
  const cleared = selectionMemory.delete(contextKey);
  if (cleared) selectionMemoryTelemetry.manualCleared += 1;
  return cleared;
}

function selectionMeta(contextKey = '') {
  pruneSelectionMemory();
  const remembered = recallSelection(contextKey);
  if (!remembered) return null;
  return {
    kind: remembered.kind,
    index: remembered.index,
    id: remembered.id,
    expiresAt: new Date(remembered.expiresAt).toISOString(),
    lastAccessAt: remembered.lastAccessAt ? new Date(remembered.lastAccessAt).toISOString() : null,
    ttlMs: Math.max(0, remembered.expiresAt - Date.now()),
  };
}

function getSignalList(snapshot = {}, kind = 'corroborated') {
  return attachSignalIds(
    kind,
    kind === 'suspect' ? (snapshot.suspectSignals || []) : (snapshot.corroboratedSignals || [])
  );
}

function resolveSignalRef(snapshot = {}, ref = '', preferredKind = 'corroborated', contextKey = '') {
  const normalized = String(ref || '').trim().toLowerCase();
  const corroborated = getSignalList(snapshot, 'corroborated');
  const suspects = getSignalList(snapshot, 'suspect');
  const combined = [...corroborated, ...suspects];

  if (!normalized) return { kind: preferredKind, index: 0, id: null };
  if (normalized === 'top-suspect' || normalized === 'suspect-one' || normalized === 'the-suspect-one') {
    return { kind: 'suspect', index: 0, id: suspects[0]?.id || null };
  }
  if (normalized === 'top-corroborated' || normalized === 'corroborated-one' || normalized === 'the-corroborated-one') {
    return { kind: 'corroborated', index: 0, id: corroborated[0]?.id || null };
  }
  if (normalized === 'that-one' || normalized === 'top-one') {
    const remembered = recallSelection(contextKey);
    if (remembered?.id) return { kind: remembered.kind || preferredKind, index: remembered.index || 0, id: remembered.id };
    return { kind: preferredKind, index: 0, id: getSignalList(snapshot, preferredKind)[0]?.id || null };
  }
  const itemMatch = normalized.match(/^item-(\d+)$/);
  if (itemMatch) {
    const n = Math.max(0, Number.parseInt(itemMatch[1], 10) - 1);
    const list = getSignalList(snapshot, preferredKind);
    return { kind: preferredKind, index: n, id: list[n]?.id || null };
  }
  const direct = combined.find(item => item.id === normalized);
  if (direct) {
    return {
      kind: suspects.some(item => item.id === normalized) ? 'suspect' : 'corroborated',
      index: 0,
      id: direct.id,
    };
  }
  return { kind: preferredKind, index: 0, id: null };
}

function getSignalSelection(snapshot = {}, kind = 'corroborated', index = 0, id = null) {
  const list = getSignalList(snapshot, kind);
  if (id) return list.find(item => item.id === id) || null;
  return list[index] || null;
}

function buildIMessengerDrilldown(snapshot = {}, { kind = 'corroborated', action = 'why', index = 0, id = null } = {}) {
  const item = getSignalSelection(snapshot, kind, index, id);
  if (!item) return `No ${kind} signal available.`;

  if (action === 'sources') {
    return [
      `${item.signal}`,
      `Sources: ${item.evidenceSource || 'mixed'}`,
      `Trust: ${item.sourceHealth || 'unknown'}`,
      item.freshestTs ? `Freshest evidence: ${item.freshestTs}` : null,
    ].filter(Boolean).join('\n');
  }

  if (action === 'expand') {
    return [
      `${item.signal} (${item.confidence})`,
      `Trust: ${trustPhrase(item)}`,
      `Why it matters: ${item.reason || 'No explanation available.'}`,
      item.region ? `Region: ${item.region}` : null,
      item.urgentPosts != null ? `Urgent posts: ${item.urgentPosts}` : null,
      item.airTotal != null ? `Air activity: ${item.airTotal}` : null,
      item.cpm != null ? `CPM: ${item.cpm}` : null,
      item.readings != null ? `Readings: ${item.readings}` : null,
    ].filter(Boolean).join('\n');
  }

  return [
    `${item.signal}`,
    `Why: ${item.reason || 'No explanation available.'}`,
    `Trust: ${trustPhrase(item)}`,
  ].join('\n');
}

function summarizeClusterReviewMetrics(clusters = []) {
  const lowConfidenceClusters = clusters.filter(cluster =>
    cluster.quality === 'low' ||
    cluster.confidenceLabel === 'weak' ||
    (cluster.qualityFlags || []).includes('heuristic-only') ||
    (cluster.qualityFlags || []).includes('single-source')
  );
  const mergeCandidateCount = clusters.filter(cluster =>
    (cluster.storyCount || 0) >= 3 &&
    (((cluster.qualityFlags || []).includes('heuristic-only')) || (cluster.llmConfidence || 'heuristic') === 'heuristic')
  ).length;
  const splitCandidates = clusters.filter(cluster =>
    (cluster.storyCount || 0) <= 1 &&
    (cluster.sourceCount || 0) <= 1 &&
    (cluster.qualityFlags || []).includes('heuristic-only')
  );
  const topSplitRegions = Array.from(splitCandidates.reduce((acc, cluster) => {
    const region = cluster.region || 'Unknown';
    acc.set(region, (acc.get(region) || 0) + 1);
    return acc;
  }, new Map()).entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([region, count]) => ({ region, count }));

  const normalizeDuplicateTokens = text => String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token && !['the','and','for','with','from','that','this','into','after','amid','over','under','will','have','has','had','says','say','news','latest','live','update','updates'].includes(token))
    .slice(0, 8);
  const duplicateSimilarity = (a, b) => {
    const A = new Set(normalizeDuplicateTokens(a));
    const B = new Set(normalizeDuplicateTokens(b));
    if (!A.size || !B.size) return 0;
    let overlap = 0;
    for (const token of A) if (B.has(token)) overlap += 1;
    return overlap / Math.max(Math.min(A.size, B.size), 1);
  };

  const suspiciousNearDuplicates = [];
  for (let i = 0; i < splitCandidates.length; i++) {
    for (let j = i + 1; j < splitCandidates.length; j++) {
      const a = splitCandidates[i];
      const b = splitCandidates[j];
      if ((a.region || '') !== (b.region || '')) continue;
      const similarity = duplicateSimilarity(a.headline || a.summary || '', b.headline || b.summary || '');
      if (similarity < 0.5) continue;
      suspiciousNearDuplicates.push({
        region: a.region || 'Unknown',
        similarity: Number(similarity.toFixed(2)),
        clusterA: { id: a.id || null, headline: a.headline || a.summary || null, sourceCount: a.sourceCount || 0, storyCount: a.storyCount || 0 },
        clusterB: { id: b.id || null, headline: b.headline || b.summary || null, sourceCount: b.sourceCount || 0, storyCount: b.storyCount || 0 },
      });
    }
  }
  suspiciousNearDuplicates.sort((a, b) => b.similarity - a.similarity || String(a.region).localeCompare(String(b.region)));

  return {
    lowConfidenceCount: lowConfidenceClusters.length,
    mergeCandidateCount,
    splitCandidateCount: splitCandidates.length,
    topSplitRegions,
    suspiciousNearDuplicateCount: suspiciousNearDuplicates.length,
    suspiciousNearDuplicates: suspiciousNearDuplicates.slice(0, 8),
  };
}

function buildReasoningSourceContext(snapshot = {}) {
  const sourceOps = snapshot?.sourceOps || (typeof buildSourceOpsSurface === 'function' && typeof ROOT === 'string'
    ? buildSourceOpsSurface({ rootDir: ROOT, snapshot })
    : null);
  const fusionRoles = sourceOps?.fusionRoles;
  const inventory = sourceOps?.inventory;
  if (!fusionRoles || !inventory) return null;
  return {
    totalSources: fusionRoles.total,
    trustMix: inventory.byTrustClass || null,
    anchorCount: fusionRoles.byRole?.anchor || 0,
    corroboratorCount: fusionRoles.byRole?.corroborator || 0,
    anomalyDetectorCount: fusionRoles.byRole?.['anomaly-detector'] || 0,
    contextCount: fusionRoles.byRole?.context || 0,
    exploratoryCount: fusionRoles.byRole?.exploratory || 0,
    anchorTrustMix: fusionRoles.byRoleAndTrust?.anchor || null,
    exploratoryTrustMix: fusionRoles.byRoleAndTrust?.exploratory || null,
    guidance: {
      groundingPriority: ['anchor', 'corroborator', 'anomaly-detector', 'context', 'exploratory'],
      cautionRoles: ['exploratory'],
      notes: [
        'Anchor evidence should carry more grounding weight than exploratory or context-only feeds.',
        'Exploratory sources are discovery inputs, not direct confirmation.',
        'Anomaly-detector sources are escalation cues that should be confirmed with anchor or corroborator evidence when possible.',
      ],
    },
  };
}

function buildNewsClusterSummary(snapshot = {}) {
  const clusters = Array.isArray(snapshot.newsClusters) ? snapshot.newsClusters : [];
  const top = clusters[0] || null;
  if (!top) return null;
  return {
    totalClusters: clusters.length,
    quality: snapshot.newsClusterQuality || {
      high: clusters.filter(c => c.quality === 'high').length,
      medium: clusters.filter(c => c.quality === 'medium').length,
      low: clusters.filter(c => c.quality === 'low').length,
      llmBacked: clusters.filter(c => (c.qualityFlags || []).includes('llm-backed')).length,
      heuristicOnly: clusters.filter(c => (c.qualityFlags || []).includes('heuristic-only')).length,
      singleSource: clusters.filter(c => (c.qualityFlags || []).includes('single-source')).length,
      reviewMetrics: summarizeClusterReviewMetrics(clusters),
    },
    topCluster: {
      id: top.id,
      headline: top.headline,
      region: top.region,
      storyCount: top.storyCount,
      sourceCount: top.sourceCount,
      sourceProvenance: top.sourceProvenance || null,
      latestDate: top.latestDate || null,
      llmConfidence: top.llmConfidence || null,
      quality: top.quality || null,
      confidenceLabel: top.confidenceLabel || null,
      qualityFlags: top.qualityFlags || [],
      placementPrecision: top.placementPrecision || null,
      placementBasis: top.placementBasis || null,
      placementClass: top.placementClass || null,
    },
    clusters: clusters.slice(0, 5).map(cluster => ({
      id: cluster.id,
      headline: cluster.headline,
      region: cluster.region,
      storyCount: cluster.storyCount,
      sourceCount: cluster.sourceCount,
      sourceProvenance: cluster.sourceProvenance || null,
      latestDate: cluster.latestDate || null,
      llmConfidence: cluster.llmConfidence || null,
      quality: cluster.quality || null,
      confidenceLabel: cluster.confidenceLabel || null,
      qualityFlags: cluster.qualityFlags || [],
      placementPrecision: cluster.placementPrecision || null,
      placementBasis: cluster.placementBasis || null,
      placementClass: cluster.placementClass || null,
    })),
    sourceReasoning: buildReasoningSourceContext(snapshot),
    llm: snapshot.newsLlmDebug ? attachClusterPressureStats({
      requestedMode: snapshot.newsLlmDebug.requestedMode || 'auto',
      provider: snapshot.newsLlmDebug.provider || null,
      providerConfigured: Boolean(snapshot.newsLlmDebug.providerConfigured),
      attempted: Boolean(snapshot.newsLlmDebug.attempted),
      used: Boolean(snapshot.newsLlmDebug.used),
      fallbackReason: snapshot.newsLlmDebug.fallbackReason || null,
      candidateSetCount: snapshot.newsLlmDebug.candidateSetCount || (Array.isArray(snapshot.newsLlmDebug.candidateSets) ? snapshot.newsLlmDebug.candidateSets.length : 0),
      llmSuccessCount: snapshot.newsLlmDebug.llmSuccessCount || 0,
      llmErrorCount: snapshot.newsLlmDebug.llmErrorCount || 0,
      heuristicFallbackCount: snapshot.newsLlmDebug.heuristicFallbackCount || 0,
      repairAttemptCount: snapshot.newsLlmDebug.repairAttemptCount || 0,
      repairSuccessCount: snapshot.newsLlmDebug.repairSuccessCount || 0,
      repairArtifactCount: snapshot.newsLlmDebug.repairArtifactCount || (Array.isArray(snapshot.newsLlmDebug.repairArtifacts) ? snapshot.newsLlmDebug.repairArtifacts.length : 0),
      retryCount: snapshot.newsLlmDebug.retryCount || 0,
      backoffCount: snapshot.newsLlmDebug.backoffCount || 0,
      tunedRegionCount: snapshot.newsLlmDebug.tunedRegionCount || 0,
      review: snapshot.newsLlmDebug.review ? attachClusterReviewStats(annotateReview({
        failedRegionCount: snapshot.newsLlmDebug.review.failedRegionCount || 0,
        topReasons: Array.isArray(snapshot.newsLlmDebug.review.topReasons) ? snapshot.newsLlmDebug.review.topReasons.slice(0, 4) : [],
        reviewItems: Array.isArray(snapshot.newsLlmDebug.review.reviewItems) ? snapshot.newsLlmDebug.review.reviewItems.slice(0, 6) : [],
      })) : null,
      perRegion: Array.isArray(snapshot.newsLlmDebug.perRegion) ? snapshot.newsLlmDebug.perRegion.slice(0, 8) : [],
    }) : null,
  };
}

const ANALYSIS_STALE_CURRENT_MS = 6 * 60 * 60 * 1000;
const AGENT_ANALYSIS_REFINEMENT_TIMEOUT_MS = 90 * 1000;
let agentAnalysisRefinementSeq = 0;

function clampText(value = '', limit = 220) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizeEnum(value, allowed = [], fallback = null) {
  return allowed.includes(value) ? value : fallback;
}

function parseIsoMs(value = null) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isCurrentSnapshotStale(snapshot = {}, nowMs = Date.now()) {
  const snapshotMs = parseIsoMs(snapshot?.meta?.timestamp || lastSweepTime || null);
  if (!snapshotMs) return false;
  return nowMs - snapshotMs > ANALYSIS_STALE_CURRENT_MS;
}

function reconcileTippingPointLifecycle(analysis = {}, nowMs = Date.now()) {
  const normalized = normalizeAgentAnalysis(analysis);
  return {
    ...normalized,
    tippingPoints: normalized.tippingPoints.map(item => {
      const windowEndMs = parseIsoMs(item.windowEnd);
      if (item.status === 'active' && windowEndMs && windowEndMs < nowMs) {
        return {
          ...item,
          status: 'expired',
          resolutionNote: item.resolutionNote || 'Automatically expired after window end passed without a newer superseding update.',
        };
      }
      return item;
    }),
  };
}

function normalizeEvidenceRefs(refs = []) {
  return (Array.isArray(refs) ? refs : [])
    .map(ref => ({
      type: normalizeEnum(ref?.type, ['signal', 'trend', 'news-cluster', 'source-health', 'delta', 'baseline'], 'signal'),
      id: clampText(ref?.id || 'unknown', 80),
      label: clampText(ref?.label || ref?.id || 'unknown', 160),
    }))
    .slice(0, 8);
}

function normalizeAgentAnalysis(input = {}) {
  const normalized = {
    status: normalizeEnum(input?.status, ['ready', 'thin-history', 'llm-unavailable', 'degraded'], 'thin-history'),
    generatedAt: input?.generatedAt || new Date().toISOString(),
    freshness: {
      generatedAt: input?.freshness?.generatedAt || input?.generatedAt || new Date().toISOString(),
      lastSweep: input?.freshness?.lastSweep || lastSweepTime || null,
      sweepInProgress: Boolean(input?.freshness?.sweepInProgress),
      trendUpdatedAt: input?.freshness?.trendUpdatedAt || input?.trendWindowSummary?.updatedAt || null,
    },
    confidenceLabel: normalizeEnum(input?.confidenceLabel, ['high', 'medium', 'low'], 'low'),
    horizons: (Array.isArray(input?.horizons) ? input.horizons : []).slice(0, 4).map(h => ({
      id: clampText(h?.id || `h${h?.windowHours || 'x'}`, 32),
      label: clampText(h?.label || 'Window', 80),
      windowHours: Math.max(1, Number(h?.windowHours) || 0),
      status: normalizeEnum(h?.status, ['ready', 'thin-history', 'empty'], 'empty'),
      summary: clampText(h?.summary || '', 220),
    })),
    outlook: (Array.isArray(input?.outlook) ? input.outlook : []).slice(0, 4).map(item => ({
      horizonId: clampText(item?.horizonId || 'short', 32),
      text: clampText(item?.text || '', 240),
      confidence: normalizeEnum(item?.confidence, ['high', 'medium', 'low'], 'low'),
      evidenceRefs: normalizeEvidenceRefs(item?.evidenceRefs),
    })).filter(item => item.text),
    risks: (Array.isArray(input?.risks) ? input.risks : []).slice(0, 5).map(item => ({
      title: clampText(item?.title || '', 120),
      severity: normalizeEnum(item?.severity, ['high', 'medium', 'low'], 'low'),
      confidence: normalizeEnum(item?.confidence, ['high', 'medium', 'low'], 'low'),
      summary: clampText(item?.summary || '', 220),
      evidenceRefs: normalizeEvidenceRefs(item?.evidenceRefs),
    })).filter(item => item.title && item.summary),
    tippingPoints: (Array.isArray(input?.tippingPoints) ? input.tippingPoints : []).slice(0, 8).map(item => ({
      title: clampText(item?.title || '', 120),
      windowStart: item?.windowStart || null,
      windowEnd: item?.windowEnd || null,
      validFor: clampText(item?.validFor || '', 80) || null,
      probability: normalizeEnum(item?.probability, ['HIGH', 'MEDIUM', 'LOW'], 'LOW'),
      condition: clampText(item?.condition || '', 220),
      expectedImpact: clampText(item?.expectedImpact || '', 220),
      whyItMatters: clampText(item?.whyItMatters || '', 220),
      evidenceRefs: normalizeEvidenceRefs(item?.evidenceRefs),
      status: normalizeEnum(item?.status, ['active', 'hit', 'cleared', 'expired', 'superseded'], 'active'),
      resolutionNote: clampText(item?.resolutionNote || '', 220) || null,
      invalidationOrClearSignal: clampText(item?.invalidationOrClearSignal || '', 220) || null,
    })).filter(item => item.title && item.condition && item.expectedImpact),
    sourceReasoning: input?.sourceReasoning && typeof input.sourceReasoning === 'object' ? {
      totalSources: Number(input.sourceReasoning.totalSources) || 0,
      trustMix: input.sourceReasoning.trustMix && typeof input.sourceReasoning.trustMix === 'object' ? {
        high: Number(input.sourceReasoning.trustMix.high) || 0,
        medium: Number(input.sourceReasoning.trustMix.medium) || 0,
        low: Number(input.sourceReasoning.trustMix.low) || 0,
        unknown: Number(input.sourceReasoning.trustMix.unknown) || 0,
      } : null,
      anchorCount: Number(input.sourceReasoning.anchorCount) || 0,
      corroboratorCount: Number(input.sourceReasoning.corroboratorCount) || 0,
      anomalyDetectorCount: Number(input.sourceReasoning.anomalyDetectorCount) || 0,
      contextCount: Number(input.sourceReasoning.contextCount) || 0,
      exploratoryCount: Number(input.sourceReasoning.exploratoryCount) || 0,
      anchorTrustMix: input.sourceReasoning.anchorTrustMix && typeof input.sourceReasoning.anchorTrustMix === 'object' ? {
        high: Number(input.sourceReasoning.anchorTrustMix.high) || 0,
        medium: Number(input.sourceReasoning.anchorTrustMix.medium) || 0,
        low: Number(input.sourceReasoning.anchorTrustMix.low) || 0,
        unknown: Number(input.sourceReasoning.anchorTrustMix.unknown) || 0,
      } : null,
      exploratoryTrustMix: input.sourceReasoning.exploratoryTrustMix && typeof input.sourceReasoning.exploratoryTrustMix === 'object' ? {
        high: Number(input.sourceReasoning.exploratoryTrustMix.high) || 0,
        medium: Number(input.sourceReasoning.exploratoryTrustMix.medium) || 0,
        low: Number(input.sourceReasoning.exploratoryTrustMix.low) || 0,
        unknown: Number(input.sourceReasoning.exploratoryTrustMix.unknown) || 0,
      } : null,
      guidance: input.sourceReasoning.guidance && typeof input.sourceReasoning.guidance === 'object' ? {
        groundingPriority: Array.isArray(input.sourceReasoning.guidance.groundingPriority) ? input.sourceReasoning.guidance.groundingPriority.slice(0, 5) : [],
        cautionRoles: Array.isArray(input.sourceReasoning.guidance.cautionRoles) ? input.sourceReasoning.guidance.cautionRoles.slice(0, 3) : [],
        notes: Array.isArray(input.sourceReasoning.guidance.notes) ? input.sourceReasoning.guidance.notes.slice(0, 4).map(note => clampText(note, 180)) : [],
      } : null,
    } : null,
    evidenceSummary: (Array.isArray(input?.evidenceSummary) ? input.evidenceSummary : []).slice(0, 6).map(item => ({
      text: clampText(item?.text || '', 220),
      kind: normalizeEnum(item?.kind, ['current', 'trend', 'health', 'delta', 'source-mix'], 'current'),
      evidenceRefs: normalizeEvidenceRefs(item?.evidenceRefs),
    })).filter(item => item.text),
    caveats: (Array.isArray(input?.caveats) ? input.caveats : []).slice(0, 6).map(item => ({
      text: clampText(item?.text || '', 220),
      level: normalizeEnum(item?.level, ['info', 'warning', 'critical'], 'info'),
    })).filter(item => item.text),
    trendWindowSummary: {
      updatedAt: input?.trendWindowSummary?.updatedAt || new Date().toISOString(),
      availableWindows: (Array.isArray(input?.trendWindowSummary?.availableWindows) ? input.trendWindowSummary.availableWindows : []).slice(0, 6),
      primaryWindowHours: Math.max(1, Number(input?.trendWindowSummary?.primaryWindowHours) || 24),
      primaryStatus: normalizeEnum(input?.trendWindowSummary?.primaryStatus, ['ready', 'thin-history', 'empty'], 'empty'),
    },
    iMessageSummary: (Array.isArray(input?.iMessageSummary) ? input.iMessageSummary : []).slice(0, 5).map(line => clampText(line, 160)).filter(Boolean),
  };
  return normalized;
}

function buildDeterministicAgentAnalysis(snapshot = {}) {
  const trend = snapshot.trendSummary || memory.getTrendSummary();
  const windows = Array.isArray(trend?.windows) ? trend.windows : [];
  const primary = windows[0] || { hours: 24, status: 'empty' };
  const evidenceRefs = [];
  const newsSummary = buildNewsClusterSummary(snapshot);
  const topSuspect = (snapshot.suspectSignals || [])[0] || null;
  const topCorroborated = (snapshot.corroboratedSignals || [])[0] || null;
  const health = snapshot.healthSummary || {};
  const activeHighTippingPoints = [];
  const staleCurrent = isCurrentSnapshotStale(snapshot);

  if (topSuspect) evidenceRefs.push({ type: 'signal', id: topSuspect.signal, label: topSuspect.signal });
  if (topCorroborated) evidenceRefs.push({ type: 'signal', id: topCorroborated.signal, label: topCorroborated.signal });
  if (newsSummary?.topCluster) evidenceRefs.push({ type: 'news-cluster', id: newsSummary.topCluster.id, label: newsSummary.topCluster.headline });
  evidenceRefs.push({ type: 'trend', id: `trend-${primary.hours}h`, label: `${primary.hours}h trend window` });

  const outlook = [];
  if ((primary.signals?.suspectCurrent || 0) > 0) {
    outlook.push({
      horizonId: 'short',
      text: `Short horizon remains cautionary, suspect pressure sits at ${primary.signals.suspectCurrent} active items with limited corroboration.`,
      confidence: topCorroborated ? 'medium' : 'low',
      evidenceRefs,
    });
  }
  if (newsSummary?.topCluster) {
    outlook.push({
      horizonId: 'short',
      text: `News flow is concentrated around ${newsSummary.topCluster.region}, led by "${newsSummary.topCluster.headline}".`,
      confidence: newsSummary.topCluster.confidenceLabel === 'strong' ? 'high' : 'medium',
      evidenceRefs: [{ type: 'news-cluster', id: newsSummary.topCluster.id, label: newsSummary.topCluster.headline }],
    });
  }
  if ((primary.marketRegime?.vix?.current || 0) > 0 || (primary.commodityDrift?.energy?.brentCurrent || 0) > 0) {
    outlook.push({
      horizonId: 'medium',
      text: `Medium horizon is sensitive to macro shock repricing, with VIX at ${primary.marketRegime?.vix?.current ?? '--'} and Brent at ${primary.commodityDrift?.energy?.brentCurrent ?? '--'}.`,
      confidence: 'medium',
      evidenceRefs: [{ type: 'trend', id: 'market-regime', label: 'Market regime and commodity drift' }],
    });
  }

  const risks = [];
  if (topSuspect) {
    risks.push({
      title: topSuspect.signal,
      severity: topSuspect.confidence === 'high' ? 'high' : 'medium',
      confidence: topSuspect.confidence === 'low' ? 'low' : 'medium',
      summary: clampText(topSuspect.reason || 'Suspect signal requires corroboration.', 220),
      evidenceRefs: [{ type: 'signal', id: topSuspect.signal, label: topSuspect.signal }],
    });
  }
  if ((health.failed || 0) > 0) {
    risks.push({
      title: 'Source degradation',
      severity: (health.failed || 0) >= 4 ? 'high' : 'medium',
      confidence: 'high',
      summary: `${health.failed || 0} sources are currently failed, which can weaken current-picture confidence.`,
      evidenceRefs: [{ type: 'source-health', id: 'source-health', label: 'Current source health summary' }],
    });
  }
  if ((primary.anomalyPersistence?.nuclearRuns || 0) > 0) {
    risks.push({
      title: 'Persistent nuclear anomaly watch',
      severity: 'medium',
      confidence: 'low',
      summary: `Nuclear anomaly markers appear in ${primary.anomalyPersistence.nuclearRuns} runs, but single-source caution still applies.`,
      evidenceRefs: [{ type: 'trend', id: 'nuclear-persistence', label: 'Nuclear anomaly persistence' }],
    });
  }

  if ((primary.commodityDrift?.energy?.brentCurrent || 0) >= 95) {
    activeHighTippingPoints.push({
      title: 'Energy shock escalation',
      windowStart: snapshot.meta?.timestamp || null,
      windowEnd: null,
      validFor: 'next 24h',
      probability: 'HIGH',
      condition: 'Brent remains elevated near or above current levels while suspect geopolitical pressure persists.',
      expectedImpact: 'Higher macro stress, wider risk-off bias, and stronger supply-shock narrative.',
      whyItMatters: 'Energy pricing is one of the fastest ways regional conflict pressure spills into broader operator risk.',
      evidenceRefs: [{ type: 'trend', id: 'energy-drift', label: 'Energy drift and Brent level' }],
      status: 'active',
      resolutionNote: null,
      invalidationOrClearSignal: 'Clear if Brent normalizes materially lower and conflict-related suspect pressure fades.',
    });
  }

  const sourceReasoning = buildReasoningSourceContext(snapshot);
  const caveats = [];
  if (primary.status !== 'ready') caveats.push({ text: 'Trend history is still thin, so outlook confidence is constrained.', level: 'warning' });
  if (staleCurrent) caveats.push({ text: 'Current snapshot is stale relative to retained trend memory, so current-picture conclusions are degraded.', level: 'critical' });
  if ((health.failed || 0) > 0) caveats.push({ text: `${health.failed} failed sources are reducing current-picture completeness.`, level: 'warning' });
  if (topSuspect && !topCorroborated) caveats.push({ text: 'Current risk picture leans on suspect or OSINT-only signals more than corroborated evidence.', level: 'warning' });
  if ((snapshot.newsLlmDebug?.review?.failedRegionCount || 0) > 0) caveats.push({ text: 'News clustering still has active failed-review regions, so topic grouping is not fully clean.', level: 'info' });

  const confidenceLabel = staleCurrent ? 'low' : (topCorroborated && (health.failed || 0) < 3 ? 'medium' : 'low');
  const status = !llmProvider?.isConfigured ? 'llm-unavailable' : primary.status === 'ready' ? ((health.failed || 0) >= 5 || staleCurrent ? 'degraded' : 'ready') : 'thin-history';

  const schema = {
    status,
    generatedAt: new Date().toISOString(),
    freshness: {
      generatedAt: new Date().toISOString(),
      lastSweep: snapshot.meta?.timestamp || lastSweepTime || null,
      sweepInProgress,
      trendUpdatedAt: trend?.generatedAt || null,
    },
    confidenceLabel,
    horizons: windows.slice(0, 3).map((window, idx) => ({
      id: idx === 0 ? 'short' : idx === 1 ? 'medium' : 'extended',
      label: idx === 0 ? `Next ${window.hours}h` : idx === 1 ? `Next ${window.hours}h` : `Next ${Math.round(window.hours / 24)}d`,
      windowHours: window.hours,
      status: window.status || 'empty',
      summary: idx === 0
        ? `Suspects ${window.signals?.suspectCurrent || 0}, urgent tempo ${window.urgentTempo?.current || 0}, failed sources ${window.sourceHealth?.currentFailed || 0}.`
        : `Runs ${window.runCount || 0}, air persistence ${window.anomalyPersistence?.airRuns || 0}, nuclear persistence ${window.anomalyPersistence?.nuclearRuns || 0}.`,
    })),
    outlook,
    risks,
    tippingPoints: activeHighTippingPoints,
    sourceReasoning,
    evidenceSummary: [
      { text: `Current sweep shows ${snapshot.suspectSignals?.length || 0} suspect and ${snapshot.corroboratedSignals?.length || 0} corroborated signals.`, kind: 'current', evidenceRefs },
      { text: `${primary.hours || 24}h trend window has ${primary.runCount || 0} runs with urgent tempo ${primary.urgentTempo?.current || 0}.`, kind: 'trend', evidenceRefs: [{ type: 'trend', id: `trend-${primary.hours || 24}h`, label: `${primary.hours || 24}h trend window` }] },
      { text: `Source health currently reports ${health.failed || 0} failed and ${health.degraded || 0} degraded sources.`, kind: 'health', evidenceRefs: [{ type: 'source-health', id: 'source-health', label: 'Current source health summary' }] },
      ...(sourceReasoning ? [{ text: `Reasoning source mix: ${sourceReasoning.anchorCount} anchors, ${sourceReasoning.corroboratorCount} corroborators, ${sourceReasoning.anomalyDetectorCount} anomaly detectors, ${sourceReasoning.exploratoryCount} exploratory sources.`, kind: 'source-mix', evidenceRefs: [{ type: 'source-health', id: 'source-fusion-roles', label: 'Source fusion-role summary' }] }] : []),
    ],
    caveats,
    trendWindowSummary: {
      updatedAt: trend?.generatedAt || new Date().toISOString(),
      availableWindows: windows.map(window => window.hours),
      primaryWindowHours: primary.hours || 24,
      primaryStatus: primary.status || 'empty',
    },
    iMessageSummary: [
      `Status: ${status.replace(/-/g, ' ')}, confidence ${confidenceLabel}.`,
      `Outlook: ${outlook[0]?.text || 'Trend history is building but still cautious.'}`.slice(0, 160),
      `Top risk: ${risks[0] ? `${risks[0].title}, ${risks[0].summary}` : 'No dominant risk isolated yet.'}`.slice(0, 160),
      `Tipping point: ${activeHighTippingPoints[0]?.title || 'No active HIGH-probability tipping point published yet.'}`.slice(0, 160),
      `Caveat: ${caveats[0]?.text || 'No extra caveat.'}`.slice(0, 160),
    ],
  };

  return normalizeAgentAnalysis(schema);
}

function confidenceRank(value = 'low') {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1;
}

function dedupePublishedOutlook(analysis = {}) {
  const normalized = normalizeAgentAnalysis(analysis);
  const horizonOrder = new Map((normalized.horizons || []).map((item, index) => [item.id, index]));
  const selected = new Map();

  for (const item of normalized.outlook || []) {
    const key = item.horizonId || 'unknown';
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, item);
      continue;
    }
    const itemRank = confidenceRank(item.confidence);
    const existingRank = confidenceRank(existing.confidence);
    if (itemRank > existingRank) {
      selected.set(key, item);
      continue;
    }
    if (itemRank === existingRank && (item.evidenceRefs?.length || 0) > (existing.evidenceRefs?.length || 0)) {
      selected.set(key, item);
    }
  }

  return Array.from(selected.values())
    .sort((a, b) => {
      const aOrder = horizonOrder.has(a.horizonId) ? horizonOrder.get(a.horizonId) : Number.MAX_SAFE_INTEGER;
      const bOrder = horizonOrder.has(b.horizonId) ? horizonOrder.get(b.horizonId) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return confidenceRank(b.confidence) - confidenceRank(a.confidence);
    })
    .slice(0, 4);
}

function buildPublishedAgentAnalysis(analysis = {}) {
  const normalized = reconcileTippingPointLifecycle(analysis);
  return {
    ...normalized,
    outlook: dedupePublishedOutlook(normalized),
    tippingPoints: normalized.tippingPoints.filter(item => item.status === 'active' && item.probability === 'HIGH').slice(0, 5),
  };
}

function compactAgentAnalysisContext(snapshot = {}, fallback = null) {
  const trend = snapshot.trendSummary || {};
  const primary = Array.isArray(trend.windows) ? trend.windows[0] || null : null;
  const sections = [];
  const suspects = (snapshot.suspectSignals || []).slice(0, 4).map(item => `${item.signal} [${item.confidence}] ${clampText(item.reason || '', 140)}`);
  const corroborated = (snapshot.corroboratedSignals || []).slice(0, 3).map(item => `${item.signal} [${item.confidence}] ${clampText(item.reason || '', 140)}`);
  const risks = (fallback?.risks || []).slice(0, 3).map(item => `${item.title} (${item.severity}/${item.confidence}): ${item.summary}`);
  const outlook = (fallback?.outlook || []).slice(0, 3).map(item => `${item.horizonId}: ${item.text}`);
  const news = buildNewsClusterSummary(snapshot);

  sections.push(`META: sweep=${snapshot.meta?.timestamp || 'unknown'}, llmConfigured=${Boolean(llmProvider?.isConfigured)}`);
  if (snapshot.evidenceSummary?.headline) sections.push(`EVIDENCE: ${snapshot.evidenceSummary.headline}`);
  if (suspects.length) sections.push(`SUSPECTS:\n- ${suspects.join('\n- ')}`);
  if (corroborated.length) sections.push(`CORROBORATED:\n- ${corroborated.join('\n- ')}`);
  if (news?.topCluster) sections.push(`TOP_NEWS: ${news.topCluster.headline} | ${news.topCluster.region} | ${news.topCluster.storyCount} stories | ${news.topCluster.sourceCount} sources | quality=${news.topCluster.confidenceLabel || news.topCluster.quality || 'unknown'}`);
  if (news?.sourceReasoning) sections.push(`SOURCE_CONTEXT: anchors=${news.sourceReasoning.anchorCount}, corroborators=${news.sourceReasoning.corroboratorCount}, anomalyDetectors=${news.sourceReasoning.anomalyDetectorCount}, context=${news.sourceReasoning.contextCount}, exploratory=${news.sourceReasoning.exploratoryCount}; trust high=${news.sourceReasoning.trustMix?.high || 0}, medium=${news.sourceReasoning.trustMix?.medium || 0}, low=${news.sourceReasoning.trustMix?.low || 0}; caution=${(news.sourceReasoning.guidance?.cautionRoles || []).join(',') || 'none'}`);
  if (primary) sections.push(`TREND_${primary.hours}H: urgent=${primary.urgentTempo?.current || 0}, suspect=${primary.signals?.suspectCurrent || 0}, corroborated=${primary.signals?.corroboratedCurrent || 0}, failedSources=${primary.sourceHealth?.currentFailed || 0}, vix=${primary.marketRegime?.vix?.current ?? 'n/a'}, brent=${primary.commodityDrift?.energy?.brentCurrent ?? 'n/a'}`);
  if (snapshot.delta?.summary) sections.push(`DELTA: direction=${snapshot.delta.summary.direction}, changes=${snapshot.delta.summary.totalChanges}, critical=${snapshot.delta.summary.criticalChanges}`);
  if (snapshot.baseline6h?.summary?.headline) sections.push(`BASELINE6H: ${snapshot.baseline6h.summary.headline}`);
  if (risks.length) sections.push(`FALLBACK_RISKS:\n- ${risks.join('\n- ')}`);
  if (outlook.length) sections.push(`FALLBACK_OUTLOOK:\n- ${outlook.join('\n- ')}`);
  return sections.join('\n');
}

function parseAgentAnalysisResponse(text = '') {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  const candidates = [cleaned];
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) candidates.push(objMatch[0]);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed.agentAnalysis && typeof parsed.agentAnalysis === 'object' ? parsed.agentAnalysis : parsed;
    } catch {}
  }
  return null;
}

async function generateLLMAgentAnalysis(provider, snapshot = {}) {
  if (!provider?.isConfigured) return { analysis: null, meta: { source: 'deterministic', used: false, error: 'llm-unavailable' } };
  const fallback = buildDeterministicAgentAnalysis(snapshot);
  const systemPrompt = `You are an intelligence analyst producing structured operator-facing analysis from current signals, trend memory, and source-health context.

Rules:
- Return ONLY valid JSON.
- Do not overstate OSINT chatter as confirmed fact.
- Keep confidence conservative when corroboration is weak or source health is degraded.
- Main-surface tipping points must be HIGH probability and ACTIVE only.
- Every outlook, risk, and tipping point should cite concrete evidenceRefs from the input context.
- Prefer the provided fallback draft when uncertain, but improve specificity if the evidence supports it.

Return this object shape:
{
  "agentAnalysis": {
    "status": "ready|thin-history|llm-unavailable|degraded",
    "generatedAt": "ISO timestamp",
    "freshness": {"generatedAt": "ISO", "lastSweep": "ISO|null", "sweepInProgress": true, "trendUpdatedAt": "ISO|null"},
    "confidenceLabel": "high|medium|low",
    "horizons": [{"id":"short","label":"Next 24h","windowHours":24,"status":"ready|thin-history|empty","summary":"..."}],
    "outlook": [{"horizonId":"short","text":"...","confidence":"high|medium|low","evidenceRefs":[{"type":"signal|trend|news-cluster|source-health|delta|baseline","id":"...","label":"..."}]}],
    "risks": [{"title":"...","severity":"high|medium|low","confidence":"high|medium|low","summary":"...","evidenceRefs":[]}],
    "tippingPoints": [{"title":"...","windowStart":"ISO|null","windowEnd":"ISO|null","validFor":"...","probability":"HIGH|MEDIUM|LOW","condition":"...","expectedImpact":"...","whyItMatters":"...","evidenceRefs":[],"status":"active|hit|cleared|expired|superseded","resolutionNote":null,"invalidationOrClearSignal":"..."}],
    "evidenceSummary": [{"text":"...","kind":"current|trend|health|delta","evidenceRefs":[]}],
    "caveats": [{"text":"...","level":"info|warning|critical"}],
    "trendWindowSummary": {"updatedAt":"ISO","availableWindows":[24,72,168],"primaryWindowHours":24,"primaryStatus":"ready|thin-history|empty"},
    "iMessageSummary": ["line1","line2","line3","line4","line5"]
  }
}`;

  const userPrompt = `${compactAgentAnalysisContext(snapshot, fallback)}

FALLBACK_DRAFT:
${JSON.stringify(fallback, null, 2)}`;

  try {
    const result = await provider.complete(systemPrompt, userPrompt, { maxTokens: 4096, timeout: 90000 });
    const parsed = parseAgentAnalysisResponse(result.text);
    if (!parsed) return { analysis: null, meta: { source: 'llm-failed', used: false, error: 'parse-failed', model: result.model || provider.model || null } };
    return { analysis: parsed, meta: { source: 'llm', used: true, error: null, model: result.model || provider.model || null } };
  } catch (err) {
    return { analysis: null, meta: { source: 'llm-failed', used: false, error: err.message, model: provider.model || null } };
  }
}

function buildAgentAnalysis(snapshot = {}, candidate = null, options = {}) {
  const published = options.published !== false;
  const normalized = normalizeAgentAnalysis(candidate || buildDeterministicAgentAnalysis(snapshot));
  return published ? buildPublishedAgentAnalysis(normalized) : normalized;
}

function buildAgentAnalysisSummary(snapshot = {}) {
  const analysis = snapshot.agentAnalysis || buildAgentAnalysis(snapshot);
  return {
    status: analysis.status,
    confidenceLabel: analysis.confidenceLabel,
    sourceReasoning: analysis.sourceReasoning || null,
    source: snapshot.agentAnalysisMeta?.source || 'deterministic',
    refinementState: snapshot.agentAnalysisMeta?.refinementState || 'not-requested',
    outlook: analysis.outlook.slice(0, 2),
    risks: analysis.risks.slice(0, 3),
    tippingPoints: analysis.tippingPoints.slice(0, 3),
    caveats: analysis.caveats.slice(0, 3),
    iMessageSummary: analysis.iMessageSummary.slice(0, 5),
  };
}

function buildAgentAnalysisMeta(overrides = {}) {
  return {
    source: 'deterministic',
    used: false,
    error: null,
    model: llmProvider?.model || null,
    refinementState: 'not-requested',
    refinementAttemptId: null,
    refinementStartedAt: null,
    refinementCompletedAt: null,
    refinementDurationMs: null,
    refinementTimeoutMs: AGENT_ANALYSIS_REFINEMENT_TIMEOUT_MS,
    refinementCancelled: false,
    refinementTimedOut: false,
    refinementCompletion: null,
    ...overrides,
  };
}

function buildRuntimeLlmStatus(snapshot = {}, { provider = config.llm?.provider || null, model = llmProvider?.model || null } = {}) {
  const configured = Boolean(provider);
  const analysisMeta = snapshot.agentAnalysisMeta || {};
  const ideasSource = snapshot.ideasSource || 'disabled';
  const analysisAttempted = Boolean(analysisMeta.refinementAttemptId || analysisMeta.refinementStartedAt || analysisMeta.refinementCompletedAt || analysisMeta.refinementState === 'failed' || analysisMeta.refinementState === 'timed-out' || analysisMeta.refinementState === 'completed');
  const analysisApplied = analysisMeta.source === 'llm';
  const analysisPending = analysisMeta.refinementState === 'pending' || analysisMeta.refinementState === 'queued';
  const analysisSupported = configured;
  const analysisAvailable = configured && analysisMeta.error !== 'llm-unavailable' && analysisMeta.refinementState !== 'unavailable';
  const analysisUnavailable = !analysisAvailable;
  const analysisReason = analysisUnavailable
    ? 'unavailable'
    : analysisPending
      ? 'pending'
      : analysisApplied
        ? 'applied'
        : analysisAttempted || analysisMeta.source === 'deterministic'
          ? 'fallback'
          : 'not-invoked';
  const analysisExplanation = analysisUnavailable
    ? 'Analysis refinement unavailable, deterministic analysis only.'
    : analysisPending
      ? 'Analysis refinement queued, deterministic draft currently published.'
      : analysisApplied
        ? `Analysis refinement applied${model ? ` via ${model}` : ''}.`
        : analysisAttempted
          ? `Analysis refinement attempted, deterministic fallback kept${analysisMeta.error ? ` (${analysisMeta.error})` : ''}.`
          : `Analysis refinement supported but not invoked${model ? ` (${model})` : ''}.`;

  const ideasApplied = ideasSource === 'llm';
  const ideasPending = ideasSource === 'pending';
  const ideasSupported = configured;
  const ideasAvailable = configured;
  const ideasStaticByDesign = configured && ideasSource === 'disabled';
  const ideasNotInvoked = configured && (ideasSource === 'disabled' || ideasSource === 'not-invoked');
  const ideasUnavailable = !ideasAvailable;
  const ideasReason = ideasUnavailable
    ? 'unavailable'
    : ideasPending
      ? 'pending'
      : ideasApplied
        ? 'applied'
        : ideasSource === 'llm-failed'
          ? 'fallback'
          : ideasStaticByDesign
            ? 'static-by-design'
            : ideasNotInvoked
              ? 'not-invoked'
              : 'available';
  const ideasExplanation = ideasUnavailable
    ? 'Ideas LLM unavailable, static ideas only.'
    : ideasPending
      ? 'Ideas generation still pending.'
      : ideasApplied
        ? `Ideas generated with LLM${model ? ` via ${model}` : ''}.`
        : ideasSource === 'llm-failed'
          ? 'Ideas LLM attempted but fallback/static output remained active.'
          : ideasStaticByDesign
            ? 'Ideas are currently static by design, despite LLM support being available.'
            : 'Ideas LLM support is available but was not invoked this cycle.';

  const status = !configured
    ? 'unavailable'
    : analysisPending || ideasPending
      ? 'pending'
      : analysisApplied || ideasApplied
        ? 'applied'
        : analysisAttempted || ideasSource === 'llm-failed'
          ? 'fallback'
          : 'available';
  const label = {
    unavailable: 'LLM UNAVAILABLE',
    pending: 'LLM PENDING',
    applied: 'LLM APPLIED',
    fallback: 'LLM FALLBACK',
    available: 'LLM AVAILABLE',
  }[status] || 'LLM STATUS';
  const summary = !configured
    ? 'LLM is not configured, deterministic analysis and static ideas are active.'
    : analysisPending || ideasPending
      ? 'LLM is configured, but published output still includes pending deterministic fallback.'
      : analysisApplied || ideasApplied
        ? 'LLM is configured and participated in the current published output.'
        : analysisAttempted || ideasSource === 'llm-failed'
          ? 'LLM is configured, but published output remains on deterministic or static fallback.'
          : 'LLM is configured, but no current published surface required it yet.';

  return {
    configured,
    provider,
    model,
    status,
    label,
    summary,
    analysis: {
      label: {
        unavailable: 'LLM UNAVAILABLE',
        pending: 'LLM PENDING',
        applied: 'LLM APPLIED',
        fallback: 'LLM FALLBACK',
        'not-invoked': 'LLM AVAILABLE',
      }[analysisReason] || 'LLM STATUS',
      reason: analysisReason,
      configured,
      supported: analysisSupported,
      available: analysisAvailable,
      attempted: analysisAttempted,
      participated: analysisApplied,
      explanation: analysisExplanation,
    },
    ideas: {
      label: {
        unavailable: 'LLM UNAVAILABLE',
        pending: 'LLM PENDING',
        applied: 'LLM APPLIED',
        fallback: 'LLM FALLBACK',
        'static-by-design': 'STATIC BY DESIGN',
        'not-invoked': 'LLM AVAILABLE',
        available: 'LLM AVAILABLE',
      }[ideasReason] || 'LLM STATUS',
      reason: ideasReason,
      configured,
      supported: ideasSupported,
      available: ideasAvailable,
      attempted: configured && (ideasPending || ideasApplied || ideasSource === 'llm-failed'),
      participated: ideasApplied,
      explanation: ideasExplanation,
    },
  };
}

function buildOperatorLlmStateContract(snapshot = {}, options = {}) {
  const runtimeLlm = buildRuntimeLlmStatus(snapshot, options);
  return {
    version: 'llm-operator-state-v1',
    status: runtimeLlm.status,
    label: runtimeLlm.label,
    summary: runtimeLlm.summary,
    configured: runtimeLlm.configured,
    provider: runtimeLlm.provider,
    model: runtimeLlm.model,
    surfaces: {
      analysis: runtimeLlm.analysis,
      ideas: runtimeLlm.ideas,
    },
    support: {
      analysis: {
        supported: Boolean(runtimeLlm.analysis?.supported),
        available: Boolean(runtimeLlm.analysis?.available),
      },
      ideas: {
        supported: Boolean(runtimeLlm.ideas?.supported),
        available: Boolean(runtimeLlm.ideas?.available),
      },
    },
    participation: {
      analysis: {
        attempted: Boolean(runtimeLlm.analysis?.attempted),
        participated: Boolean(runtimeLlm.analysis?.participated),
      },
      ideas: {
        attempted: Boolean(runtimeLlm.ideas?.attempted),
        participated: Boolean(runtimeLlm.ideas?.participated),
      },
    },
    runtimeLlm,
  };
}

async function runAgentAnalysisValidationSummary() {
  return await new Promise((resolve, reject) => {
    exec(`/opt/homebrew/opt/node/bin/node "${AGENT_ANALYSIS_VALIDATION_SCRIPT}" --json`, { cwd: ROOT, timeout: 120000 }, (error, stdout, stderr) => {
      const raw = String(stdout || '').trim();
      if (error && !raw) {
        reject(new Error(String(stderr || error.message || 'validation-summary-failed').trim()));
        return;
      }
      try {
        const parsed = JSON.parse(raw || '{}');
        resolve(parsed);
      } catch (parseErr) {
        reject(new Error(`validation-summary-parse-failed: ${parseErr.message}`));
      }
    });
  });
}

function buildIMessengerBrief(snapshot = {}) {
  const lines = [];
  const evidence = snapshot.evidenceSummary || {};
  const counts = evidence.counts || {};
  const corroborated = attachSignalIds('corroborated', snapshot.corroboratedSignals || []);
  const suspects = attachSignalIds('suspect', snapshot.suspectSignals || []);
  const topCorroborated = corroborated[0] || null;
  const topSuspect = suspects[0] || null;
  const tgUrgent = snapshot.tg?.urgent || [];
  const newsSummary = buildNewsClusterSummary(snapshot);
  const agentAnalysis = snapshot.agentAnalysis || buildAgentAnalysis(snapshot);

  if (Array.isArray(agentAnalysis?.iMessageSummary) && agentAnalysis.iMessageSummary.length) {
    lines.push(...agentAnalysis.iMessageSummary.slice(0, 5));
  }

  if (evidence.headline) {
    lines.push(`Evidence: ${evidence.headline}`);
    lines.push(`Provenance: ${summarizeEvidenceProvenance(snapshot)}`);
    lines.push(`Fresh ${counts.fresh || 0}, aging ${counts.aging || 0}, stale ${counts.stale || 0}, carried ${counts.carriedForward || 0}, failed ${counts.failedSources || 0}`);
  }

  if (topCorroborated) {
    lines.push(`Top corroborated [${topCorroborated.id}]: ${topCorroborated.signal} (${topCorroborated.confidence}, ${signalProvenanceLabel(topCorroborated)})`);
  }

  if (topSuspect) {
    lines.push(`Top suspect [${topSuspect.id}]: ${topSuspect.signal} (${topSuspect.confidence}, ${signalProvenanceLabel(topSuspect)})`);
  }

  if (tgUrgent.length) {
    lines.push(`OSINT urgent: ${tgUrgent.length} items`);
  }

  if (newsSummary?.topCluster) {
    const top = newsSummary.topCluster;
    lines.push(`Top news cluster: ${top.headline} (${top.region}, ${top.storyCount} stories/${top.sourceCount} sources, ${top.confidenceLabel || 'unknown'})`);
    if (newsSummary.quality) {
      lines.push(`News cluster quality: ${newsSummary.quality.high || 0} strong, ${newsSummary.quality.medium || 0} moderate, ${newsSummary.quality.low || 0} weak`);
    }
    if (newsSummary.llm) {
      const newsLlmState = !newsSummary.llm.providerConfigured
        ? 'LLM unavailable'
        : newsSummary.llm.used && !newsSummary.llm.heuristicFallbackCount
          ? 'LLM applied'
          : newsSummary.llm.used && newsSummary.llm.heuristicFallbackCount
            ? 'LLM partial fallback'
            : 'LLM fallback';
      lines.push(`News LLM: ${newsLlmState}${newsSummary.llm.requestedMode ? `, mode ${newsSummary.llm.requestedMode}` : ''}${newsSummary.llm.candidateSetCount != null ? `, candidates ${newsSummary.llm.candidateSetCount}` : ''}${newsSummary.llm.heuristicFallbackCount != null ? `, fallbacks ${newsSummary.llm.heuristicFallbackCount}` : ''}${newsSummary.llm.retryCount ? `, retries ${newsSummary.llm.retryCount}` : ''}${newsSummary.llm.repairSuccessCount ? `, repairs ${newsSummary.llm.repairSuccessCount}` : ''}`);
      if (newsSummary.llm.review?.failedRegionCount) {
        const topReason = newsSummary.llm.review.topReasons?.[0];
        lines.push(`Cluster review: ${newsSummary.llm.review.failedRegionCount} failed regions${topReason ? `, top reason ${topReason.reason} (${topReason.count})` : ''}`);
      }
    }
  }

  return lines.join('\n');
}

function buildBriefSections(snapshot = {}, { markdown = false } = {}) {
  const tg = snapshot.tg || {};
  const energy = snapshot.energy || {};
  const metals = snapshot.metals || {};
  const delta = memory.getLastDelta();
  const ideas = (snapshot.ideas || []).slice(0, 3);
  const sections = [
    markdown ? `**📋 CRUCIX BRIEF**\n_${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC_\n`
             : `📋 *CRUCIX BRIEF*\n_${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC_\n`
  ];

  if (snapshot.evidenceSummary?.headline) {
    const counts = snapshot.evidenceSummary.counts || {};
    sections.push(`🧾 Evidence: ${snapshot.evidenceSummary.headline}`);
    sections.push(`   Fresh: ${counts.fresh || 0} | Aging: ${counts.aging || 0} | Stale: ${counts.stale || 0} | Carried: ${counts.carriedForward || 0} | Failed sources: ${counts.failedSources || 0}`);
    sections.push('');
  }

  if (delta?.summary) {
    const dirEmoji = { 'risk-off': '📉', 'risk-on': '📈', 'mixed': '↔️' }[delta.summary.direction] || '↔️';
    sections.push(`${dirEmoji} Direction: ${markdown ? `**${delta.summary.direction.toUpperCase()}**` : `*${delta.summary.direction.toUpperCase()}*`} | ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical`);
    sections.push('');
  }

  const vix = snapshot.fred?.find(f => f.id === 'VIXCLS');
  const hy = snapshot.fred?.find(f => f.id === 'BAMLH0A0HYM2');
  if (vix || energy.wti || metals.gold || metals.silver) {
    sections.push(`📊 VIX: ${vix?.value || '--'} | WTI: $${energy.wti || '--'} | Brent: $${energy.brent || '--'}`);
    sections.push(`   Gold: $${metals.gold || '--'} | Silver: $${metals.silver || '--'}${hy ? ` | HY Spread: ${hy.value}` : ''}`);
    sections.push(`   NatGas: $${energy.natgas || '--'}`);
    sections.push('');
  }

  if (tg.urgent?.length > 0) {
    sections.push(`📡 OSINT: ${tg.urgent.length} urgent signals, ${tg.posts || 0} total posts`);
    for (const p of tg.urgent.slice(0, 2)) sections.push(`  • ${(p.text || '').substring(0, 80)}`);
    sections.push('');
  }

  if (snapshot.corroboratedSignals?.length) {
    sections.push(`✅ Corroborated signals:`);
    for (const item of snapshot.corroboratedSignals.slice(0, 3)) {
      sections.push(`  • ${item.signal} [${item.confidence}]${formatSignalTrustLabel(item)} ${item.reason.substring(0, 90)}`);
    }
    sections.push('');
  }

  if (snapshot.suspectSignals?.length) {
    sections.push(`⚠️ Suspect signals:`);
    for (const item of snapshot.suspectSignals.slice(0, 3)) {
      sections.push(`  • ${item.signal} [${item.confidence}]${formatSignalTrustLabel(item)} ${item.reason.substring(0, 90)}`);
    }
    sections.push('');
  }

  if (ideas.length > 0) {
    sections.push(markdown ? `**💡 Top Ideas:**` : `💡 *Top Ideas:*`);
    for (const idea of ideas) sections.push(`  ${idea.type === 'long' ? '📈' : idea.type === 'hedge' ? '🛡️' : '👁️'} ${idea.title}`);
  }

  return sections.join('\n');
}

// === Delta/Memory ===
const memory = new MemoryManager(RUNS_DIR);

// === LLM + Telegram + Discord ===
const llmProvider = createLLMProvider(config.llm);
const telegramAlerter = new TelegramAlerter(config.telegram);
const discordAlerter = new DiscordAlerter(config.discord || {});

if (llmProvider) console.log(`[Crucix] LLM enabled: ${llmProvider.name} (${llmProvider.model})`);
if (telegramAlerter.isConfigured) {
  console.log('[Crucix] Telegram alerts enabled');

  // ─── Two-Way Bot Commands ───────────────────────────────────────────────

  telegramAlerter.onCommand('/status', async () => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const sourcesOk = currentData?.meta?.sourcesOk || 0;
    const sourcesTotal = currentData?.meta?.sourcesQueried || 0;
    const sourcesFailed = currentData?.meta?.sourcesFailed || 0;
    const llmStatus = llmProvider?.isConfigured ? `✅ ${llmProvider.name}` : '❌ Disabled';
    const nextSweep = lastSweepTime
      ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()
      : 'pending';

    return [
      `🖥️ *CRUCIX STATUS*`,
      ``,
      `Uptime: ${h}h ${m}m`,
      `Last sweep: ${lastSweepTime ? new Date(lastSweepTime).toLocaleTimeString() + ' UTC' : 'never'}`,
      `Next sweep: ${nextSweep} UTC`,
      `Sweep in progress: ${sweepInProgress ? '🔄 Yes' : '⏸️ No'}`,
      `Sources: ${sourcesOk}/${sourcesTotal} OK${sourcesFailed > 0 ? ` (${sourcesFailed} failed)` : ''}`,
      `LLM: ${llmStatus}`,
      `SSE clients: ${sseClients.size}`,
      `Dashboard: http://localhost:${config.port}`,
    ].join('\n');
  });

  telegramAlerter.onCommand('/sweep', async () => {
    if (sweepInProgress) return '🔄 Sweep already in progress. Please wait.';
    // Fire and forget — don't block the bot response
    runSweepCycle().catch(err => console.error('[Crucix] Manual sweep failed:', err.message));
    return '🚀 Manual sweep triggered. You\'ll receive alerts if anything significant is detected.';
  });

  telegramAlerter.onCommand('/brief', async () => {
    if (!currentData) return '⏳ No data yet — waiting for first sweep to complete.';
    return buildBriefSections(currentData, { markdown: false });
  });

  telegramAlerter.onCommand('/portfolio', async () => {
    return '📊 Portfolio integration requires Alpaca MCP connection.\nUse the Crucix dashboard or Claude agent for portfolio queries.';
  });

  // Start polling for bot commands
  telegramAlerter.startPolling(config.telegram.botPollingInterval);
}

// === Discord Bot ===
if (discordAlerter.isConfigured) {
  console.log('[Crucix] Discord bot enabled');

  // Reuse the same command handlers as Telegram (DRY)
  discordAlerter.onCommand('status', async () => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const sourcesOk = currentData?.meta?.sourcesOk || 0;
    const sourcesTotal = currentData?.meta?.sourcesQueried || 0;
    const sourcesFailed = currentData?.meta?.sourcesFailed || 0;
    const llmStatus = llmProvider?.isConfigured ? `✅ ${llmProvider.name}` : '❌ Disabled';
    const nextSweep = lastSweepTime
      ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()
      : 'pending';

    return [
      `**🖥️ CRUCIX STATUS**\n`,
      `Uptime: ${h}h ${m}m`,
      `Last sweep: ${lastSweepTime ? new Date(lastSweepTime).toLocaleTimeString() + ' UTC' : 'never'}`,
      `Next sweep: ${nextSweep} UTC`,
      `Sweep in progress: ${sweepInProgress ? '🔄 Yes' : '⏸️ No'}`,
      `Sources: ${sourcesOk}/${sourcesTotal} OK${sourcesFailed > 0 ? ` (${sourcesFailed} failed)` : ''}`,
      `LLM: ${llmStatus}`,
      `SSE clients: ${sseClients.size}`,
      `Dashboard: http://localhost:${config.port}`,
    ].join('\n');
  });

  discordAlerter.onCommand('sweep', async () => {
    if (sweepInProgress) return '🔄 Sweep already in progress. Please wait.';
    runSweepCycle().catch(err => console.error('[Crucix] Manual sweep failed:', err.message));
    return '🚀 Manual sweep triggered. You\'ll receive alerts if anything significant is detected.';
  });

  discordAlerter.onCommand('brief', async () => {
    if (!currentData) return '⏳ No data yet — waiting for first sweep to complete.';
    return buildBriefSections(currentData, { markdown: true });
  });

  discordAlerter.onCommand('portfolio', async () => {
    return '📊 Portfolio integration requires Alpaca MCP connection.\nUse the Crucix dashboard or Claude agent for portfolio queries.';
  });

  // Start the Discord bot (non-blocking — connection happens async)
  discordAlerter.start().catch(err => {
    console.error('[Crucix] Discord bot startup failed (non-fatal):', err.message);
  });
}

// === Express Server ===
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(ROOT, 'dashboard/public')));

function injectDashboardRuntimeHtml(html = '') {
  const locale = getLocale();
  const operatorSettings = loadOperatorSettings();
  const localeScript = `<script>window.__CRUCIX_LOCALE__ = ${JSON.stringify(locale).replace(/<\/script>/gi, '<\\/script>')};</script>`;
  const runtimeScript = `<script>window.__CRUCIX_RUNTIME__ = ${JSON.stringify({ refreshIntervalMinutes: config.refreshIntervalMinutes, settingsUrl: '/settings', operatorSettings: operatorSettings.preferences }).replace(/<\/script>/gi, '<\\/script>')};</script>`;
  return html.replace('</head>', `${localeScript}\n${runtimeScript}\n</head>`);
}

// Serve loading page until first sweep completes, then the dashboard with injected locale
app.get('/', (req, res) => {
  if (!currentData) {
    res.sendFile(join(ROOT, 'dashboard/public/loading.html'));
  } else {
    const htmlPath = join(ROOT, 'dashboard/public/jarvis.html');
    const html = readFileSync(htmlPath, 'utf-8');
    res.type('html').send(injectDashboardRuntimeHtml(html));
  }
});

app.get('/settings', async (req, res) => {
  const snapshot = await ensureCurrentData();
  if (!snapshot) return res.sendFile(join(ROOT, 'dashboard/public/loading.html'));
  const htmlPath = join(ROOT, 'dashboard/public/settings.html');
  const html = readFileSync(htmlPath, 'utf-8');
  res.type('html').send(injectDashboardRuntimeHtml(html));
});

app.get('/admin/settings', requireDebugAccess, async (req, res) => {
  const snapshot = await ensureCurrentData();
  if (!snapshot) return res.sendFile(join(ROOT, 'dashboard/public/loading.html'));
  const htmlPath = join(ROOT, 'dashboard/public/admin-settings.html');
  const html = readFileSync(htmlPath, 'utf-8');
  res.type('html').send(injectDashboardRuntimeHtml(html));
});

function getSweepWatchdogSnapshot(nowMs = Date.now()) {
  const startedAtMs = sweepStartedAt ? new Date(sweepStartedAt).getTime() : null;
  const active = Boolean(sweepInProgress && startedAtMs);
  const overdueMs = active ? Math.max(0, nowMs - startedAtMs - SWEEP_WATCHDOG_TIMEOUT_MS) : 0;
  const overdue = Boolean(active && overdueMs > 0);
  return {
    timeoutMs: SWEEP_WATCHDOG_TIMEOUT_MS,
    pollMs: SWEEP_WATCHDOG_POLL_MS,
    active,
    overdue,
    overdueMs,
    timeoutMinutes: Math.round(SWEEP_WATCHDOG_TIMEOUT_MS / 60000),
    lastOverdueAt: overdue ? new Date(nowMs).toISOString() : sweepWatchdogTelemetry.lastOverdueAt,
    telemetry: { ...sweepWatchdogTelemetry },
  };
}

function recoverHungSweep(reason = 'watchdog-overdue', nowMs = Date.now()) {
  if (!sweepInProgress) return false;
  const recoveredSweepStartedAt = sweepStartedAt;
  const nowIso = new Date(nowMs).toISOString();
  sweepWatchdogTelemetry.recoveryCount += 1;
  sweepWatchdogTelemetry.lastRecoveryAt = nowIso;
  sweepWatchdogTelemetry.lastRecoveryReason = reason;
  sweepWatchdogTelemetry.lastRecoveredSweepStartedAt = recoveredSweepStartedAt || null;
  sweepWatchdogTelemetry.lastOverdueAt = nowIso;
  sweepInProgress = false;
  sweepStartedAt = null;
  syncSnapshotRuntimeFreshness(currentData);
  broadcast({
    type: 'sweep_watchdog_recovered',
    recoveredAt: nowIso,
    reason,
    recoveredSweepStartedAt,
  });
  console.warn(`[Crucix] Sweep watchdog recovered hung sweep gate (${reason}) started at ${recoveredSweepStartedAt || 'unknown'}`);
  return true;
}

function runSweepWatchdog(nowMs = Date.now()) {
  const watchdog = getSweepWatchdogSnapshot(nowMs);
  if (!watchdog.overdue) {
    return { recovered: false, watchdog };
  }
  const recovered = recoverHungSweep('watchdog-overdue', nowMs);
  return {
    recovered,
    watchdog: getSweepWatchdogSnapshot(nowMs),
    telemetry: { ...sweepWatchdogTelemetry },
  };
}

function syncSnapshotRuntimeFreshness(snapshot = null) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  if (!snapshot.agentAnalysis) return snapshot;
  const lastSweep = snapshot.meta?.timestamp || lastSweepTime || snapshot.agentAnalysis?.freshness?.lastSweep || null;
  snapshot.agentAnalysis = normalizeAgentAnalysis({
    ...snapshot.agentAnalysis,
    freshness: {
      ...(snapshot.agentAnalysis?.freshness || {}),
      lastSweep,
      sweepInProgress,
    },
  });
  return snapshot;
}

async function ensureCurrentData() {
  return syncSnapshotRuntimeFreshness(currentData);
}

function buildOperatorSourceOps(snapshot = null) {
  return buildSourceOpsSurface({ rootDir: ROOT, snapshot });
}

function buildRuntimeConfigContract() {
  const env = process?.env || {};
  const parseIntOr = (value, fallback) => {
    const num = Number.parseInt(value, 10);
    return Number.isFinite(num) ? num : fallback;
  };
  const boolFromPresence = value => Boolean(value);
  const rootDefaultRefresh = 15;
  const rootEffectiveRefresh = Number(config.refreshIntervalMinutes) || rootDefaultRefresh;
  const defaults = {
    port: 3117,
    refreshIntervalMinutes: rootDefaultRefresh,
    llm: {
      provider: null,
      apiKey: null,
      model: null,
      baseUrl: null,
    },
    telegram: {
      botToken: null,
      chatId: null,
      botPollingInterval: 5000,
      channels: null,
    },
    discord: {
      botToken: null,
      channelId: null,
      guildId: null,
      webhookUrl: null,
    },
    review: {
      ackTtlHours: 72,
      ackMaxEntries: 100,
      repairArtifactMaxSamples: 12,
      repairArtifactRetentionDays: 14,
      repairArtifactMaxEntries: 50,
      sweepWatchdogTimeoutMinutes: Math.max(rootDefaultRefresh * 2, 45),
      sweepWatchdogPollSeconds: 30,
    },
    debugEndpoints: {
      exposure: 'local-only',
    },
    freshnessPolicy: {
      defaultFreshnessMinutes: 60,
      sources: {},
      areas: {},
    },
  };

  const entries = [
    { key: 'port', section: 'runtime', env: 'PORT', defaultValue: defaults.port, effectiveValue: config.port, sensitive: false },
    { key: 'refreshIntervalMinutes', section: 'runtime', env: 'REFRESH_INTERVAL_MINUTES', defaultValue: defaults.refreshIntervalMinutes, effectiveValue: config.refreshIntervalMinutes, sensitive: false },
    { key: 'llm.provider', section: 'llm', env: 'LLM_PROVIDER', defaultValue: defaults.llm.provider, effectiveValue: config.llm?.provider || null, sensitive: false },
    { key: 'llm.apiKey', section: 'llm', env: 'LLM_API_KEY', defaultValue: defaults.llm.apiKey, effectiveValue: boolFromPresence(config.llm?.apiKey) ? '[configured]' : null, sensitive: true },
    { key: 'llm.model', section: 'llm', env: 'LLM_MODEL', defaultValue: defaults.llm.model, effectiveValue: config.llm?.model || null, sensitive: false },
    { key: 'llm.baseUrl', section: 'llm', env: 'OLLAMA_BASE_URL', defaultValue: defaults.llm.baseUrl, effectiveValue: config.llm?.baseUrl || null, sensitive: false },
    { key: 'telegram.botToken', section: 'alerts', env: 'TELEGRAM_BOT_TOKEN', defaultValue: defaults.telegram.botToken, effectiveValue: boolFromPresence(config.telegram?.botToken) ? '[configured]' : null, sensitive: true },
    { key: 'telegram.chatId', section: 'alerts', env: 'TELEGRAM_CHAT_ID', defaultValue: defaults.telegram.chatId, effectiveValue: boolFromPresence(config.telegram?.chatId) ? '[configured]' : null, sensitive: true },
    { key: 'telegram.botPollingInterval', section: 'alerts', env: 'TELEGRAM_POLL_INTERVAL', defaultValue: defaults.telegram.botPollingInterval, effectiveValue: config.telegram?.botPollingInterval, sensitive: false },
    { key: 'telegram.channels', section: 'alerts', env: 'TELEGRAM_CHANNELS', defaultValue: defaults.telegram.channels, effectiveValue: config.telegram?.channels || null, sensitive: false },
    { key: 'discord.botToken', section: 'alerts', env: 'DISCORD_BOT_TOKEN', defaultValue: defaults.discord.botToken, effectiveValue: boolFromPresence(config.discord?.botToken) ? '[configured]' : null, sensitive: true },
    { key: 'discord.channelId', section: 'alerts', env: 'DISCORD_CHANNEL_ID', defaultValue: defaults.discord.channelId, effectiveValue: config.discord?.channelId || null, sensitive: false },
    { key: 'discord.guildId', section: 'alerts', env: 'DISCORD_GUILD_ID', defaultValue: defaults.discord.guildId, effectiveValue: config.discord?.guildId || null, sensitive: false },
    { key: 'discord.webhookUrl', section: 'alerts', env: 'DISCORD_WEBHOOK_URL', defaultValue: defaults.discord.webhookUrl, effectiveValue: boolFromPresence(config.discord?.webhookUrl) ? '[configured]' : null, sensitive: true },
    { key: 'review.ackTtlHours', section: 'review', env: 'REVIEW_ACK_TTL_HOURS', defaultValue: defaults.review.ackTtlHours, effectiveValue: config.review?.ackTtlHours, sensitive: false },
    { key: 'review.ackMaxEntries', section: 'review', env: 'REVIEW_ACK_MAX_ENTRIES', defaultValue: defaults.review.ackMaxEntries, effectiveValue: config.review?.ackMaxEntries, sensitive: false },
    { key: 'review.repairArtifactMaxSamples', section: 'review', env: 'REPAIR_ARTIFACT_MAX_SAMPLES', defaultValue: defaults.review.repairArtifactMaxSamples, effectiveValue: config.review?.repairArtifactMaxSamples, sensitive: false },
    { key: 'review.repairArtifactRetentionDays', section: 'review', env: 'REPAIR_ARTIFACT_RETENTION_DAYS', defaultValue: defaults.review.repairArtifactRetentionDays, effectiveValue: config.review?.repairArtifactRetentionDays, sensitive: false },
    { key: 'review.repairArtifactMaxEntries', section: 'review', env: 'REPAIR_ARTIFACT_MAX_ENTRIES', defaultValue: defaults.review.repairArtifactMaxEntries, effectiveValue: config.review?.repairArtifactMaxEntries, sensitive: false },
    { key: 'review.sweepWatchdogTimeoutMinutes', section: 'review', env: 'SWEEP_WATCHDOG_TIMEOUT_MINUTES', defaultValue: defaults.review.sweepWatchdogTimeoutMinutes, effectiveValue: config.review?.sweepWatchdogTimeoutMinutes, sensitive: false },
    { key: 'review.sweepWatchdogPollSeconds', section: 'review', env: 'SWEEP_WATCHDOG_POLL_SECONDS', defaultValue: defaults.review.sweepWatchdogPollSeconds, effectiveValue: config.review?.sweepWatchdogPollSeconds, sensitive: false },
    { key: 'debugEndpoints.exposure', section: 'debug', env: 'DEBUG_ENDPOINT_EXPOSURE', defaultValue: defaults.debugEndpoints.exposure, effectiveValue: config.debugEndpoints?.exposure || 'local-only', sensitive: false },
    { key: 'freshnessPolicy.defaultFreshnessMinutes', section: 'freshness', env: 'DEFAULT_FRESHNESS_MINUTES', defaultValue: defaults.freshnessPolicy.defaultFreshnessMinutes, effectiveValue: config.freshnessPolicy?.defaultFreshnessMinutes, sensitive: false },
    { key: 'freshnessPolicy.sources.OpenSky.freshnessTargetMinutes', section: 'freshness', env: 'OPENSKY_FRESHNESS_MINUTES', defaultValue: null, effectiveValue: config.freshnessPolicy?.sources?.OpenSky?.freshnessTargetMinutes ?? null, sensitive: false },
    { key: 'freshnessPolicy.sources.YFinance.freshnessTargetMinutes', section: 'freshness', env: 'YFINANCE_FRESHNESS_MINUTES', defaultValue: null, effectiveValue: config.freshnessPolicy?.sources?.YFinance?.freshnessTargetMinutes ?? null, sensitive: false },
    { key: 'freshnessPolicy.sources.Telegram.freshnessTargetMinutes', section: 'freshness', env: 'TELEGRAM_FRESHNESS_MINUTES', defaultValue: null, effectiveValue: config.freshnessPolicy?.sources?.Telegram?.freshnessTargetMinutes ?? null, sensitive: false },
    { key: 'freshnessPolicy.sources.GDELT.freshnessTargetMinutes', section: 'freshness', env: 'GDELT_FRESHNESS_MINUTES', defaultValue: null, effectiveValue: config.freshnessPolicy?.sources?.GDELT?.freshnessTargetMinutes ?? null, sensitive: false },
    { key: 'freshnessPolicy.areas.air.freshnessWarnMinutes', section: 'freshness', env: 'AIR_FRESHNESS_WARN_MINUTES', defaultValue: null, effectiveValue: config.freshnessPolicy?.areas?.air?.freshnessWarnMinutes ?? null, sensitive: false },
    { key: 'freshnessPolicy.areas.markets.freshnessWarnMinutes', section: 'freshness', env: 'MARKETS_FRESHNESS_WARN_MINUTES', defaultValue: null, effectiveValue: config.freshnessPolicy?.areas?.markets?.freshnessWarnMinutes ?? null, sensitive: false },
    { key: 'freshnessPolicy.areas.telegram.freshnessWarnMinutes', section: 'freshness', env: 'TELEGRAM_FRESHNESS_WARN_MINUTES', defaultValue: null, effectiveValue: config.freshnessPolicy?.areas?.telegram?.freshnessWarnMinutes ?? null, sensitive: false },
    { key: 'freshnessPolicy.areas.news.freshnessWarnMinutes', section: 'freshness', env: 'NEWS_FRESHNESS_WARN_MINUTES', defaultValue: null, effectiveValue: config.freshnessPolicy?.areas?.news?.freshnessWarnMinutes ?? null, sensitive: false },
  ];

  const normalizedEntries = entries.map(entry => {
    const envPresent = Object.prototype.hasOwnProperty.call(env, entry.env) && env[entry.env] !== '';
    const source = envPresent ? 'env' : 'default';
    const drifted = entry.effectiveValue !== entry.defaultValue;
    return {
      ...entry,
      source,
      envPresent,
      drifted,
      envValuePreview: envPresent ? (entry.sensitive ? '[configured]' : String(env[entry.env])) : null,
    };
  });

  const bySection = normalizedEntries.reduce((acc, entry) => {
    if (!acc[entry.section]) acc[entry.section] = [];
    acc[entry.section].push(entry);
    return acc;
  }, {});

  const schema = {
    version: 'runtime-config-schema-v1',
    sections: ['runtime', 'llm', 'alerts', 'review', 'debug', 'freshness'],
    allowedDebugExposure: ['local-only', 'open'],
    llmProviders: ['anthropic', 'openai', 'gemini', 'codex', 'openrouter', 'minimax', 'mistral', 'ollama', 'grok', null],
    invariants: {
      portMin: 1,
      portMax: 65535,
      refreshIntervalMinutesMin: 1,
      reviewAckTtlHoursMin: 1,
      reviewAckMaxEntriesMin: 1,
      sweepWatchdogTimeoutMinutesMin: 5,
      sweepWatchdogPollSecondsMin: 5,
      freshnessMinutesMin: 1,
    },
  };

  const validation = {
    valid: true,
    issues: [],
    warnings: [],
  };

  const effective = {
    port: config.port,
    refreshIntervalMinutes: config.refreshIntervalMinutes,
    llm: {
      provider: config.llm?.provider || null,
      model: config.llm?.model || null,
      baseUrl: config.llm?.baseUrl || null,
      apiKeyConfigured: boolFromPresence(config.llm?.apiKey),
    },
    telegram: {
      enabled: boolFromPresence(config.telegram?.botToken) && boolFromPresence(config.telegram?.chatId),
      botPollingInterval: config.telegram?.botPollingInterval,
      channelsConfigured: boolFromPresence(config.telegram?.channels),
    },
    discord: {
      botEnabled: boolFromPresence(config.discord?.botToken),
      webhookEnabled: boolFromPresence(config.discord?.webhookUrl),
      guildIdConfigured: boolFromPresence(config.discord?.guildId),
      channelIdConfigured: boolFromPresence(config.discord?.channelId),
    },
    review: {
      ackTtlHours: config.review?.ackTtlHours,
      ackMaxEntries: config.review?.ackMaxEntries,
      repairArtifactMaxSamples: config.review?.repairArtifactMaxSamples,
      repairArtifactRetentionDays: config.review?.repairArtifactRetentionDays,
      repairArtifactMaxEntries: config.review?.repairArtifactMaxEntries,
      sweepWatchdogTimeoutMinutes: config.review?.sweepWatchdogTimeoutMinutes,
      sweepWatchdogPollSeconds: config.review?.sweepWatchdogPollSeconds,
    },
    debugEndpoints: {
      exposure: config.debugEndpoints?.exposure || 'local-only',
    },
    freshnessPolicy: config.freshnessPolicy || {},
  };

  if (!Number.isInteger(effective.port) || effective.port < schema.invariants.portMin || effective.port > schema.invariants.portMax) {
    validation.valid = false;
    validation.issues.push({ key: 'port', message: 'Port must be an integer between 1 and 65535.' });
  }
  if (!Number.isInteger(effective.refreshIntervalMinutes) || effective.refreshIntervalMinutes < schema.invariants.refreshIntervalMinutesMin) {
    validation.valid = false;
    validation.issues.push({ key: 'refreshIntervalMinutes', message: 'Refresh interval must be at least 1 minute.' });
  }
  if (!schema.allowedDebugExposure.includes(effective.debugEndpoints.exposure)) {
    validation.valid = false;
    validation.issues.push({ key: 'debugEndpoints.exposure', message: 'Debug endpoint exposure must be local-only or open.' });
  }
  if (effective.llm.provider && !schema.llmProviders.includes(effective.llm.provider)) {
    validation.valid = false;
    validation.issues.push({ key: 'llm.provider', message: 'LLM provider is outside the supported provider set.' });
  }
  if (effective.llm.provider && !effective.llm.model) {
    validation.warnings.push({ key: 'llm.model', message: 'LLM provider is configured without an explicit model override.' });
  }
  if (effective.llm.provider && !effective.llm.apiKeyConfigured && effective.llm.provider !== 'ollama') {
    validation.warnings.push({ key: 'llm.apiKey', message: 'Remote LLM provider appears configured without an API key.' });
  }
  if (effective.telegram.enabled === false && boolFromPresence(config.telegram?.botToken) !== boolFromPresence(config.telegram?.chatId)) {
    validation.warnings.push({ key: 'telegram', message: 'Telegram token and chat ID are not both configured, so Telegram alerting remains disabled.' });
  }
  if (effective.review.sweepWatchdogTimeoutMinutes < Math.max(effective.refreshIntervalMinutes * 2, 5)) {
    validation.warnings.push({ key: 'review.sweepWatchdogTimeoutMinutes', message: 'Sweep watchdog timeout is tighter than twice the refresh interval and may trip during normal slow sweeps.' });
  }

  return {
    version: 'runtime-config-v1',
    generatedAt: new Date().toISOString(),
    schema,
    defaults,
    effective,
    validation,
    driftSummary: {
      totalEntries: normalizedEntries.length,
      driftedEntries: normalizedEntries.filter(entry => entry.drifted).length,
      envOverrides: normalizedEntries.filter(entry => entry.envPresent).length,
      defaultedEntries: normalizedEntries.filter(entry => !entry.envPresent).length,
    },
    entries: normalizedEntries,
    bySection,
    notes: [
      'Sensitive values are redacted to configured-state markers rather than raw secrets.',
      'Drift here means the effective runtime value differs from the built-in default, usually because an env override is active.',
    ],
  };
}

function buildOperatorSettingsContract(snapshot = null) {
  const activeSnapshot = snapshot || currentData || {};
  const sourceOps = buildOperatorSourceOps(activeSnapshot);
  const llmState = buildOperatorLlmStateContract(activeSnapshot || {}, { provider: config.llm.provider, model: llmProvider?.model || null });
  const runtimeConfig = buildRuntimeConfigContract();
  const operatorSettings = loadOperatorSettings();
  const categories = Object.entries(sourceOps?.inventory?.byCategory || {})
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  const lifecycleStates = Object.entries(sourceOps?.inventory?.byLifecycle || {})
    .map(([lifecycle, count]) => ({ lifecycle, count }))
    .sort((a, b) => b.count - a.count || a.lifecycle.localeCompare(b.lifecycle));
  const sourceItems = Array.isArray(sourceOps?.inventory?.items) ? sourceOps.inventory.items.map(item => ({
    id: item.id,
    name: item.name,
    category: item.category,
    lifecycle: item.lifecycle,
    liveState: item.liveState || null,
  })) : [];
  const enabledAlerts = [
    config.telegram?.botToken && config.telegram?.chatId ? 'telegram' : null,
    config.discord?.botToken || config.discord?.webhookUrl ? 'discord' : null,
  ].filter(Boolean);

  return {
    version: 'operator-settings-v1',
    generatedAt: new Date().toISOString(),
    sections: ['layout', 'sources', 'llm', 'agentAnalysis', 'runtime', 'debug', 'alerts', 'config', 'persistence'],
    layout: {
      current: 'default-terminal',
      available: [
        { id: 'default-terminal', label: 'Default Terminal', status: 'active' },
        { id: 'operator', label: 'Operator', status: 'planned' },
        { id: 'diagnostics', label: 'Diagnostics', status: 'planned' },
        { id: 'source-ops', label: 'Source Ops', status: 'planned' },
        { id: 'executive-briefing', label: 'Executive Briefing', status: 'planned' },
      ],
      controls: {
        visualsMode: operatorSettings.preferences.layout.visualsMode,
        mobileFlatMapDefault: operatorSettings.preferences.layout.mapMode !== 'globe',
        mapMode: operatorSettings.preferences.layout.mapMode,
        displayMode: operatorSettings.preferences.layout.displayMode,
        availableDisplayModes: ['auto', 'narrow', 'desktop', 'wallboard'],
        defaultRegion: operatorSettings.preferences.layout.defaultRegion,
        activeLayer: operatorSettings.preferences.layout.activeLayer,
        persistence: 'server-file',
      },
      mutability: {
        current: 'ui-session',
        presets: 'planned',
      },
    },
    sources: {
      total: sourceOps?.inventory?.total || 0,
      active: sourceOps?.inventory?.active || 0,
      categories,
      lifecycleStates,
      selection: {
        mode: 'all-enabled-by-config',
        supportsPerSourceControl: true,
        supportsCategoryFiltering: true,
        nextSurface: 'settings-persistence-v1',
        persistence: 'server-file',
        enabledCategories: operatorSettings.preferences.sources.enabledCategories,
        enabledSourceIds: operatorSettings.preferences.sources.enabledSourceIds,
      },
      availableSources: sourceItems,
      health: {
        liveStateSummary: sourceOps?.inventory?.liveStateSummary || null,
      },
    },
    llm: {
      provider: config.llm.provider || null,
      model: llmProvider?.model || config.llm.model || null,
      baseUrl: config.llm.baseUrl || null,
      configured: Boolean(config.llm.provider),
      state: llmState,
      requestedModeOptions: ['auto', 'off', 'force'],
      defaultMode: operatorSettings.preferences.llm.newsModeDefault,
      supportsProviderSwitchingFromUi: false,
      supportsModelEditingFromUi: false,
    },
    agentAnalysis: {
      current: activeSnapshot?.agentAnalysis ? {
        status: activeSnapshot.agentAnalysis.status,
        confidenceLabel: activeSnapshot.agentAnalysis.confidenceLabel,
        source: activeSnapshot.agentAnalysisMeta?.source || 'deterministic',
        refinementState: activeSnapshot.agentAnalysisMeta?.refinementState || 'not-requested',
        refinementCompletion: activeSnapshot.agentAnalysisMeta?.refinementCompletion || null,
        tippingPointCount: Array.isArray(activeSnapshot.agentAnalysis.tippingPoints) ? activeSnapshot.agentAnalysis.tippingPoints.length : 0,
      } : null,
      controls: {
        publishMode: 'deterministic-with-llm-refinement-when-configured',
        deterministicFallbackAlwaysAvailable: true,
        detailLevel: operatorSettings.preferences.agentAnalysis.detailLevel,
        horizonTuning: 'planned',
        tippingPointThresholdTuning: 'planned',
      },
    },
    runtime: {
      refreshIntervalMinutes: config.refreshIntervalMinutes,
      nextSweep: lastSweepTime
        ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toISOString()
        : null,
      sweepInProgress,
      sweepStartedAt,
      watchdog: getSweepWatchdogSnapshot(),
      locale: currentLanguage,
    },
    debug: {
      endpointExposure: config.debugEndpoints?.exposure || 'local-only',
      endpointExposureOptions: ['local-only', 'open'],
      localRequestRequiredByDefault: (config.debugEndpoints?.exposure || 'local-only') !== 'open',
    },
    alerts: {
      enabled: enabledAlerts,
      telegramEnabled: Boolean(config.telegram?.botToken && config.telegram?.chatId),
      discordEnabled: Boolean(config.discord?.botToken || config.discord?.webhookUrl),
    },
    config: {
      contract: runtimeConfig,
      validation: runtimeConfig.validation,
      driftSummary: runtimeConfig.driftSummary,
    },
    persistence: {
      version: operatorSettings.version,
      updatedAt: operatorSettings.updatedAt,
      path: null,
      capabilities: {
        serverFile: true,
        export: false,
        import: false,
        writeApi: false,
      },
      persistedPreferences: operatorSettings.preferences,
    },
    access: {
      role: 'operator',
      mode: 'read-only',
      adminSurface: '/admin/settings',
      adminApi: '/api/settings/admin',
      localAdminRequired: true,
    },
    notes: [
      'This surface centralizes current operator-visible settings and runtime posture.',
      'Operator settings is intentionally a read-only operator surface; local-only admin controls live under /admin/settings so sensitive writes and debug-adjacent actions are separated from normal viewing.',
      'Runtime configuration is exposed as a versioned contract with defaults, effective values, validation, and drift summary.',
      'Operator preference persistence currently applies layout visuals, map mode, region, and active layer directly, while LLM and agent-analysis preferences are stored safely for later deeper runtime enforcement.',
    ],
  };
}

function buildAdminSettingsContract(snapshot = null) {
  const operator = buildOperatorSettingsContract(snapshot);
  const operatorSettings = loadOperatorSettings();
  return {
    ...operator,
    version: 'admin-settings-v1',
    sections: [...operator.sections, 'admin'],
    persistence: {
      ...operator.persistence,
      path: OPERATOR_SETTINGS_PATH,
      capabilities: {
        serverFile: true,
        export: true,
        import: true,
        writeApi: true,
      },
      persistedPreferences: operatorSettings.preferences,
    },
    access: {
      role: 'admin',
      mode: 'local-write',
      operatorSurface: '/settings',
      localAdminRequired: true,
    },
    admin: {
      controls: {
        exportEndpoint: '/api/settings/export',
        importEndpoint: '/api/settings/import',
        writeEndpoint: '/api/settings/operator',
      },
      boundaries: {
        requiresLocalRequest: true,
        debugExposure: config.debugEndpoints?.exposure || 'local-only',
      },
    },
    notes: [
      ...operator.notes,
      'Admin settings is a local-only surface intended for persisted writes, export, import, and other debug-adjacent control-plane actions.',
    ],
  };
}

// API: current data
app.get('/api/data', async (req, res) => {
  const snapshot = await ensureCurrentData();
  if (!snapshot) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  const review = snapshot?.newsLlmDebug?.review
    ? attachClusterReviewStats(annotateReview(snapshot.newsLlmDebug.review))
    : { reviewItems: [], dismissedItems: [], activeCount: 0, dismissedCount: 0, ackSummary: reviewAckStats(), stats: summarizeClusterReviewStats() };
  const llmState = buildOperatorLlmStateContract(snapshot);
  const sourceOps = buildOperatorSourceOps(snapshot);
  res.json({
    ...snapshot,
    llmState,
    runtimeLlm: llmState.runtimeLlm,
    reviewQueue: buildOperatorReviewQueue(review, { quality: snapshot.newsClusterQuality || null }),
    sourceInventory: sourceOps.inventory,
    sourceOps,
  });
});

app.get('/api/settings', async (req, res) => {
  const snapshot = await ensureCurrentData();
  if (!snapshot) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  res.json(buildOperatorSettingsContract(snapshot));
});

app.get('/api/settings/admin', requireDebugAccess, async (req, res) => {
  const snapshot = await ensureCurrentData();
  if (!snapshot) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  res.json(buildAdminSettingsContract(snapshot));
});

app.get('/api/settings/export', requireDebugAccess, (req, res) => {
  res.json(loadOperatorSettings());
});

app.put('/api/settings/operator', requireDebugAccess, (req, res) => {
  const saved = mergeOperatorSettingsPatch(req.body || {});
  res.json({ ok: true, settings: saved });
});

app.post('/api/settings/import', requireDebugAccess, (req, res) => {
  const payload = req.body?.preferences ? req.body : { preferences: req.body || {} };
  const saved = saveOperatorSettings(payload);
  res.json({ ok: true, settings: saved });
});

app.get('/api/brief/compact', async (req, res) => {
  const snapshot = await ensureCurrentData();
  if (!snapshot) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  const corroborated = attachSignalIds('corroborated', snapshot.corroboratedSignals || []);
  const suspects = attachSignalIds('suspect', snapshot.suspectSignals || []);
  const llmState = buildOperatorLlmStateContract(snapshot);
  const sourceOps = buildOperatorSourceOps(snapshot);
  res.json({
    text: buildIMessengerBrief(snapshot),
    evidenceSummary: snapshot.evidenceSummary || null,
    newsSummary: buildNewsClusterSummary(snapshot),
    agentAnalysis: buildAgentAnalysisSummary(snapshot),
    llmState,
    runtimeLlm: llmState.runtimeLlm,
    sourceInventory: {
      total: sourceOps.inventory.total,
      byLifecycle: sourceOps.inventory.byLifecycle,
      byCategory: sourceOps.inventory.byCategory,
      liveStateSummary: sourceOps.inventory.liveStateSummary,
    },
    sourceOpsNeeds: sourceOps.needs,
    topCorroborated: corroborated[0] || null,
    topSuspect: suspects[0] || null,
    corroboratedSignals: corroborated.slice(0, 5),
    suspectSignals: suspects.slice(0, 5),
  });
});

app.get('/api/brief/news/review', requireDebugAccess, async (req, res) => {
  const snapshot = await ensureCurrentData();
  if (!snapshot) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  const requestedMode = typeof req.query.llm === 'string' ? req.query.llm.trim().toLowerCase() : 'auto';
  const llmMode = ['auto', 'off', 'force'].includes(requestedMode) ? requestedMode : 'auto';
  const baseSummary = llmMode === 'auto'
    ? buildNewsClusterSummary(snapshot)
    : buildNewsClusterSummary({
        ...(await (async () => {
          const { clusters, llmDebug, qualitySummary } = await buildNewsClusters(snapshot.news || [], llmProvider, { mode: llmMode });
          return { newsClusters: clusters, newsLlmDebug: llmDebug, newsClusterQuality: qualitySummary };
        })()),
      });
  if (!baseSummary?.llm) return res.json({ review: null, queue: buildOperatorReviewQueue({ reviewItems: [], dismissedItems: [], activeCount: 0, dismissedCount: 0, ackSummary: reviewAckStats(), stats: summarizeClusterReviewStats() }), llm: null, quality: baseSummary?.quality || null, totalClusters: baseSummary?.totalClusters || 0, ackSummary: reviewAckStats() });
  const review = attachClusterReviewStats(annotateReview(baseSummary.llm.review || { failedRegionCount: 0, topReasons: [], reviewItems: [] }));
  res.json({
    totalClusters: baseSummary.totalClusters,
    quality: baseSummary.quality || null,
    llm: baseSummary.llm,
    review,
    queue: buildOperatorReviewQueue(review, { quality: baseSummary.quality || null }),
  });
});

app.get('/api/brief/news/review/stats', requireDebugAccess, (req, res) => {
  res.json({
    stats: summarizeClusterReviewStats(),
    pressure: summarizeClusterPressureStats(),
  });
});

app.get('/api/brief/news/review/artifacts', requireDebugAccess, (req, res) => {
  const region = typeof req.query.region === 'string' ? req.query.region.trim() : '';
  const reason = typeof req.query.reason === 'string' ? req.query.reason.trim() : '';
  const artifacts = summarizeClusterRepairArtifacts();
  const filteredItems = (artifacts.items || []).filter(item => {
    if (region && String(item?.region || '').trim() !== region) return false;
    if (reason && String(item?.reason || '').trim() !== reason) return false;
    return true;
  });
  res.json({
    filter: {
      region: region || null,
      reason: reason || null,
      applied: Boolean(region || reason),
    },
    artifacts: {
      ...artifacts,
      filteredCount: filteredItems.length,
      items: filteredItems,
    },
  });
});

app.get('/api/trends', requireDebugAccess, (req, res) => {
  res.json({
    trendSummary: memory.getTrendSummary(),
  });
});

app.get('/api/analysis', async (req, res) => {
  const snapshot = await ensureCurrentData();
  if (!snapshot) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  res.json({
    agentAnalysis: snapshot.agentAnalysis || buildAgentAnalysis(snapshot),
    meta: snapshot.agentAnalysisMeta || buildAgentAnalysisMeta({ error: llmProvider?.isConfigured ? null : 'llm-unavailable' }),
  });
});

app.get('/api/analysis/review', requireDebugAccess, async (req, res) => {
  const snapshot = await ensureCurrentData();
  if (!snapshot) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  const analysis = snapshot.agentAnalysis || buildAgentAnalysis(snapshot);
  res.json({
    agentAnalysis: analysis,
    published: buildAgentAnalysisSummary(snapshot),
    meta: snapshot.agentAnalysisMeta || buildAgentAnalysisMeta({ error: llmProvider?.isConfigured ? null : 'llm-unavailable' }),
    trendSummary: snapshot.trendSummary || memory.getTrendSummary(),
    baseline6h: snapshot.baseline6h || null,
    deltaSummary: snapshot.delta?.summary || null,
  });
});

app.get('/api/analysis/validation-summary', async (req, res) => {
  try {
    const summary = await runAgentAnalysisValidationSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || 'validation-summary-failed',
    });
  }
});

app.get('/api/brief/news/review/acks', requireDebugAccess, (req, res) => {
  const limit = Math.max(1, Math.min(Number.parseInt(req.query.limit, 10) || 20, 100));
  res.json({
    summary: reviewAckStats(),
    entries: reviewAckSnapshot(limit),
  });
});

app.post('/api/brief/news/review/ack', requireDebugAccess, (req, res) => {
  const region = typeof req.query.region === 'string' ? req.query.region.trim() : '';
  const reason = typeof req.query.reason === 'string' ? req.query.reason.trim() : '';
  const note = typeof req.query.note === 'string' ? req.query.note.trim() : '';
  if (!region || !reason) return res.status(400).json({ error: 'region and reason query parameters are required' });
  const entry = ackReviewItem(region, reason, note, { action: 'ack' });
  if (!entry) return res.status(400).json({ error: 'unable to acknowledge review item' });
  res.json({
    ok: true,
    entry: formatReviewAckEntry(entry),
    summary: reviewAckStats(),
  });
});

app.post('/api/brief/news/review/snooze', requireDebugAccess, (req, res) => {
  const region = typeof req.query.region === 'string' ? req.query.region.trim() : '';
  const reason = typeof req.query.reason === 'string' ? req.query.reason.trim() : '';
  const note = typeof req.query.note === 'string' ? req.query.note.trim() : '';
  const hours = Math.max(1, Math.min(Number.parseInt(req.query.hours, 10) || 24, 24 * 14));
  if (!region || !reason) return res.status(400).json({ error: 'region and reason query parameters are required' });
  const entry = ackReviewItem(region, reason, note || `Snoozed for ${hours}h`, { action: 'snooze', durationMs: hours * 60 * 60 * 1000 });
  if (!entry) return res.status(400).json({ error: 'unable to snooze review item' });
  res.json({
    ok: true,
    entry: formatReviewAckEntry(entry),
    summary: reviewAckStats(),
    snoozeHours: hours,
  });
});

app.delete('/api/brief/news/review/ack', requireDebugAccess, (req, res) => {
  const region = typeof req.query.region === 'string' ? req.query.region.trim() : '';
  const reason = typeof req.query.reason === 'string' ? req.query.reason.trim() : '';
  if (!region || !reason) return res.status(400).json({ error: 'region and reason query parameters are required' });
  res.json({
    ok: true,
    cleared: clearReviewAck(region, reason),
    summary: reviewAckStats(),
  });
});

app.get('/api/brief/news', async (req, res) => {
  const snapshot = await ensureCurrentData();
  if (!snapshot) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  const requestedMode = typeof req.query.llm === 'string' ? req.query.llm.trim().toLowerCase() : 'auto';
  const llmMode = ['auto', 'off', 'force'].includes(requestedMode) ? requestedMode : 'auto';
  if (llmMode === 'auto') {
    return res.json(buildNewsClusterSummary(snapshot) || {
      totalClusters: 0,
      topCluster: null,
      clusters: [],
      llm: null,
    });
  }
  try {
    const { clusters, llmDebug, qualitySummary } = await buildNewsClusters(snapshot.news || [], llmProvider, { mode: llmMode });
    return res.json(buildNewsClusterSummary({
      newsClusters: clusters,
      newsLlmDebug: llmDebug,
      newsClusterQuality: qualitySummary,
    }) || {
      totalClusters: 0,
      topCluster: null,
      clusters: [],
      llm: null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, llmMode });
  }
});

app.get('/api/brief/drilldown', async (req, res) => {
  const snapshot = await ensureCurrentData();
  if (!snapshot) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  const requestedKind = req.query.kind === 'suspect' ? 'suspect' : 'corroborated';
  const action = ['why', 'sources', 'expand'].includes(req.query.action) ? req.query.action : 'why';
  const index = Math.max(0, Number.parseInt(req.query.index, 10) || 0);
  const id = typeof req.query.id === 'string' && req.query.id.trim() ? req.query.id.trim() : null;
  const ref = typeof req.query.ref === 'string' && req.query.ref.trim() ? req.query.ref.trim() : null;
  const contextKey = typeof req.query.context === 'string' && req.query.context.trim() ? req.query.context.trim() : '';
  const memoryBefore = contextKey ? selectionMeta(contextKey) : null;
  const resolved = ref ? resolveSignalRef(snapshot, ref, requestedKind, contextKey) : { kind: requestedKind, index, id };
  const finalKind = resolved.kind || requestedKind;
  const finalIndex = resolved.index ?? index;
  const finalId = resolved.id ?? id;
  const item = getSignalSelection(snapshot, finalKind, finalIndex, finalId);
  const usedRememberedSelection = Boolean(ref && contextKey && memoryBefore?.id && item?.id === memoryBefore.id && ['that-one', 'top-one'].includes(String(ref).trim().toLowerCase()));
  if (item && contextKey) rememberSelection(contextKey, { kind: finalKind, index: finalIndex, id: item.id });
  res.json({
    kind: finalKind,
    action,
    index: finalIndex,
    id: item?.id || finalId,
    ref,
    context: contextKey || null,
    contextMemory: contextKey ? {
      usedRememberedSelection,
      before: memoryBefore,
      after: selectionMeta(contextKey),
    } : null,
    text: buildIMessengerDrilldown(currentData, { kind: finalKind, action, index: finalIndex, id: item?.id || finalId }),
    item,
  });
});

app.get('/api/brief/context', (req, res) => {
  const contextKey = typeof req.query.context === 'string' && req.query.context.trim() ? req.query.context.trim() : '';
  if (!contextKey) return res.status(400).json({ error: 'context query parameter is required' });
  res.json({
    context: contextKey,
    selection: selectionMeta(contextKey),
    memory: selectionMemoryStats(),
  });
});

app.get('/api/brief/context/health', (req, res) => {
  res.json({
    memory: selectionMemoryStats(),
  });
});

app.get('/api/brief/context/debug', (req, res) => {
  const limit = Math.max(1, Math.min(Number.parseInt(req.query.limit, 10) || 5, 20));
  res.json({
    memory: selectionMemoryStats(),
    contexts: selectionMemorySnapshot(limit),
  });
});

app.post('/api/brief/context/telemetry/reset', (req, res) => {
  const before = selectionMemoryStats();
  resetSelectionMemoryTelemetry();
  res.json({
    ok: true,
    before,
    after: selectionMemoryStats(),
  });
});

app.delete('/api/brief/context', (req, res) => {
  const contextKey = typeof req.query.context === 'string' && req.query.context.trim() ? req.query.context.trim() : '';
  if (!contextKey) return res.status(400).json({ error: 'context query parameter is required' });
  const existed = clearSelection(contextKey);
  res.json({
    context: contextKey,
    cleared: existed,
    selection: selectionMeta(contextKey),
  });
});

// API: health check
app.get('/api/health', (req, res) => {
  const openSkyRuntime = currentData?.airMeta?.runtimeState
    ? {
        ...currentData.airMeta.runtimeState,
        queryMode: currentData.airMeta.queryMode || null,
        cooldownUntil: currentData.airMeta.cooldownUntil || null,
        cacheAgeMinutes: currentData.airMeta.cacheAgeMinutes ?? null,
        fallback: Boolean(currentData.airMeta.fallback),
      }
    : readOpenSkyRuntimeState();
  const sourceOps = buildOperatorSourceOps(currentData || null);
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    lastSweep: lastSweepTime,
    nextSweep: lastSweepTime
      ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toISOString()
      : null,
    sweepInProgress,
    sweepStartedAt,
    sweepWatchdog: getSweepWatchdogSnapshot(),
    sourcesOk: currentData?.meta?.sourcesOk || 0,
    sourcesFailed: currentData?.meta?.sourcesFailed || 0,
    sourceHealthSummary: currentData?.healthSummary || null,
    sourceCounters: currentData?.healthSummary?.counters || null,
    sourceFailureClassification: currentData?.healthSummary?.failureClassification || null,
    openSkyRuntime,
    freshnessPolicy: {
      configured: getFreshnessPolicy(),
      activeSourceHealthPolicy: currentData?.healthSummary?.policy || null,
      activeEvidencePolicy: currentData?.evidenceSummary?.policy || null,
    },
    sourceInventory: sourceOps.inventory,
    sourceOps,
    llmEnabled: !!config.llm.provider,
    llmProvider: config.llm.provider,
    llmState: buildOperatorLlmStateContract(currentData || {}, { provider: config.llm.provider, model: llmProvider?.model || null }),
    runtimeLlm: buildOperatorLlmStateContract(currentData || {}, { provider: config.llm.provider, model: llmProvider?.model || null }).runtimeLlm,
    telegramEnabled: !!(config.telegram.botToken && config.telegram.chatId),
    refreshIntervalMinutes: config.refreshIntervalMinutes,
    language: currentLanguage,
    selectionMemory: selectionMemoryStats(),
    reviewAcks: reviewAckStats(),
    clusterReviewStats: summarizeClusterReviewStats(),
    clusterPressureStats: summarizeClusterPressureStats(),
    clusterRepairArtifacts: summarizeClusterRepairArtifacts(),
    trendSummary: memory.getTrendSummary(),
    agentAnalysis: currentData?.agentAnalysis ? {
      status: currentData.agentAnalysis.status,
      confidenceLabel: currentData.agentAnalysis.confidenceLabel,
      tippingPointCount: Array.isArray(currentData.agentAnalysis.tippingPoints) ? currentData.agentAnalysis.tippingPoints.length : 0,
      source: currentData.agentAnalysisMeta?.source || 'deterministic',
      refinementState: currentData.agentAnalysisMeta?.refinementState || 'not-requested',
      refinementCompletion: currentData.agentAnalysisMeta?.refinementCompletion || null,
      refinementTimedOut: Boolean(currentData.agentAnalysisMeta?.refinementTimedOut),
    } : null,
  });
});

// API: available locales
app.get('/api/locales', (req, res) => {
  res.json({
    current: currentLanguage,
    supported: getSupportedLocales(),
  });
});

// SSE: live updates
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

async function enrichIdeasAndPublish(synthesized, delta) {
  if (!llmProvider?.isConfigured) {
    synthesized.ideas = [];
    synthesized.ideasSource = 'disabled';
    return synthesized;
  }

  try {
    console.log('[Crucix] Generating LLM trade ideas...');
    const previousIdeas = memory.getLastRun()?.ideas || [];
    const llmIdeas = await generateLLMIdeas(llmProvider, synthesized, delta, previousIdeas);
    synthesized.ideas = llmIdeas || [];
    synthesized.ideasSource = llmIdeas ? 'llm' : 'llm-failed';
    console.log(`[Crucix] LLM ideas ready: ${synthesized.ideas.length} (${synthesized.ideasSource})`);
  } catch (llmErr) {
    console.error('[Crucix] LLM ideas failed (non-fatal):', llmErr.message);
    synthesized.ideas = [];
    synthesized.ideasSource = 'llm-failed';
  }

  currentData = synthesized;
  broadcast({ type: 'ideas_update', data: currentData });
  return synthesized;
}

async function enrichAgentAnalysisAndPublish(synthesized) {
  if (!llmProvider?.isConfigured) {
    synthesized.agentAnalysis = buildAgentAnalysis(synthesized, synthesized.agentAnalysis);
    synthesized.agentAnalysisMeta = buildAgentAnalysisMeta({
      error: 'llm-unavailable',
      model: null,
      refinementState: 'unavailable',
      refinementCompletion: 'unavailable',
    });
    return synthesized;
  }

  const attemptId = `analysis-refine-${String(++agentAnalysisRefinementSeq).padStart(4, '0')}`;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  synthesized.agentAnalysisMeta = buildAgentAnalysisMeta({
    refinementState: 'pending',
    refinementAttemptId: attemptId,
    refinementStartedAt: startedAt,
  });
  currentData = synthesized;
  broadcast({ type: 'analysis_update', data: currentData });

  try {
    console.log(`[Crucix] Generating LLM agent analysis (${attemptId})...`);
    const { analysis, meta } = await generateLLMAgentAnalysis(llmProvider, synthesized);
    const durationMs = Date.now() - startMs;
    if (analysis) {
      synthesized.agentAnalysis = buildAgentAnalysis(synthesized, analysis);
      synthesized.agentAnalysisMeta = buildAgentAnalysisMeta({
        ...meta,
        refinementState: 'completed',
        refinementAttemptId: attemptId,
        refinementStartedAt: startedAt,
        refinementCompletedAt: new Date().toISOString(),
        refinementDurationMs: durationMs,
        refinementCompletion: 'llm-applied',
      });
    } else {
      synthesized.agentAnalysis = buildAgentAnalysis(synthesized);
      synthesized.agentAnalysisMeta = buildAgentAnalysisMeta({
        ...meta,
        source: 'deterministic',
        refinementState: meta?.error === 'parse-failed' ? 'failed' : 'completed',
        refinementAttemptId: attemptId,
        refinementStartedAt: startedAt,
        refinementCompletedAt: new Date().toISOString(),
        refinementDurationMs: durationMs,
        refinementCompletion: meta?.error === 'parse-failed' ? 'fallback-parse-failed' : 'fallback-no-analysis',
      });
    }
    console.log(`[Crucix] Agent analysis ready: ${synthesized.agentAnalysis.status} (${synthesized.agentAnalysisMeta?.source || 'deterministic'}) [${synthesized.agentAnalysisMeta?.refinementCompletion || 'unknown'}]`);
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const timedOut = /timeout|timed out|abort/i.test(err.message || '');
    console.error('[Crucix] LLM agent analysis failed (non-fatal):', err.message);
    synthesized.agentAnalysis = buildAgentAnalysis(synthesized);
    synthesized.agentAnalysisMeta = buildAgentAnalysisMeta({
      source: 'deterministic',
      used: false,
      error: err.message,
      model: llmProvider.model || null,
      refinementState: timedOut ? 'timed-out' : 'failed',
      refinementAttemptId: attemptId,
      refinementStartedAt: startedAt,
      refinementCompletedAt: new Date().toISOString(),
      refinementDurationMs: durationMs,
      refinementTimedOut: timedOut,
      refinementCompletion: timedOut ? 'fallback-timeout' : 'fallback-error',
    });
  }

  currentData = synthesized;
  broadcast({ type: 'analysis_update', data: currentData });
  return synthesized;
}

// === Sweep Cycle ===
async function runSweepCycle() {
  if (sweepInProgress) {
    const watchdog = runSweepWatchdog();
    if (!watchdog.recovered) {
      console.log('[Crucix] Sweep already in progress, skipping');
      return;
    }
    console.log('[Crucix] Sweep watchdog cleared stale in-progress gate, continuing with new sweep');
  }

  sweepInProgress = true;
  sweepStartedAt = new Date().toISOString();
  broadcast({ type: 'sweep_start', timestamp: sweepStartedAt });
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Crucix] Starting sweep at ${new Date().toLocaleTimeString()}`);
  console.log(`${'='.repeat(60)}`);

  try {
    // 1. Run the full briefing sweep
    const rawData = await fullBriefing();

    // 2. Save to runs/latest.json
    writeFileSync(join(RUNS_DIR, 'latest.json'), JSON.stringify(rawData, null, 2));
    lastSweepTime = new Date().toISOString();

    // 3. Synthesize into dashboard format
    console.log('[Crucix] Synthesizing dashboard data...');
    const synthesized = await synthesize(rawData);
    const clusterReviewStats = recordClusterReviewStats(synthesized);
    const clusterPressureStats = recordClusterPressureStats(synthesized);
    const clusterRepairArtifacts = recordClusterRepairArtifacts(synthesized);
    if (synthesized.newsLlmDebug?.review) {
      synthesized.newsLlmDebug.review = attachClusterReviewStats(annotateReview(synthesized.newsLlmDebug.review));
    }
    if (synthesized.newsLlmDebug) synthesized.newsLlmDebug = attachClusterPressureStats(synthesized.newsLlmDebug);
    synthesized.clusterReviewStats = clusterReviewStats;
    synthesized.clusterPressureStats = clusterPressureStats;
    synthesized.clusterRepairArtifacts = clusterRepairArtifacts;

    // 4. Delta computation + memory
    const delta = memory.addRun(synthesized);
    synthesized.delta = delta;

    const sixHourBaselineRun = memory.getBaselineRun(6);
    synthesized.baseline6h = buildSixHourBaseline(synthesized, sixHourBaselineRun);
    synthesized.trendSummary = memory.getTrendSummary();
    synthesized.agentAnalysis = buildAgentAnalysis(synthesized);
    synthesized.agentAnalysisMeta = buildAgentAnalysisMeta({
      error: llmProvider?.isConfigured ? null : 'llm-unavailable',
      refinementState: llmProvider?.isConfigured ? 'queued' : 'unavailable',
      refinementCompletion: llmProvider?.isConfigured ? 'deterministic-published-awaiting-refinement' : 'unavailable',
    });

    // 5. Publish core data immediately so LLM idea generation never blocks /api/data
    if (!llmProvider?.isConfigured) {
      synthesized.ideas = [];
      synthesized.ideasSource = 'disabled';
    } else {
      synthesized.ideas = [];
      synthesized.ideasSource = 'pending';
    }

    currentData = synthesized;
    broadcast({ type: 'update', data: currentData });

    // 6. Alert evaluation — Telegram + Discord (LLM with rule-based fallback, multi-tier, semantic dedup)
    if (delta?.summary?.totalChanges > 0) {
      if (telegramAlerter.isConfigured) {
        telegramAlerter.evaluateAndAlert(llmProvider, delta, memory, synthesized).catch(err => {
          console.error('[Crucix] Telegram alert error:', err.message);
        });
      }
      if (discordAlerter.isConfigured) {
        discordAlerter.evaluateAndAlert(llmProvider, delta, memory, synthesized).catch(err => {
          console.error('[Crucix] Discord alert error:', err.message);
        });
      }
    }

    // Prune old alerted signals
    memory.pruneAlertedSignals();

    console.log(`[Crucix] Sweep complete — ${currentData.meta.sourcesOk}/${currentData.meta.sourcesQueried} sources OK`);
    console.log(`[Crucix] ${currentData.ideas.length} ideas (${synthesized.ideasSource}) | ${currentData.news.length} news | ${currentData.newsFeed.length} feed items`);
    if (delta?.summary) console.log(`[Crucix] Delta: ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical, direction: ${delta.summary.direction}`);
    console.log(`[Crucix] Next sweep at ${new Date(Date.now() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()}`);

    if (llmProvider?.isConfigured) {
      enrichIdeasAndPublish(synthesized, delta).catch(err => {
        console.error('[Crucix] Deferred ideas enrichment failed:', err.message);
      });
      enrichAgentAnalysisAndPublish(synthesized).catch(err => {
        console.error('[Crucix] Deferred agent analysis enrichment failed:', err.message);
      });
    }

  } catch (err) {
    console.error('[Crucix] Sweep failed:', err.message);
    broadcast({ type: 'sweep_error', error: err.message });
  } finally {
    sweepInProgress = false;
    sweepStartedAt = null;
    syncSnapshotRuntimeFreshness(currentData);
  }
}

// === Startup ===
async function start() {
  const port = config.port;

  console.log(`
  ╔══════════════════════════════════════════════╗
  ║           CRUCIX INTELLIGENCE ENGINE         ║
  ║          Local Palantir · 26 Sources         ║
  ╠══════════════════════════════════════════════╣
  ║  Dashboard:  http://localhost:${port}${' '.repeat(14 - String(port).length)}║
  ║  Health:     http://localhost:${port}/api/health${' '.repeat(4 - String(port).length)}║
  ║  Refresh:    Every ${config.refreshIntervalMinutes} min${' '.repeat(20 - String(config.refreshIntervalMinutes).length)}║
  ║  LLM:        ${(config.llm.provider || 'disabled').padEnd(31)}║
  ║  Telegram:   ${config.telegram.botToken ? 'enabled' : 'disabled'}${' '.repeat(config.telegram.botToken ? 24 : 23)}║
  ║  Discord:    ${config.discord?.botToken ? 'enabled' : config.discord?.webhookUrl ? 'webhook only' : 'disabled'}${' '.repeat(config.discord?.botToken ? 24 : config.discord?.webhookUrl ? 20 : 23)}║
  ╚══════════════════════════════════════════════╝
  `);

  const server = app.listen(port);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[Crucix] FATAL: Port ${port} is already in use!`);
      console.error(`[Crucix] A previous Crucix instance may still be running.`);
      console.error(`[Crucix] Fix:  taskkill /F /IM node.exe   (Windows)`);
      console.error(`[Crucix]       kill $(lsof -ti:${port})   (macOS/Linux)`);
      console.error(`[Crucix] Or change PORT in .env\n`);
    } else {
      console.error(`[Crucix] Server error:`, err.stack || err.message);
    }
    process.exit(1);
  });

  server.on('listening', async () => {
    console.log(`[Crucix] Server running on http://localhost:${port}`);

    // Auto-open browser
    // NOTE: On Windows, `start` in PowerShell is an alias for Start-Service, not cmd's start.
    // We must use `cmd /c start ""` to ensure it works in both cmd.exe and PowerShell.
    const openCmd = process.platform === 'win32' ? 'cmd /c start ""' :
                    process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${openCmd} "http://localhost:${port}"`, (err) => {
      if (err) console.log('[Crucix] Could not auto-open browser:', err.message);
    });

    // Try to load existing data first for instant display, but do not block initial sweep startup on it.
    try {
      const existing = JSON.parse(readFileSync(join(RUNS_DIR, 'latest.json'), 'utf8'));
      synthesize(existing, llmProvider, { newsLlmMode: 'off' }).then(data => {
        data.trendSummary = memory.getTrendSummary();
        data.agentAnalysis = buildAgentAnalysis(data);
        data.agentAnalysisMeta = buildAgentAnalysisMeta({
          error: llmProvider?.isConfigured ? null : 'llm-unavailable',
          refinementState: llmProvider?.isConfigured ? 'queued' : 'unavailable',
          refinementCompletion: llmProvider?.isConfigured ? 'deterministic-published-awaiting-refinement' : 'unavailable',
        });
        currentData = data;
        console.log('[Crucix] Loaded existing data from runs/latest.json — dashboard ready instantly');
        broadcast({ type: 'update', data: currentData });
        if (llmProvider?.isConfigured) {
          enrichAgentAnalysisAndPublish(data).catch(err => {
            console.error('[Crucix] Startup agent analysis enrichment failed:', err.message);
          });
        }
      }).catch(() => {
        console.log('[Crucix] Existing snapshot synth failed — waiting for fresh sweep');
      });
    } catch {
      console.log('[Crucix] No existing data found — first sweep required');
    }

    // Run first sweep (refreshes data in background)
    console.log('[Crucix] Running initial sweep...');
    runSweepCycle().catch(err => {
      console.error('[Crucix] Initial sweep failed:', err.message || err);
    });

    // Schedule recurring sweeps
    setInterval(runSweepCycle, config.refreshIntervalMinutes * 60 * 1000);
    setInterval(() => {
      try {
        runSweepWatchdog();
      } catch (err) {
        console.error('[Crucix] Sweep watchdog failed:', err?.message || err);
      }
    }, SWEEP_WATCHDOG_POLL_MS);
  });
}

// Graceful error handling — log full stack traces for diagnosis
process.on('unhandledRejection', (err) => {
  console.error('[Crucix] Unhandled rejection:', err?.stack || err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('[Crucix] Uncaught exception:', err?.stack || err?.message || err);
});

start().catch(err => {
  console.error('[Crucix] FATAL — Server failed to start:', err?.stack || err?.message || err);
  process.exit(1);
});
