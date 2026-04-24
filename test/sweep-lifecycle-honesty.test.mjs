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

test('syncSnapshotRuntimeFreshness overwrites stale captured sweep state with runtime truth', () => {
  const context = {
    console,
    Date,
    lastSweepTime: '2026-04-24T21:26:12.444Z',
    sweepInProgress: false,
  };
  vm.createContext(context);
  vm.runInContext(`
    ${extractChunk('function normalizeEnum(value, allowed = [], fallback = null) {', 'function normalizeEvidenceRefs(refs = []) {')}
    ${extractChunk('function normalizeAgentAnalysis(input = {}) {', 'function confidenceRank(value =')}
    ${extractChunk('function syncSnapshotRuntimeFreshness(snapshot = null) {', 'async function ensureCurrentData() {')}
    globalThis.__sweepHarness = { syncSnapshotRuntimeFreshness };
  `, context);

  const snapshot = {
    meta: { timestamp: '2026-04-24T21:25:59.000Z' },
    agentAnalysis: {
      status: 'ready',
      confidenceLabel: 'low',
      freshness: {
        generatedAt: '2026-04-24T21:25:59.000Z',
        lastSweep: '2026-04-24T21:25:59.000Z',
        sweepInProgress: true,
        trendUpdatedAt: '2026-04-24T21:25:59.000Z',
      },
      horizons: [],
      outlook: [],
      risks: [],
      tippingPoints: [],
      caveats: [],
      iMessageSummary: [],
    },
  };

  const result = context.__sweepHarness.syncSnapshotRuntimeFreshness(snapshot);
  assert.equal(result.agentAnalysis.freshness.sweepInProgress, false);
  assert.equal(result.agentAnalysis.freshness.lastSweep, '2026-04-24T21:25:59.000Z');
});

test('syncSnapshotRuntimeFreshness reflects active runtime sweep state when a sweep is currently running', () => {
  const context = {
    console,
    Date,
    lastSweepTime: '2026-04-24T21:26:12.444Z',
    sweepInProgress: true,
  };
  vm.createContext(context);
  vm.runInContext(`
    ${extractChunk('function normalizeEnum(value, allowed = [], fallback = null) {', 'function normalizeEvidenceRefs(refs = []) {')}
    ${extractChunk('function normalizeAgentAnalysis(input = {}) {', 'function confidenceRank(value =')}
    ${extractChunk('function syncSnapshotRuntimeFreshness(snapshot = null) {', 'async function ensureCurrentData() {')}
    globalThis.__sweepHarness = { syncSnapshotRuntimeFreshness };
  `, context);

  const snapshot = {
    meta: { timestamp: '2026-04-24T21:26:12.444Z' },
    agentAnalysis: {
      status: 'ready',
      confidenceLabel: 'low',
      freshness: {
        generatedAt: '2026-04-24T21:26:12.444Z',
        lastSweep: '2026-04-24T21:26:12.444Z',
        sweepInProgress: false,
        trendUpdatedAt: '2026-04-24T21:26:12.444Z',
      },
      horizons: [],
      outlook: [],
      risks: [],
      tippingPoints: [],
      caveats: [],
      iMessageSummary: [],
    },
  };

  const result = context.__sweepHarness.syncSnapshotRuntimeFreshness(snapshot);
  assert.equal(result.agentAnalysis.freshness.sweepInProgress, true);
});
