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
  extractChunk('function summarizeClusterReviewMetrics(clusters = []) {', 'function buildNewsClusterSummary(snapshot = {}) {'),
  extractChunk('function buildNewsClusterSummary(snapshot = {}) {', 'function compactAgentAnalysisContext(snapshot = {}, fallback = null) {'),
  'module.exports = { summarizeClusterReviewMetrics, buildNewsClusterSummary };',
].join('\n');

const context = { module: { exports: {} }, exports: {}, console };
vm.createContext(context);
vm.runInContext(code, context);
const { summarizeClusterReviewMetrics, buildNewsClusterSummary } = context.module.exports;

test('summarizeClusterReviewMetrics counts low-confidence, merge, and split candidates', () => {
  const clusters = [
    { region: 'Iran', storyCount: 4, sourceCount: 2, quality: 'medium', confidenceLabel: 'moderate', llmConfidence: 'heuristic', qualityFlags: ['heuristic-only'] },
    { region: 'Iran', storyCount: 1, sourceCount: 1, quality: 'low', confidenceLabel: 'weak', llmConfidence: 'heuristic', qualityFlags: ['single-source', 'heuristic-only'] },
    { region: 'Iran', storyCount: 1, sourceCount: 1, quality: 'low', confidenceLabel: 'weak', llmConfidence: 'heuristic', qualityFlags: ['single-source', 'heuristic-only'] },
    { region: 'Ukraine', storyCount: 2, sourceCount: 2, quality: 'high', confidenceLabel: 'strong', llmConfidence: 'high', qualityFlags: ['llm-backed'] },
  ];
  const metrics = summarizeClusterReviewMetrics(clusters);
  assert.equal(metrics.lowConfidenceCount, 3);
  assert.equal(metrics.mergeCandidateCount, 1);
  assert.equal(metrics.splitCandidateCount, 2);
  assert.equal(JSON.stringify(metrics.topSplitRegions), JSON.stringify([{ region: 'Iran', count: 2 }]));
});

test('buildNewsClusterSummary exposes review metrics on quality summary', () => {
  const snapshot = {
    newsClusters: [
      { id: 'a', headline: 'A', region: 'Iran', storyCount: 3, sourceCount: 2, latestDate: '2026-04-24T00:00:00Z', llmConfidence: 'heuristic', quality: 'medium', confidenceLabel: 'moderate', qualityFlags: ['heuristic-only'] },
      { id: 'b', headline: 'B', region: 'Iran', storyCount: 1, sourceCount: 1, latestDate: '2026-04-24T00:00:00Z', llmConfidence: 'heuristic', quality: 'low', confidenceLabel: 'weak', qualityFlags: ['single-source', 'heuristic-only'] },
    ]
  };
  const summary = buildNewsClusterSummary(snapshot);
  assert.equal(summary.quality.reviewMetrics.lowConfidenceCount, 2);
  assert.equal(summary.quality.reviewMetrics.mergeCandidateCount, 1);
  assert.equal(summary.quality.reviewMetrics.splitCandidateCount, 1);
});
