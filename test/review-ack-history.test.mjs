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
  'const REVIEW_ACK_TTL_MS = 72 * 60 * 60 * 1000;',
  'const REVIEW_ACK_MAX_ENTRIES = 100;',
  'const reviewAcks = new Map();',
  extractChunk('function reviewAckKey(item = {}) {', 'function getClusterReviewStatsState() {'),
  'module.exports = { reviewAckKey, reviewAckSnapshot, reviewAckStats, ackReviewItem, annotateReview };',
].join('\n');

const context = {
  module: { exports: {} },
  exports: {},
  console,
  Date,
  Map,
  Math,
  Number,
  String,
  Array,
  saveReviewAcks() {},
};
vm.createContext(context);
vm.runInContext(code, context);
const { reviewAckSnapshot, reviewAckStats, ackReviewItem, annotateReview } = context.module.exports;

test('ackReviewItem tracks repeated acknowledgements and recent dismissals', async () => {
  const first = ackReviewItem('Iran', 'json-parse-failed', 'first');
  await new Promise(resolve => setTimeout(resolve, 5));
  const second = ackReviewItem('Iran', 'json-parse-failed', 'second');

  assert.equal(first.ackCount, 1);
  assert.equal(second.ackCount, 2);
  assert.equal(second.note, 'second');

  const summary = reviewAckStats();
  assert.equal(summary.active, 1);
  assert.equal(summary.totalAckCount, 2);
  assert.equal(summary.repeatAckCount, 1);
  assert.equal(summary.recentDismissalCount, 1);
  assert.equal(summary.recentDismissals[0].region, 'Iran');
  assert.equal(summary.recentDismissals[0].ackCount, 2);

  const snapshot = reviewAckSnapshot(5);
  assert.equal(snapshot[0].lastAckedAt >= snapshot[0].firstAckedAt, true);
});

test('annotateReview exposes dismissed items and recent dismissal summary', () => {
  ackReviewItem('India', 'shape-mismatch', 'muted');
  const annotated = annotateReview({
    reviewItems: [
      { region: 'India', reason: 'shape-mismatch' },
      { region: 'EU', reason: 'timeout' },
    ],
  });

  assert.equal(annotated.activeCount, 1);
  assert.equal(annotated.dismissedCount, 1);
  assert.equal(annotated.dismissedItems[0].dismissed, true);
  assert.equal(annotated.ackSummary.recentDismissalCount >= 1, true);
  assert.equal(Array.isArray(annotated.recentDismissals), true);
  assert.equal(annotated.recentDismissals[0].region.length > 0, true);
});
