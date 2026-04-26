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
    RUNS_DIR: '/tmp/crucix-runs',
    join: (...parts) => parts.join('/'),
    config: { refreshIntervalMinutes: 15, review: { sweepWatchdogTimeoutMinutes: 45, sweepWatchdogPollSeconds: 30 } },
    loadReviewAcks() { return new Map(); },
    currentData: null,
    lastSweepTime: null,
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
    llmProvider: { isConfigured: false, model: 'test-model' },
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
    attachClusterReviewStats: x => x,
    annotateReview: x => x,
    attachClusterPressureStats: x => x,
    buildSixHourBaseline: () => ({ ok: true }),
    buildAgentAnalysis: () => ({ status: 'ready', confidenceLabel: 'low', freshness: {}, horizons: [], outlook: [], risks: [], tippingPoints: [], caveats: [], iMessageSummary: [] }),
    buildAgentAnalysisMeta: overridesMeta => ({ source: 'deterministic', ...overridesMeta }),
    enrichIdeasAndPublish: async () => {},
    enrichAgentAnalysisAndPublish: async () => {},
    writeFileSync(path, data) { writes.push({ path, data: String(data) }); },
    broadcast(event) { broadcasts.push(event); },
    memory: {
      addRun() { return { summary: { totalChanges: 0, criticalChanges: 0, direction: 'flat' } }; },
      getBaselineRun() { return null; },
      getTrendSummary() { return { windows: [] }; },
      pruneAlertedSignals() { memoryPrunes.push(true); },
    },
    syncSnapshotRuntimeFreshness(snapshot) { syncCalls.push(snapshot); return snapshot; },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(`
    ${extractChunk('const SWEEP_WATCHDOG_TIMEOUT_MS =', 'function loadJsonFile(path, fallback) {')}
    ${extractChunk('function markRuntimePhase(phase, nowIso = new Date().toISOString()) {', 'function syncSnapshotRuntimeFreshness(snapshot = null) {')}
    ${extractChunk('async function runSweepCycle() {', '// === Startup ===')}
    globalThis.__cycleHarness = { runSweepCycle, getSweepWatchdogSnapshot, runSweepWatchdog };
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
  assert.equal(memoryPrunes.length, 1);
  assert.equal(syncCalls.length, 1);
  assert.equal(context.currentData?.agentAnalysis?.status, 'ready');
  assert.equal(context.currentData?.ideasSource, 'disabled');
  assert.equal(context.runtimeJobState.lastCompletedPhase, 'synthesis');
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
