import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const realisticFixture = JSON.parse(readFileSync(new URL('./fixtures/review-queue-realistic-sample.json', import.meta.url), 'utf8'));

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
  reviewAckStats: () => ({ active: 0, repeatAckCount: 0, recentDismissalCount: 0, nextExpiry: null }),
  buildReviewWorkflowActions: item => ({
    actions: item?.sourceProvenance?.topSources?.[0]?.runtimeSource === 'GDELT'
      ? [
          { id: 'quarantine-source', label: 'Quarantine source', method: 'POST', href: '/api/review-workflow/action', sourceId: 'gdelt' },
          { id: 'suppress-source', label: 'Suppress source', method: 'POST', href: '/api/review-workflow/action', sourceId: 'gdelt' },
        ]
      : [],
    sourceItem: item?.sourceProvenance?.topSources?.[0]?.runtimeSource === 'GDELT' ? { id: 'gdelt', name: 'GDELT' } : null,
  }),
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
  assert.equal(queue.ackSummary.active, 0);
});

test('buildOperatorReviewQueue returns bounded actionable items with triage prioritization', () => {
  const review = JSON.parse(JSON.stringify(realisticFixture.review));
  review.reviewItems[0].sourceProvenance = {
    topSources: [{ runtimeSource: 'GDELT', source: 'GDELT', count: 4 }],
  };
  const queue = buildOperatorReviewQueue(review, {
    maxItems: 5,
    quality: realisticFixture.quality,
  });

  assert.equal(queue.totalItems, 6);
  assert.equal(queue.visibleItems, realisticFixture.expected.visibleItems);
  assert.equal(queue.hasMore, realisticFixture.expected.hasMore);
  assert.equal(queue.bounded, true);
  assert.match(queue.summary, /6 active review items/i);
  assert.equal(JSON.stringify(queue.topReasons), JSON.stringify(realisticFixture.expected.topReasons));
  assert.equal(queue.items[0].region, realisticFixture.expected.topRegion);
  assert.equal(queue.items[0].chronic, true);
  assert.ok(queue.items[0].priorityScore > queue.items[1].priorityScore);
  assert.match(queue.items[0].priorityDrivers.join(' '), /pressure|near-duplicate|split-pattern/);
  assert.match(queue.items[0].suggestedAction, /Inspect response shape/i);
  assert.equal(queue.items[0].actions.length, 5);
  assert.equal(queue.items[0].actions[0].id, 'ack');
  assert.match(queue.items[0].actions[0].href, /\/api\/brief\/news\/review\/ack\?/);
  assert.equal(queue.items[0].actions[1].id, 'snooze');
  assert.match(queue.items[0].actions[1].href, /hours=24/);
  assert.equal(queue.items[0].actions[2].id, 'quarantine-source');
  assert.equal(queue.items[0].actions[3].id, 'suppress-source');
  assert.equal(queue.items[0].actions[4].id, 'artifacts');
  assert.match(queue.items[0].actions[4].href, /\/api\/brief\/news\/review\/artifacts\?/);
  assert.equal(queue.items[0].dominantSource.id, 'gdelt');
  assert.equal(queue.metrics.lowConfidenceCount, 46);
  assert.equal(queue.metrics.suspiciousNearDuplicateCount, 1);
  assert.equal(queue.metrics.pressuredRegionCount, 8);
});
