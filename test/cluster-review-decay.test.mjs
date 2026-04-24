import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const serverSource = readFileSync('/Users/rightclaw/services/crucix/server.mjs', 'utf8');

function extractChunk(startNeedle, endNeedle) {
  const start = serverSource.indexOf(startNeedle);
  const end = serverSource.indexOf(endNeedle, start);
  if (start === -1 || end === -1 || end <= start) throw new Error(`could not extract ${startNeedle}..${endNeedle}`);
  return serverSource.slice(start, end);
}

const code = [
  "const CLUSTER_REVIEW_STATE_KEY = 'cluster-review:regions';",
  'const CLUSTER_REVIEW_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;',
  'const CLUSTER_REVIEW_DECAY_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000;',
  extractChunk('function getClusterReviewStatsState() {', 'function attachClusterReviewStats(review = {}) {'),
  'module.exports = { summarizeClusterReviewStats, recordClusterReviewStats };',
].join('\n');

const stateStore = new Map();
const fakeNow = Date.parse('2026-04-24T20:40:00.000Z');
class FakeDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [fakeNow]));
  }
  static now() {
    return fakeNow;
  }
}

const context = {
  module: { exports: {} },
  exports: {},
  console,
  Date: FakeDate,
  Map,
  Math,
  Number,
  String,
  Object,
  Array,
  memory: {
    getSignalState(key) {
      return stateStore.get(key);
    },
    setSignalState(key, value) {
      stateStore.set(key, value);
    },
  },
};
vm.createContext(context);
vm.runInContext(code, context);
const { summarizeClusterReviewStats, recordClusterReviewStats } = context.module.exports;

test('recordClusterReviewStats tracks decayed failure and success windows', () => {
  const first = recordClusterReviewStats({
    newsLlmDebug: {
      perRegion: [
        { region: 'Iran', status: 'heuristic-fallback', reason: 'json-parse-failed', itemCount: 2 },
      ],
    },
  });

  assert.equal(first.topRegions[0].failureWindow, 1);
  assert.equal(first.topRegions[0].successWindow, 0);
  assert.equal(first.topRegions[0].decayedFailureRate, 1);

  const state = stateStore.get('cluster-review:regions');
  state.regions.Iran.lastWindowAt = '2026-04-18T20:40:00.000Z';
  state.regions.Iran.lastSeenAt = '2026-04-18T20:40:00.000Z';
  state.regions.Iran.lastFailureAt = '2026-04-18T20:40:00.000Z';
  state.regions.Iran.failureWindow = 1;
  state.regions.Iran.successWindow = 0;
  stateStore.set('cluster-review:regions', state);

  const second = recordClusterReviewStats({
    newsLlmDebug: {
      perRegion: [
        { region: 'Iran', status: 'llm-used', reason: null, itemCount: 2 },
      ],
    },
  });

  assert.equal(second.topRegions[0].successCount, 1);
  assert.equal(second.topRegions[0].decayedFailureRate < 0.5, true);
  assert.equal(second.topRegions[0].recovering, true);
});

test('summarizeClusterReviewStats surfaces recovering regions from stored state', () => {
  stateStore.set('cluster-review:regions', {
    updatedAt: '2026-04-24T20:40:00.000Z',
    regions: {
      India: {
        totalSeen: 4,
        failureCount: 2,
        successCount: 2,
        consecutiveFailures: 0,
        lastSeenAt: '2026-04-24T20:40:00.000Z',
        lastFailureAt: '2026-04-23T20:40:00.000Z',
        lastSuccessAt: '2026-04-24T20:40:00.000Z',
        lastWindowAt: '2026-04-24T20:40:00.000Z',
        failureWindow: 0.25,
        successWindow: 1.25,
        reasons: { 'shape-mismatch': 2 },
      },
    },
  });

  const summary = summarizeClusterReviewStats();
  assert.equal(summary.recoveringRegionCount, 1);
  assert.equal(summary.decayHalfLifeHours, 72);
  assert.equal(summary.topRegions[0].recovering, true);
  assert.equal(summary.topRegions[0].decayedFailureRate < 0.4, true);
});
