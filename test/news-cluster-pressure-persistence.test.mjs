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
  "const CLUSTER_PRESSURE_STATE_KEY = 'cluster-review:pressure';",
  'const CLUSTER_PRESSURE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;',
  extractChunk('function getClusterPressureStatsState() {', 'function getClusterRepairArtifactsState() {'),
  'module.exports = { summarizeClusterPressureStats, recordClusterPressureStats, attachClusterPressureStats };',
].join('\n');

const stateStore = new Map();
const context = {
  module: { exports: {} },
  exports: {},
  console,
  Date,
  Map,
  Object,
  Array,
  Number,
  String,
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
const { summarizeClusterPressureStats, recordClusterPressureStats, attachClusterPressureStats } = context.module.exports;

test('recordClusterPressureStats persists retry and tuning pressure across runs', () => {
  const first = recordClusterPressureStats({
    newsLlmDebug: {
      perRegion: [
        {
          region: 'Iran',
          status: 'llm-used-retry',
          reason: 'retry-success',
          retried: true,
          repairAttempted: true,
          tuning: { maxRetries: 2, repairTimeout: 60000 },
        },
      ],
    },
  });
  assert.equal(first.totalRetries, 1);
  assert.equal(first.totalBackoffs, 1);
  assert.equal(first.totalRepairAttempts, 1);
  assert.equal(first.totalTunedRegions, 1);
  assert.equal(first.topRegions[0].region, 'Iran');
  assert.equal(first.topRegions[0].maxRetriesConfigured, 2);

  const second = recordClusterPressureStats({
    newsLlmDebug: {
      perRegion: [
        {
          region: 'Iran',
          status: 'heuristic-fallback',
          reason: 'json-parse-failed',
          retried: false,
          repairAttempted: false,
          tuning: { maxRetries: 0, repairTimeout: 45000 },
        },
      ],
    },
  });

  assert.equal(second.totalRetries, 1);
  assert.equal(second.topRegions[0].totalSeen, 2);
  assert.equal(second.topRegions[0].heuristicFallbackCount, 1);
});

test('attachClusterPressureStats decorates per-region entries with persistent pressure', () => {
  recordClusterPressureStats({
    newsLlmDebug: {
      perRegion: [
        {
          region: 'India',
          status: 'llm-used-retry',
          reason: 'retry-success',
          retried: true,
          repairAttempted: false,
          tuning: { maxRetries: 1, repairTimeout: 50000 },
        },
      ],
    },
  });

  const attached = attachClusterPressureStats({
    perRegion: [
      { region: 'India', status: 'llm-used-retry', retried: true, tuning: { maxRetries: 1, repairTimeout: 50000 } },
      { region: 'EU', status: 'llm-used', retried: false, tuning: { maxRetries: 0, repairTimeout: 45000 } },
    ],
  });

  assert.equal(attached.persistentPressure.trackedRegionCount >= 1, true);
  assert.equal(attached.perRegion[0].persistent.region, 'India');
  assert.equal(attached.perRegion[0].persistent.retryCount >= 1, true);
  assert.equal(attached.perRegion[1].persistent, null);
});

