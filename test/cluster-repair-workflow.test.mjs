import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

function extractChunk(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not extract chunk between ${startMarker} and ${endMarker}`);
  }
  return source.slice(start, end);
}

const writes = [];
const context = {
  console,
  module: { exports: {} },
  exports: {},
  loadOperatorSettings: () => ({ preferences: { sources: { noiseSuppression: { duplicateBurst: { enabled: false, minSimilarClusters: 2 }, repetitiveLowValue: { enabled: false, maxStoryCount: 1, maxSourceCount: 1 }, sourceRules: [] } } } }),
  operatorSettingsDefaults: () => ({ preferences: { sources: { noiseSuppression: { duplicateBurst: { enabled: true, minSimilarClusters: 2 }, repetitiveLowValue: { enabled: true, maxStoryCount: 1, maxSourceCount: 1 }, sourceRules: [] } } } }),
  inventoryItems: [],
  buildOperatorSourceOps: snapshot => snapshot?.sourceOps || { inventory: { items: context.inventoryItems || [] } },
  noiseSuppressionHistory: { version: 'noise-suppression-history-v2', updatedAt: null, lastSweepAt: null, retentionMs: 14 * 24 * 60 * 60 * 1000, halfLifeMs: 5 * 24 * 60 * 60 * 1000, duplicateBursts: {}, repetitiveLowValueEvents: {}, sourceRuleHits: {}, telemetry: { lastPrunedAt: null, pruningActive: false, buckets: {}, summary: { totalEntries: 0, retainedEntries: 0, expiredEntriesRemoved: 0, overflowEntriesRemoved: 0 } } },
  NOISE_SUPPRESSION_HISTORY_PATH: '/tmp/noise-suppression-history.json',
  NOISE_SUPPRESSION_HISTORY_RETENTION_MS: 14 * 24 * 60 * 60 * 1000,
  NOISE_SUPPRESSION_HISTORY_HALF_LIFE_MS: 5 * 24 * 60 * 60 * 1000,
  NOISE_SUPPRESSION_HISTORY_MAX_DUPLICATE_BURSTS: 200,
  NOISE_SUPPRESSION_HISTORY_MAX_LOW_VALUE_EVENTS: 200,
  NOISE_SUPPRESSION_HISTORY_MAX_SOURCE_RULE_HITS: 200,
  saveJsonFile: (path, data) => writes.push({ path, data }),
  normalizeToken: value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''),
  clusterRepairActions: { suppressedClusterIds: ['old-cluster'], decisions: [{ id: 'd1', action: 'suppress-cluster', clusterId: 'old-cluster' }] },
};
vm.createContext(context);
vm.runInContext(`
  ${extractChunk('function summarizeClusterReviewMetrics(clusters = []) {', 'function buildReasoningSourceContext(snapshot = {}) {')}
  ${extractChunk('function noiseSuppressionHistoryDefaults() {', 'function buildReviewWorkflowContract(snapshot = currentData || null, review = null) {')}
  module.exports = { summarizeClusterReviewMetrics, summarizeWeakClusterReasons, buildClusterRepairWorkflow, buildNoiseSuppressionContract, recordNoiseSuppressionHistory };
`, context);

const { buildClusterRepairWorkflow, buildNoiseSuppressionContract, recordNoiseSuppressionHistory } = context.module.exports;

test('buildClusterRepairWorkflow explains weak clusters and exposes bounded actions', () => {
  const workflow = buildClusterRepairWorkflow({
    newsClusters: [
      {
        id: 'iran-a',
        headline: 'US-Iran conflict',
        region: 'Iran',
        storyCount: 1,
        sourceCount: 1,
        quality: 'low',
        confidenceLabel: 'weak',
        qualityFlags: ['single-source', 'heuristic-only'],
        placementClass: 'regional',
        placementBasis: 'heuristic centroid',
      },
      {
        id: 'iran-b',
        headline: 'US-Iran talks in doubt after Trump scraps Pakistan visit',
        region: 'Iran',
        storyCount: 1,
        sourceCount: 1,
        quality: 'low',
        confidenceLabel: 'weak',
        qualityFlags: ['single-source', 'heuristic-only'],
      },
      {
        id: 'india-wide',
        headline: 'India security roundup',
        region: 'India',
        storyCount: 5,
        sourceCount: 2,
        quality: 'low',
        confidenceLabel: 'weak',
        qualityFlags: ['heuristic-only'],
      },
    ],
  });

  assert.equal(workflow.version, 'cluster-repair-workflow-v1');
  assert.equal(workflow.supportedActions.includes('merge-clusters'), true);
  assert.equal(workflow.supportedActions.includes('split-cluster'), true);
  assert.equal(workflow.supportedActions.includes('correct-placement'), true);
  assert.equal(workflow.supportedActions.includes('suppress-cluster'), true);
  assert.equal(workflow.weakClusterCount, 3);

  const iran = workflow.weakClusters.find(item => item.clusterId === 'iran-a');
  assert.ok(iran);
  assert.equal(iran.actions.some(action => action.id === 'merge-clusters' && action.targetClusterId === 'iran-b'), true);
  assert.equal(iran.actions.some(action => action.id === 'correct-placement'), true);
  assert.match(iran.weaknessReasons.join(' '), /heuristic-only/i);
  assert.match(iran.weaknessReasons.join(' '), /single-source/i);

  const india = workflow.weakClusters.find(item => item.clusterId === 'india-wide');
  assert.ok(india);
  assert.equal(india.actions.some(action => action.id === 'split-cluster'), true);

  assert.equal(workflow.suppressedClusterCount, 1);
  assert.equal(workflow.recentDecisions.length, 1);
  assert.equal(workflow.suppression.version, 'noise-suppression-v1');
});

test('buildNoiseSuppressionContract derives duplicate, low-value, and source-rule candidates', () => {
  context.inventoryItems = [{ id: 'src-a', name: 'Source A' }];
  context.loadOperatorSettings = () => ({ preferences: { sources: { noiseSuppression: { duplicateBurst: { enabled: true, minSimilarClusters: 2 }, repetitiveLowValue: { enabled: true, maxStoryCount: 1, maxSourceCount: 1 }, sourceRules: [{ sourceId: 'src-a', action: 'suppress', reason: 'known burst source', enabled: true }] } } } });
  context.noiseSuppressionHistory = {
    version: 'noise-suppression-history-v2',
    updatedAt: '2026-04-26T12:00:00.000Z',
    lastSweepAt: '2026-04-26T12:00:00.000Z',
    retentionMs: context.NOISE_SUPPRESSION_HISTORY_RETENTION_MS,
    halfLifeMs: context.NOISE_SUPPRESSION_HISTORY_HALF_LIFE_MS,
    duplicateBursts: { 'duplicateburst::iran::clustera::clusterb::a': { hitCount: 3, firstSeenAt: '2026-04-26T10:00:00.000Z', lastSeenAt: '2026-04-26T12:00:00.000Z' } },
    repetitiveLowValueEvents: { 'repetitivelowvalue::srca::iran::a': { hitCount: 2, firstSeenAt: '2026-04-26T11:00:00.000Z', lastSeenAt: '2026-04-26T12:00:00.000Z' } },
    sourceRuleHits: { 'src-a': { sourceId: 'src-a', sourceName: 'Source A', duplicateBurstCount: 3, repetitiveLowValueCount: 2, totalHitCount: 5, firstSeenAt: '2026-04-26T10:00:00.000Z', lastSeenAt: '2026-04-26T12:00:00.000Z' } },
  };
  const suppression = buildNoiseSuppressionContract({
    newsClusters: [{ id: 'cluster-a', headline: 'A', region: 'Iran', storyCount: 1, sourceCount: 1, quality: 'low', confidenceLabel: 'weak', qualityFlags: ['single-source'], sourceProvenance: { topSources: [{ runtimeSource: 'Source A' }] } }],
    newsClusterQuality: { reviewMetrics: { suspiciousNearDuplicates: [{ region: 'Iran', similarity: 0.92, clusterA: { id: 'cluster-a', headline: 'A', region: 'Iran' }, clusterB: { id: 'cluster-b', headline: 'B', region: 'Iran' } }] } },
  });
  assert.equal(suppression.version, 'noise-suppression-v1');
  assert.equal(suppression.duplicateBursts.length, 1);
  assert.equal(suppression.duplicateBursts[0].historyHitCount, 3);
  assert.equal(suppression.repetitiveLowValueEvents.length, 1);
  assert.equal(suppression.repetitiveLowValueEvents[0].historyHitCount, 2);
  assert.equal(suppression.sourceRules.activeRules[0].sourceId, 'src-a');
  assert.equal(suppression.sourceRules.activeRules[0].hitCount, 5);
  assert.equal(suppression.history.decayTelemetry.bucketCounts.duplicateBursts, 1);
  assert.equal(suppression.history.decayTelemetry.bucketCounts.repetitiveLowValueEvents, 1);
  assert.equal(suppression.history.decayTelemetry.bucketCounts.sourceRuleHits, 1);
  assert.equal(typeof suppression.history.pruneTelemetry.summary.retainedEntries, 'number');
});

test('recordNoiseSuppressionHistory persists rolling counters for repeated sweeps', () => {
  writes.length = 0;
  context.inventoryItems = [{ id: 'src-a', name: 'Source A' }];
  context.loadOperatorSettings = () => ({ preferences: { sources: { noiseSuppression: { duplicateBurst: { enabled: true, minSimilarClusters: 2 }, repetitiveLowValue: { enabled: true, maxStoryCount: 1, maxSourceCount: 1 }, sourceRules: [] } } } });
  context.noiseSuppressionHistory = { version: 'noise-suppression-history-v2', updatedAt: null, lastSweepAt: null, retentionMs: context.NOISE_SUPPRESSION_HISTORY_RETENTION_MS, halfLifeMs: context.NOISE_SUPPRESSION_HISTORY_HALF_LIFE_MS, duplicateBursts: {}, repetitiveLowValueEvents: {}, sourceRuleHits: {}, telemetry: { lastPrunedAt: null, pruningActive: false, buckets: {}, summary: { totalEntries: 0, retainedEntries: 0, expiredEntriesRemoved: 0, overflowEntriesRemoved: 0 } } };
  const snapshot = {
    meta: { timestamp: '2026-04-26T12:30:00.000Z' },
    newsClusters: [{ id: 'cluster-a', headline: 'A', region: 'Iran', storyCount: 1, sourceCount: 1, quality: 'low', confidenceLabel: 'weak', qualityFlags: ['single-source'], sourceProvenance: { topSources: [{ runtimeSource: 'Source A' }] } }],
    newsClusterQuality: { reviewMetrics: { suspiciousNearDuplicates: [{ region: 'Iran', similarity: 0.92, clusterA: { id: 'cluster-a', headline: 'A', region: 'Iran' }, clusterB: { id: 'cluster-b', headline: 'B', region: 'Iran' } }] } },
  };
  recordNoiseSuppressionHistory(snapshot);
  recordNoiseSuppressionHistory(snapshot);
  const persisted = context.noiseSuppressionHistory;
  assert.equal(Object.keys(persisted.duplicateBursts).length, 1);
  assert.equal(Object.values(persisted.duplicateBursts)[0].hitCount, 2);
  assert.equal(Object.values(persisted.repetitiveLowValueEvents)[0].hitCount, 2);
  assert.equal(persisted.sourceRuleHits['src-a'].duplicateBurstCount, 2);
  assert.equal(persisted.sourceRuleHits['src-a'].repetitiveLowValueCount, 2);
  assert.equal(persisted.sourceRuleHits['src-a'].totalHitCount, 4);
  assert.equal(writes.length, 2);
});

test('noise suppression history decays stale suggestion weight and prunes expired entries', () => {
  context.inventoryItems = [{ id: 'src-a', name: 'Source A' }];
  context.loadOperatorSettings = () => ({ preferences: { sources: { noiseSuppression: { duplicateBurst: { enabled: true, minSimilarClusters: 2 }, repetitiveLowValue: { enabled: true, maxStoryCount: 1, maxSourceCount: 1 }, sourceRules: [] } } } });
  context.noiseSuppressionHistory = {
    version: 'noise-suppression-history-v2',
    updatedAt: '2026-04-26T12:00:00.000Z',
    lastSweepAt: '2026-04-26T12:00:00.000Z',
    retentionMs: context.NOISE_SUPPRESSION_HISTORY_RETENTION_MS,
    halfLifeMs: context.NOISE_SUPPRESSION_HISTORY_HALF_LIFE_MS,
    duplicateBursts: {
      stale: { hitCount: 9, firstSeenAt: '2026-03-01T00:00:00.000Z', lastSeenAt: '2026-03-01T00:00:00.000Z' },
    },
    repetitiveLowValueEvents: {
      'repetitivelowvalue::srca::iran::a': { hitCount: 8, firstSeenAt: '2026-04-01T00:00:00.000Z', lastSeenAt: '2026-04-01T00:00:00.000Z' },
    },
    sourceRuleHits: {
      'src-a': { sourceId: 'src-a', sourceName: 'Source A', duplicateBurstCount: 0, repetitiveLowValueCount: 8, totalHitCount: 8, firstSeenAt: '2026-04-01T00:00:00.000Z', lastSeenAt: '2026-04-01T00:00:00.000Z' },
    },
  };
  const suppression = buildNoiseSuppressionContract({
    meta: { timestamp: '2026-04-26T12:00:00.000Z' },
    newsClusters: [{ id: 'cluster-a', headline: 'A', region: 'Iran', storyCount: 1, sourceCount: 1, quality: 'low', confidenceLabel: 'weak', qualityFlags: ['single-source'], sourceProvenance: { topSources: [{ runtimeSource: 'Source A' }] } }],
    newsClusterQuality: { reviewMetrics: { suspiciousNearDuplicates: [] } },
  });
  assert.equal(suppression.repetitiveLowValueEvents[0].historyHitCount, 8);
  assert.ok(suppression.repetitiveLowValueEvents[0].decayedHistoryHitCount < 1);
  assert.equal(suppression.sourceRules.suggestedRules.length, 0);

  const snapshot = {
    meta: { timestamp: '2026-04-26T12:00:00.000Z' },
    newsClusters: [],
    newsClusterQuality: { reviewMetrics: { suspiciousNearDuplicates: [] } },
  };
  recordNoiseSuppressionHistory(snapshot);
  assert.equal(Object.keys(context.noiseSuppressionHistory.duplicateBursts).length, 0);
  assert.equal(context.noiseSuppressionHistory.telemetry.pruningActive, true);
  assert.equal(context.noiseSuppressionHistory.telemetry.summary.expiredEntriesRemoved > 0, true);
  assert.equal(suppression.history.decayTelemetry.agedOutSuggestionCount > 0, true);
});
