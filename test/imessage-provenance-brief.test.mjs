import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('/Users/rightclaw/services/crucix/server.mjs', 'utf8');

function between(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle);
  if (start === -1 || end === -1 || end <= start) throw new Error(`could not extract ${startNeedle}..${endNeedle}`);
  return source.slice(start, end);
}

const code = [
  between('function signalId', 'function touchSelection'),
  between('function buildReasoningSourceContext', 'const ANALYSIS_STALE_CURRENT_MS'),
  between('function buildIMessengerBrief', 'function buildBriefSections'),
  'module.exports = { buildIMessengerBrief };',
].join('\n');

const context = {
  module: { exports: {} },
  exports: {},
  console,
  memory: { getTrendSummary: () => ({}), getLastDelta: () => null },
  buildAgentAnalysis: () => ({ iMessageSummary: [] }),
  summarizeClusterReviewMetrics: () => null,
  attachClusterPressureStats: (v) => v,
  attachClusterReviewStats: (v) => v,
  annotateReview: (v) => v,
  buildSourceOpsSurface: () => null,
  ROOT: '/tmp',
};
vm.createContext(context);
vm.runInContext(code, context);
const { buildIMessengerBrief } = context.module.exports;

test('iMessage brief includes operator-facing evidence provenance labels', () => {
  const text = buildIMessengerBrief({
    evidenceSummary: {
      headline: 'air:fresh | markets:fresh | telegram:aging/live | news:fresh/aggregated',
      counts: { fresh: 2, aging: 1, stale: 0, carriedForward: 1, cached: 1, degraded: 1, failedSources: 2 },
    },
    corroboratedSignals: [
      { signal: 'Confirmed maritime disruption', confidence: 'high', sourceHealth: 'hard-data', evidenceSource: 'mixed' },
    ],
    suspectSignals: [
      { signal: 'Telegram chatter spike', confidence: 'medium', sourceHealth: 'osint-only', evidenceSource: 'telegram' },
    ],
    tg: { urgent: [{ text: 'x' }] },
    agentAnalysis: { iMessageSummary: ['Status: ready'] },
  });

  assert.match(text, /Provenance: 1 carried-forward, 1 cached\/fallback, 1 degraded, 2 failed sources/);
  assert.match(text, /Top corroborated \[corroborated-confirmed-maritime-disruption-0\]: Confirmed maritime disruption \(high, hard-data corroboration\)/);
  assert.match(text, /Top suspect \[suspect-telegram-chatter-spike-0\]: Telegram chatter spike \(medium, osint-only signal\)/);
});

test('iMessage brief uses coherent News LLM wording for partial fallback runs', () => {
  const text = buildIMessengerBrief({
    agentAnalysis: { iMessageSummary: ['Status: ready'] },
    tg: { urgent: [] },
    newsSummary: undefined,
    evidenceSummary: { counts: {} },
    corroboratedSignals: [],
    suspectSignals: [],
    newsClusters: [{ headline: 'Example headline', region: 'EU', items: [{}, {}], llmConfidence: 'medium' }],
    newsLlmDebug: {
      requestedMode: 'auto',
      providerConfigured: true,
      attempted: true,
      used: true,
      heuristicFallbackCount: 2,
      candidateSetCount: 4,
      retryCount: 1,
      repairSuccessCount: 1,
      review: { failedRegionCount: 1, topReasons: [{ reason: 'no-json-match', count: 1 }] },
    },
  });

  assert.match(text, /News LLM: LLM partial fallback, mode auto, candidates 4, fallbacks 2, retries 1, repairs 1/);
  assert.doesNotMatch(text, /heuristic fallback/);
});
