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

test('runSweepWatchdog recovers an overdue sweep and records telemetry', () => {
  const broadcastEvents = [];
  const syncCalls = [];
  const context = {
    console: { log() {}, warn() {}, error() {} },
    Date,
    config: { review: { sweepWatchdogTimeoutMinutes: 45 } },
    currentData: { meta: { timestamp: '2026-04-24T21:32:21.212Z' } },
    loadReviewAcks() { return new Map(); },
    sweepInProgress: true,
    sweepStartedAt: '2026-04-24T20:30:00.000Z',
    runtimeJobState: { phase: 'synthesis', phaseStartedAt: '2026-04-24T20:31:00.000Z' },
    syncSnapshotRuntimeFreshness(snapshot) { syncCalls.push(snapshot); return snapshot; },
    broadcast(event) { broadcastEvents.push(event); },
  };
  vm.createContext(context);
  vm.runInContext(`
    ${extractChunk('const SWEEP_WATCHDOG_TIMEOUT_MS =', 'function loadJsonFile(path, fallback) {')}
    ${extractChunk('function markRuntimePhase(phase, nowIso = new Date().toISOString()) {', 'function syncSnapshotRuntimeFreshness(snapshot = null) {')}
    globalThis.__watchdogHarness = { getSweepWatchdogSnapshot, recoverHungSweep, runSweepWatchdog };
  `, context);

  const result = context.__watchdogHarness.runSweepWatchdog(new Date('2026-04-24T21:31:00.000Z').getTime());
  assert.equal(result.recovered, true);
  assert.equal(context.sweepInProgress, false);
  assert.equal(context.sweepStartedAt, null);
  assert.equal(result.telemetry.recoveryCount, 1);
  assert.equal(result.telemetry.lastRecoveryReason, 'synthesis-hang');
  assert.equal(result.watchdog.lastRecoveryPhase, 'synthesis');
  assert.equal(syncCalls.length, 1);
  assert.equal(broadcastEvents[0]?.type, 'sweep_watchdog_recovered');
  assert.equal(broadcastEvents[0]?.recoveredPhase, 'synthesis');
});

test('runSweepWatchdog leaves healthy active sweeps alone', () => {
  const context = {
    console: { log() {}, warn() {}, error() {} },
    Date,
    config: { review: { sweepWatchdogTimeoutMinutes: 45 } },
    currentData: null,
    loadReviewAcks() { return new Map(); },
    sweepInProgress: true,
    sweepStartedAt: '2026-04-24T21:15:00.000Z',
    runtimeJobState: { phase: 'briefing', phaseStartedAt: '2026-04-24T21:15:00.000Z' },
    syncSnapshotRuntimeFreshness(snapshot) { return snapshot; },
    broadcast() {},
  };
  vm.createContext(context);
  vm.runInContext(`
    ${extractChunk('const SWEEP_WATCHDOG_TIMEOUT_MS =', 'function loadJsonFile(path, fallback) {')}
    ${extractChunk('function markRuntimePhase(phase, nowIso = new Date().toISOString()) {', 'function syncSnapshotRuntimeFreshness(snapshot = null) {')}
    globalThis.__watchdogHarness = { getSweepWatchdogSnapshot, recoverHungSweep, runSweepWatchdog };
  `, context);

  const result = context.__watchdogHarness.runSweepWatchdog(new Date('2026-04-24T21:31:00.000Z').getTime());
  assert.equal(result.recovered, false);
  assert.equal(result.watchdog.overdue, false);
  assert.equal(result.watchdog.phase, 'briefing');
  assert.equal(context.sweepInProgress, true);
  assert.equal(context.sweepStartedAt, '2026-04-24T21:15:00.000Z');
});
