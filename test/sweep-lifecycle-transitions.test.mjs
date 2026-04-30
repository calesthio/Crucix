import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

function extractChunk(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not extract chunk between ${startMarker} and ${endMarker}`);
  }
  return source.slice(start, end);
}

function buildHarness(overrides = {}) {
  const writes = [];
  const broadcasts = [];
  const syncCalls = [];
  const memoryPrunes = [];
  const context = {
    console: { log() {}, warn() {}, error() {} },
    Date,
    JSON,
    app: { get() {}, post() {}, use() {}, listen() {} },
    RUNS_DIR: '/tmp/crucix-runs',
    join: (...parts) => parts.join('/'),
    config: { refreshIntervalMinutes: 15, review: { sweepWatchdogTimeoutMinutes: 45, sweepWatchdogPollSeconds: 30 } },
    loadReviewAcks() { return new Map(); },
    loadReviewWorkflowAudit() { return []; },
    loadSourceControlAudit() { return []; },
    loadClusterRepairActions() { return { suppressedClusterIds: [], decisions: [] }; },
    loadNoiseSuppressionHistory() { return { version: 'noise-suppression-history-v2', updatedAt: null, lastSweepAt: null, retentionMs: 14 * 24 * 60 * 60 * 1000, halfLifeMs: 5 * 24 * 60 * 60 * 1000, duplicateBursts: {}, repetitiveLowValueEvents: {}, sourceRuleHits: {}, telemetry: { lastPrunedAt: null, pruningActive: false, buckets: {}, summary: { totalEntries: 0, retainedEntries: 0, expiredEntriesRemoved: 0, overflowEntriesRemoved: 0 } } }; },
    currentData: null,
    lastSweepTime: null,
    lastBriefingCompletedAt: null,
    lastRawSnapshotPersistedAt: null,
    sweepStartedAt: null,
    sweepInProgress: false,
    runtimeJobState: {
      phase: 'idle',
      phaseStartedAt: null,
      lastCompletedPhase: null,
      lastCompletedAt: null,
      lastFailurePhase: null,
      lastFailureAt: null,
      lastFailureReason: null,
      lastRecoveryPhase: null,
      lastRecoveryAt: null,
      lastRecoveryReason: null,
    },
    runtimeJobTelemetry: {
      synthesis: { active: false, attemptCount: 0, retryCount: 0, cancellationCount: 0, lastAttemptId: null, lastStartedAt: null, lastCompletedAt: null, lastDurationMs: null, lastOutcome: null, lastError: null, lastTimedOut: false, timeoutMs: 2700000 },
      ideas: { active: false, attemptCount: 0, retryCount: 0, cancellationCount: 0, lastAttemptId: null, lastStartedAt: null, lastCompletedAt: null, lastDurationMs: null, lastOutcome: null, lastError: null, lastTimedOut: false, timeoutMs: 90000 },
      analysis: { active: false, attemptCount: 0, retryCount: 0, cancellationCount: 0, lastAttemptId: null, lastStartedAt: null, lastCompletedAt: null, lastDurationMs: null, lastOutcome: null, lastError: null, lastTimedOut: false, timeoutMs: 90000 },
    },
    llmProvider: { isConfigured: false, model: 'test-model' },
    agentAnalysisRefinementSeq: 0,
    telegramAlerter: { isConfigured: false, evaluateAndAlert() { throw new Error('should not alert'); } },
    discordAlerter: { isConfigured: false, evaluateAndAlert() { throw new Error('should not alert'); } },
    fullBriefing: async () => ({ meta: { timestamp: '2026-04-24T22:20:00.000Z' } }),
    synthesize: async raw => ({
      meta: { sourcesOk: 28, sourcesQueried: 29, timestamp: raw.meta?.timestamp || '2026-04-24T22:20:00.000Z' },
      news: [],
      newsFeed: [],
      evidenceSummary: {},
      healthSummary: {},
    }),
    recordClusterReviewStats: () => ({ trackedRegionCount: 0 }),
    recordClusterPressureStats: () => ({ trackedRegionCount: 0 }),
    recordClusterRepairArtifacts: () => ({ entryCount: 0 }),
    recordNoiseSuppressionHistory: () => ({}),
    attachClusterReviewStats: x => x,
    annotateReview: x => x,
    attachClusterPressureStats: x => x,
    buildSixHourBaseline: () => ({ ok: true }),
    buildAgentAnalysis: () => ({ status: 'ready', confidenceLabel: 'low', freshness: {}, horizons: [], outlook: [], risks: [], tippingPoints: [], caveats: [], iMessageSummary: [] }),
    buildAgentAnalysisMeta: overridesMeta => ({ source: 'deterministic', ...overridesMeta }),
    buildOperatorSourceOps: () => ({ inventory: { total: 1 } }),
    buildNoiseSuppressionTelemetrySnapshot: () => ({ version: 'noise-suppression-history-trend-v1', summary: {}, bucketCounts: {}, candidateCounts: {} }),
    generateLLMAgentAnalysis: async () => ({ analysis: null, meta: { error: 'parse-failed' } }),
    processCriticalEventQueue: () => {},
    processOperationalAlerts: async () => ({}),
    getSourceQueueSummary: () => ({ activeCount: 0, sources: [] }),
    enrichIdeasAndPublish: async () => {},
    enrichAgentAnalysisAndPublish: async () => {},
    writeFileSync(path, data) { writes.push({ path, data: String(data) }); },
    broadcast(event) { broadcasts.push(event); },
    memory: {
      addRun() { return { summary: { totalChanges: 0, criticalChanges: 0, direction: 'flat' } }; },
      getBaselineRun() { return null; },
      getTrendSummary() { return { windows: [] }; },
      getSourceHealthHistory() { return []; },
      getReviewPressureHistory() { return []; },
      getLlmFailureHistory() { return []; },
      getSourcePerformanceHistory() { return []; },
      getNoiseSuppressionTelemetryHistory() { return { version: 'noise-suppression-history-trend-v1', snapshotCount: 0, snapshots: [], deltaViews: [] }; },
      pruneAlertedSignals() { memoryPrunes.push(true); },
    },
    syncSnapshotRuntimeFreshness(snapshot) { syncCalls.push(snapshot); return snapshot; },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(`
    ${extractChunk('const SWEEP_WATCHDOG_TIMEOUT_MS =', 'function loadJsonFile(path, fallback) {')}
    ${extractChunk('function markRuntimePhase(phase, nowIso = new Date().toISOString()) {', 'function syncSnapshotRuntimeFreshness(snapshot = null) {')}
    ${extractChunk('function shouldDeferStartupPreviewAnalysis() {', 'function shouldPublishSnapshotUpdate(targetSnapshot, liveSnapshot = currentData) {')}
    ${extractChunk('function shouldPublishSnapshotUpdate(targetSnapshot, liveSnapshot = currentData) {', 'function getRuntimeJobsSnapshot() {')}
    ${extractChunk('async function enrichAgentAnalysisAndPublish(synthesized, options = {}) {', '// === Sweep Cycle ===')}
    ${extractChunk('async function runSweepCycle() {', '// === Startup ===')}
    globalThis.__cycleHarness = { runSweepCycle, getSweepWatchdogSnapshot, runSweepWatchdog, getRuntimeJobsSnapshot, shouldDeferStartupPreviewAnalysis, shouldPublishSnapshotUpdate, enrichAgentAnalysisAndPublish };
  `, context);
  return { context, writes, broadcasts, syncCalls, memoryPrunes };
}

test('runSweepCycle clears lifecycle state and syncs snapshot after a successful sweep', async () => {
  const { context, writes, broadcasts, syncCalls, memoryPrunes } = buildHarness();
  await context.__cycleHarness.runSweepCycle();
  assert.equal(context.sweepInProgress, false);
  assert.equal(context.sweepStartedAt, null);
  assert.ok(context.lastSweepTime);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/tmp/crucix-runs/latest.json');
  assert.equal(broadcasts[0]?.type, 'sweep_start');
  assert.equal(broadcasts[1]?.type, 'update');
  assert.ok(memoryPrunes.length >= 0);
  assert.ok(syncCalls.length >= 1);
  assert.equal(context.currentData?.agentAnalysis?.status, 'ready');
  assert.equal(context.currentData?.ideasSource, 'disabled');
  assert.ok([null, 'synthesis'].includes(context.runtimeJobState.lastCompletedPhase));
  const jobs = context.__cycleHarness.getRuntimeJobsSnapshot();
  assert.equal(jobs.synthesis.attemptCount, 1);
  assert.ok(['completed', 'failed'].includes(jobs.synthesis.lastOutcome));
});

test('runSweepCycle clears lifecycle state and emits sweep_error after a failed sweep', async () => {
  const { context, broadcasts, syncCalls } = buildHarness({
    fullBriefing: async () => { throw new Error('boom'); },
  });
  await context.__cycleHarness.runSweepCycle();
  assert.equal(context.sweepInProgress, false);
  assert.equal(context.sweepStartedAt, null);
  assert.equal(context.lastSweepTime, null);
  assert.equal(broadcasts[0]?.type, 'sweep_start');
  assert.equal(broadcasts[1]?.type, 'sweep_error');
  assert.equal(broadcasts[1]?.error, 'boom');
  assert.equal(syncCalls.length, 1);
  assert.equal(context.runtimeJobState.lastFailureReason, 'boom');
  const jobs = context.__cycleHarness.getRuntimeJobsSnapshot();
  assert.equal(jobs.synthesis.lastOutcome, 'failed');
  assert.equal(jobs.synthesis.lastError, 'boom');
});

test('runSweepCycle recovers an overdue stuck gate before starting a new sweep', async () => {
  const { context, broadcasts, syncCalls } = buildHarness({
    currentData: { agentAnalysis: { status: 'ready', confidenceLabel: 'low', freshness: {}, horizons: [], outlook: [], risks: [], tippingPoints: [], caveats: [], iMessageSummary: [] } },
    sweepInProgress: true,
    sweepStartedAt: '2026-04-24T20:00:00.000Z',
  });
  await context.__cycleHarness.runSweepCycle();
  assert.equal(context.sweepInProgress, false);
  assert.equal(context.sweepStartedAt, null);
  assert.equal(broadcasts[0]?.type, 'sweep_watchdog_recovered');
  assert.equal(broadcasts[0]?.recoveredPhase, 'idle');
  assert.equal(broadcasts[1]?.type, 'sweep_start');
  assert.equal(broadcasts[2]?.type, 'update');
  assert.ok(syncCalls.length >= 2);
});

test('runSweepCycle skips when an active sweep is healthy and not overdue', async () => {
  const { context, broadcasts, syncCalls, writes } = buildHarness({
    sweepInProgress: true,
    sweepStartedAt: '2026-04-24T21:20:00.000Z',
  });
  const realNow = Date.now;
  Date.now = () => new Date('2026-04-24T21:31:00.000Z').getTime();
  try {
    await context.__cycleHarness.runSweepCycle();
  } finally {
    Date.now = realNow;
  }
  assert.equal(context.sweepInProgress, true);
  assert.equal(context.sweepStartedAt, '2026-04-24T21:20:00.000Z');
  assert.equal(broadcasts.length, 0);
  assert.equal(syncCalls.length, 0);
  assert.equal(writes.length, 0);
});

test('runSweepCycle closes primary sweep state before deferred enrichments settle', async () => {
  let ideasResolve;
  let analysisResolve;
  const ideasPromise = new Promise(resolve => { ideasResolve = resolve; });
  const analysisPromise = new Promise(resolve => { analysisResolve = resolve; });
  const { context, syncCalls } = buildHarness({
    llmProvider: { isConfigured: true, model: 'test-model' },
    enrichIdeasAndPublish: () => ideasPromise,
    enrichAgentAnalysisAndPublish: () => analysisPromise,
  });
  await context.__cycleHarness.runSweepCycle();
  assert.equal(context.sweepInProgress, false);
  assert.equal(context.sweepStartedAt, null);
  assert.equal(context.runtimeJobTelemetry.synthesis.active, false);
  assert.ok(['idle', 'llm-ideas-refinement', 'llm-analysis-refinement'].includes(context.runtimeJobState.phase));
  assert.ok(syncCalls.length >= 1);
  ideasResolve();
  analysisResolve();
  await Promise.all([ideasPromise, analysisPromise]);
});

test('runSweepCycle closes primary sweep state before operational alert processing settles', async () => {
  let releaseAlerts;
  const alertsPromise = new Promise(resolve => { releaseAlerts = resolve; });
  const runPromiseHolder = {};
  const { context } = buildHarness({
    processOperationalAlerts: async () => {
      await alertsPromise;
      return {};
    },
  });
  runPromiseHolder.promise = context.__cycleHarness.runSweepCycle();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.currentData?.meta?.sourcesOk, 28);
  assert.equal(context.sweepInProgress, false);
  assert.equal(context.sweepStartedAt, null);
  assert.equal(context.runtimeJobTelemetry.synthesis.active, false);
  assert.equal(context.runtimeJobState.phase, 'idle');
  releaseAlerts();
  await runPromiseHolder.promise;
});

test('runSweepCycle does not mark last published sweep until snapshot publish succeeds', async () => {
  let releaseSynthesis;
  const synthPromise = new Promise(resolve => { releaseSynthesis = resolve; });
  const oldPublishedAt = '2026-04-24T20:00:00.000Z';
  const { context } = buildHarness({
    lastSweepTime: oldPublishedAt,
    synthesize: async raw => {
      await synthPromise;
      return {
        meta: { sourcesOk: 28, sourcesQueried: 29, timestamp: raw.meta?.timestamp || '2026-04-24T22:20:00.000Z' },
        news: [],
        newsFeed: [],
        evidenceSummary: {},
        healthSummary: {},
      };
    },
  });
  const runPromise = context.__cycleHarness.runSweepCycle();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.lastBriefingCompletedAt != null, true);
  assert.equal(context.lastRawSnapshotPersistedAt != null, true);
  assert.equal(context.lastSweepTime, oldPublishedAt);
  assert.equal(context.currentData, null);
  releaseSynthesis();
  await runPromise;
  assert.notEqual(context.lastSweepTime, oldPublishedAt);
  assert.equal(context.currentData?.meta?.sourcesOk, 28);
});

test('startup preview analysis is deferred while a sweep is already active', () => {
  const { context } = buildHarness({
    sweepInProgress: true,
    runtimeJobState: {
      phase: 'briefing',
      phaseStartedAt: '2026-04-24T22:00:00.000Z',
      lastCompletedPhase: null,
      lastCompletedAt: null,
      lastFailurePhase: null,
      lastFailureAt: null,
      lastFailureReason: null,
      lastRecoveryPhase: null,
      lastRecoveryAt: null,
      lastRecoveryReason: null,
    },
    runtimeJobTelemetry: {
      synthesis: { active: true, attemptCount: 1, retryCount: 0, cancellationCount: 0, lastAttemptId: 'sweep-0001', lastStartedAt: '2026-04-24T22:00:00.000Z', lastCompletedAt: null, lastDurationMs: null, lastOutcome: null, lastError: null, lastTimedOut: false, timeoutMs: 2700000 },
      ideas: { active: false, attemptCount: 0, retryCount: 0, cancellationCount: 0, lastAttemptId: null, lastStartedAt: null, lastCompletedAt: null, lastDurationMs: null, lastOutcome: null, lastError: null, lastTimedOut: false, timeoutMs: 90000 },
      analysis: { active: false, attemptCount: 0, retryCount: 0, cancellationCount: 0, lastAttemptId: null, lastStartedAt: null, lastCompletedAt: null, lastDurationMs: null, lastOutcome: null, lastError: null, lastTimedOut: false, timeoutMs: 90000 },
    },
  });
  assert.equal(context.__cycleHarness.shouldDeferStartupPreviewAnalysis(), true);
});

test('startup preview analysis does not overwrite fresher sweep data when it finishes later', async () => {
  const { context, broadcasts } = buildHarness({
    llmProvider: { isConfigured: true, model: 'test-model' },
    currentData: {
      meta: { timestamp: '2026-04-24T22:30:00.000Z' },
      agentAnalysis: { status: 'ready', confidenceLabel: 'low', freshness: {}, horizons: [], outlook: [], risks: [], tippingPoints: [], caveats: [], iMessageSummary: [] },
      agentAnalysisMeta: { refinementState: 'completed' },
    },
    generateLLMAgentAnalysis: async () => ({ analysis: null, meta: { error: 'parse-failed' } }),
  });
  const stalePreview = {
    meta: { timestamp: '2026-04-24T22:10:00.000Z' },
    agentAnalysis: { status: 'ready', confidenceLabel: 'low', freshness: {}, horizons: [], outlook: [], risks: [], tippingPoints: [], caveats: [], iMessageSummary: [] },
    agentAnalysisMeta: { refinementState: 'queued' },
  };
  await context.__cycleHarness.enrichAgentAnalysisAndPublish(stalePreview, { mode: 'startup-preview' });
  assert.equal(context.currentData.meta.timestamp, '2026-04-24T22:30:00.000Z');
  assert.equal(broadcasts.length, 0);
});
