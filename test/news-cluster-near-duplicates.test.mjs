import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('/Users/rightclaw/services/crucix/server.mjs', 'utf8');

function extract(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  if (start === -1 || end === -1 || end <= start) throw new Error(`could not extract ${startNeedle}..${endNeedle}`);
  return source.slice(start, end);
}

const code = [
  extract('function summarizeClusterReviewMetrics(clusters = []) {', 'function buildNewsClusterSummary(snapshot = {}) {'),
  'module.exports = { summarizeClusterReviewMetrics };',
].join('\n');

const context = {
  module: { exports: {} },
  exports: {},
  console,
};
vm.createContext(context);
vm.runInContext(code, context);
const { summarizeClusterReviewMetrics } = context.module.exports;

test('summarizeClusterReviewMetrics exposes suspicious near-duplicate single-source pairs', () => {
  const metrics = summarizeClusterReviewMetrics([
    { id: 'a', region: 'Iran', headline: 'Iran war live updates on Strait of Hormuz', summary: 'Iran war live updates on Strait of Hormuz', storyCount: 1, sourceCount: 1, quality: 'low', confidenceLabel: 'weak', llmConfidence: 'heuristic', qualityFlags: ['single-source', 'heuristic-only'] },
    { id: 'b', region: 'Iran', headline: 'Iran live updates on Strait of Hormuz crisis', summary: 'Iran live updates on Strait of Hormuz crisis', storyCount: 1, sourceCount: 1, quality: 'low', confidenceLabel: 'weak', llmConfidence: 'heuristic', qualityFlags: ['single-source', 'heuristic-only'] },
    { id: 'c', region: 'India', headline: 'Election turnout reaches record levels', summary: 'Election turnout reaches record levels', storyCount: 1, sourceCount: 1, quality: 'low', confidenceLabel: 'weak', llmConfidence: 'heuristic', qualityFlags: ['single-source', 'heuristic-only'] },
  ]);
  assert.equal(metrics.suspiciousNearDuplicateCount, 1);
  assert.equal(metrics.suspiciousNearDuplicates[0].region, 'Iran');
  assert.equal(metrics.suspiciousNearDuplicates[0].clusterA.id, 'a');
  assert.equal(metrics.suspiciousNearDuplicates[0].clusterB.id, 'b');
});
