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

const context = {
  console,
  module: { exports: {} },
  exports: {},
  clusterRepairActions: { suppressedClusterIds: ['old-cluster'], decisions: [{ id: 'd1', action: 'suppress-cluster', clusterId: 'old-cluster' }] },
};
vm.createContext(context);
vm.runInContext(`
  ${extractChunk('function summarizeClusterReviewMetrics(clusters = []) {', 'function buildReasoningSourceContext(snapshot = {}) {')}
  ${extractChunk('function summarizeWeakClusterReasons(cluster = {}, duplicatePairs = []) {', 'function buildReviewWorkflowContract(snapshot = currentData || null, review = null) {')}
  module.exports = { summarizeClusterReviewMetrics, summarizeWeakClusterReasons, buildClusterRepairWorkflow };
`, context);

const { buildClusterRepairWorkflow } = context.module.exports;

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
});
