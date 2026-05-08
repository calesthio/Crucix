import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const serverSource = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const html = readFileSync('/Users/rightclaw/services/crucix/dashboard/public/jarvis.html', 'utf8');

function extractChunk(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not extract chunk between ${startMarker} and ${endMarker}`);
  }
  return source.slice(start, end);
}

function extractFunction(name) {
  const marker = `function ${name}(){`;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`Could not find ${name}`);
  let depth = 0;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`Could not extract ${name}`);
  return html.slice(start, end);
}

const statusContext = {
  console,
  config: { llm: { provider: 'ollama' } },
  llmProvider: { model: 'test-model', isConfigured: true },
  AGENT_ANALYSIS_REFINEMENT_TIMEOUT_MS: 60000,
  module: { exports: {} },
  exports: {},
};
vm.createContext(statusContext);
vm.runInContext(`
  ${extractChunk(serverSource, 'function buildAgentAnalysisMeta(overrides = {}) {', 'async function runAgentAnalysisValidationSummary() {')}
  module.exports = { buildAgentAnalysisMeta, buildRuntimeLlmStatus };
`, statusContext);
const { buildAgentAnalysisMeta, buildRuntimeLlmStatus } = statusContext.module.exports;

const renderCode = `${extractFunction('renderRight')}\nthis.renderRight = renderRight;`;

function makeSnapshot(runtimeLlm, analysisMeta = {}, iMessageSummary = ['Status: ready']) {
  return {
    tSignals: [],
    tg: { urgent: [], topPosts: [] },
    air: [],
    thermal: [],
    sdr: { total: 0 },
    chokepoints: [],
    who: [],
    delta: { summary: { totalChanges: 0 } },
    corroboratedSignals: [],
    suspectSignals: [],
    agentAnalysis: { iMessageSummary, confidenceLabel: 'low', status: 'ready' },
    agentAnalysisMeta: analysisMeta,
    runtimeLlm,
  };
}

function renderReview(snapshot) {
  const rightRail = { innerHTML: '' };
  const context = {
    console,
    D: snapshot,
    document: { getElementById: (id) => (id === 'rightRail' ? rightRail : { innerHTML: '' }) },
    isMobileLayout: () => false,
    buildOsintPanel: () => '',
    buildEvidencePanel: () => '',
    cleanText: (v = '') => String(v),
    analysisLlmBadge: () => 'UNUSED',
    analysisLlmMetaLine: () => 'UNUSED',
    t: (_k, fallback) => fallback,
    safeExternalUrl: () => null,
    getAge: () => 'now',
  };
  vm.createContext(context);
  vm.runInContext(renderCode, context);
  context.renderRight();
  return rightRail.innerHTML;
}

test('end-to-end operator surface shows applied state coherently', () => {
  const analysisMeta = buildAgentAnalysisMeta({ source: 'llm', refinementState: 'completed', refinementCompletion: 'llm-applied' });
  const runtimeLlm = buildRuntimeLlmStatus({ agentAnalysisMeta: analysisMeta, ideasSource: 'llm' }, { provider: 'ollama', model: 'qwen' });
  const out = renderReview(makeSnapshot(runtimeLlm, analysisMeta));

  assert.equal(runtimeLlm.status, 'applied');
  assert.match(out, /Analysis Review[\s\S]*LLM APPLIED/);
  assert.match(out, /Analysis refinement applied via qwen\./);
  assert.match(out, /Runtime LLM: LLM APPLIED/);
});

test('end-to-end operator surface shows disabled state coherently', () => {
  const analysisMeta = buildAgentAnalysisMeta({ error: 'llm-unavailable', refinementState: 'unavailable', model: null });
  const runtimeLlm = buildRuntimeLlmStatus({ agentAnalysisMeta: analysisMeta, ideasSource: 'disabled' }, { provider: '', model: null });
  const out = renderReview(makeSnapshot(runtimeLlm, analysisMeta));

  assert.equal(runtimeLlm.status, 'unavailable');
  assert.match(out, /Analysis Review[\s\S]*LLM UNAVAILABLE/);
  assert.match(out, /Analysis refinement unavailable, deterministic analysis only\./);
  assert.match(out, /Runtime LLM: LLM UNAVAILABLE/);
});

test('end-to-end operator surface shows parse-failed fallback coherently', () => {
  const analysisMeta = buildAgentAnalysisMeta({
    source: 'deterministic',
    error: 'parse-failed',
    refinementState: 'failed',
    refinementAttemptId: 'analysis-refine-0001',
    refinementCompletion: 'fallback-parse-failed',
  });
  const runtimeLlm = buildRuntimeLlmStatus({ agentAnalysisMeta: analysisMeta, ideasSource: 'llm-failed' }, { provider: 'ollama', model: 'qwen' });
  const out = renderReview(makeSnapshot(runtimeLlm, analysisMeta));

  assert.equal(runtimeLlm.status, 'fallback');
  assert.match(out, /Analysis Review[\s\S]*LLM FALLBACK/);
  assert.match(out, /Analysis refinement attempted, deterministic fallback kept \(parse-failed\)\./);
  assert.match(out, /Runtime LLM: LLM FALLBACK/);
});

test('end-to-end operator surface keeps failure details visible for timeout fallback', () => {
  const analysisMeta = buildAgentAnalysisMeta({
    source: 'deterministic',
    error: 'request timed out',
    refinementState: 'timed-out',
    refinementAttemptId: 'analysis-refine-0002',
    refinementCompletion: 'fallback-timeout',
    refinementTimedOut: true,
  });
  const runtimeLlm = buildRuntimeLlmStatus({ agentAnalysisMeta: analysisMeta, ideasSource: 'llm-failed' }, { provider: 'ollama', model: 'qwen' });
  const out = renderReview(makeSnapshot(runtimeLlm, analysisMeta));

  assert.equal(runtimeLlm.status, 'fallback');
  assert.match(out, /Analysis Review[\s\S]*LLM FALLBACK/);
  assert.match(out, /Analysis refinement attempted, deterministic fallback kept \(request timed out\)\./);
  assert.match(out, /Runtime LLM: LLM FALLBACK/);
});
