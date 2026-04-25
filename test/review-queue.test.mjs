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

const context = {
  console,
  module: { exports: {} },
  exports: {},
  Date,
  Map,
  Math,
  Number,
  String,
  Object,
  Array,
  memory: { getSignalState: () => ({ regions: {}, updatedAt: null }) },
};
vm.createContext(context);
vm.runInContext(`
  const CLUSTER_REVIEW_STATE_KEY = 'cluster-review:regions';
  const CLUSTER_REVIEW_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
  const CLUSTER_REVIEW_DECAY_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000;
  ${extractChunk('function getClusterReviewStatsState() {', 'function getClusterPressureStatsState() {')}
  module.exports = { buildOperatorReviewQueue };
`, context);

const { buildOperatorReviewQueue } = context.module.exports;

test('buildOperatorReviewQueue marks empty-but-elevated queues explicitly', () => {
  const queue = buildOperatorReviewQueue({
    reviewItems: [],
    dismissedItems: [],
    stats: { chronicFailureCount: 2, recentFailureCount: 1 },
    pressure: { pressuredRegionCount: 3 },
  }, {
    quality: { reviewMetrics: { lowConfidenceCount: 5, suspiciousNearDuplicateCount: 2 } },
  });

  assert.equal(queue.state, 'empty_elevated_metrics');
  assert.equal(queue.totalItems, 0);
  assert.equal(queue.hasElevatedMetrics, true);
  assert.match(queue.summary, /metrics remain elevated/i);
  assert.equal(queue.metrics.chronicFailureCount, 2);
  assert.equal(queue.metrics.lowConfidenceCount, 5);
});

test('buildOperatorReviewQueue returns bounded actionable items with triage prioritization', () => {
  const review = {
    reviewItems: [
      { region: 'Iran', reason: 'no-json-match', severity: 'high', itemCount: 7, retried: true, repairAttempted: true, persistent: { chronic: true, consecutiveFailures: 9, lastStatus: 'heuristic-fallback' }, pressure: { pressureScore: 63 } },
      { region: 'Australia', reason: 'no-json-match', severity: 'high', itemCount: 5, retried: true, repairAttempted: true, persistent: { chronic: true, consecutiveFailures: 17, lastStatus: 'heuristic-fallback' }, pressure: { pressureScore: 62 } },
      { region: 'Pakistan', reason: 'shape-mismatch', severity: 'medium', itemCount: 3, retried: true, repairAttempted: false, persistent: { chronic: false, consecutiveFailures: 3, lastStatus: 'heuristic-fallback' }, pressure: { pressureScore: 39 } },
      { region: 'EU', reason: 'no-json-match', severity: 'high', itemCount: 6, retried: true, repairAttempted: true, persistent: { chronic: true, consecutiveFailures: 20, lastStatus: 'heuristic-fallback' }, pressure: { pressureScore: 9 } },
      { region: 'Spain', reason: 'shape-mismatch', severity: 'medium', itemCount: 2, retried: false, repairAttempted: false, persistent: { chronic: true, consecutiveFailures: 6, lastStatus: 'heuristic-fallback' }, pressure: { pressureScore: 0 } },
      { region: 'India', reason: 'no-json-match', severity: 'medium', itemCount: 2, retried: true, repairAttempted: false, persistent: { chronic: true, consecutiveFailures: 1, lastStatus: 'llm-used-retry' }, pressure: { pressureScore: 45 } },
    ],
    dismissedItems: [],
  };

  const queue = buildOperatorReviewQueue(review, {
    maxItems: 5,
    quality: {
      reviewMetrics: {
        topSplitRegions: [{ region: 'EU', count: 7 }, { region: 'Pakistan', count: 3 }],
        suspiciousNearDuplicates: [{ region: 'EU', similarity: 1 }, { region: 'Iran', similarity: 0.5 }],
      },
    },
  });
  assert.equal(queue.totalItems, 6);
  assert.equal(queue.visibleItems, 5);
  assert.equal(queue.hasMore, true);
  assert.equal(queue.bounded, true);
  assert.match(queue.summary, /6 active review items/i);
  assert.equal(JSON.stringify(queue.topReasons), JSON.stringify([
    { reason: 'no-json-match', count: 4 },
    { reason: 'shape-mismatch', count: 2 },
  ]));
  assert.equal(queue.items[0].region, 'EU');
  assert.equal(queue.items[0].chronic, true);
  assert.ok(queue.items[0].priorityScore > queue.items[1].priorityScore);
  assert.match(queue.items[0].priorityDrivers.join(' '), /near-duplicate|split-pattern/);
  assert.match(queue.items[1].suggestedAction, /Inspect response shape/i);
  assert.match(queue.items[3].suggestedAction, /schema mismatch/i);
});
