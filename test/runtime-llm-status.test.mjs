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
  config: { llm: { provider: 'ollama' } },
  llmProvider: { model: 'test-model', isConfigured: true },
  AGENT_ANALYSIS_REFINEMENT_TIMEOUT_MS: 60000,
  module: { exports: {} },
  exports: {},
};
vm.createContext(context);
vm.runInContext(`
  ${extractChunk('function buildAgentAnalysisMeta(overrides = {}) {', 'async function runAgentAnalysisValidationSummary() {')}
  module.exports = { buildAgentAnalysisMeta, buildRuntimeLlmStatus };
`, context);

const { buildAgentAnalysisMeta, buildRuntimeLlmStatus } = context.module.exports;

test('runtime LLM status reports fallback when configured analysis falls back after a parse failure', () => {
  const status = buildRuntimeLlmStatus({
    agentAnalysisMeta: buildAgentAnalysisMeta({
      source: 'deterministic',
      error: 'parse-failed',
      refinementState: 'failed',
      refinementAttemptId: 'analysis-refine-0001',
      refinementCompletion: 'fallback-parse-failed',
    }),
    ideasSource: 'llm-failed',
  }, { provider: 'ollama', model: 'qwen' });

  assert.equal(status.status, 'fallback');
  assert.equal(status.label, 'LLM FALLBACK');
  assert.equal(status.analysis.reason, 'fallback');
  assert.equal(status.ideas.reason, 'fallback');
  assert.match(status.summary, /published output remains on deterministic or static fallback/i);
  assert.match(status.analysis.explanation, /attempted, deterministic fallback kept/i);
});

test('runtime LLM status reports unavailable when no provider is configured', () => {
  const status = buildRuntimeLlmStatus({
    agentAnalysisMeta: buildAgentAnalysisMeta({ error: 'llm-unavailable', refinementState: 'unavailable' }),
    ideasSource: 'disabled',
  }, { provider: '', model: null });

  assert.equal(status.status, 'unavailable');
  assert.equal(status.label, 'LLM UNAVAILABLE');
  assert.equal(status.analysis.reason, 'unavailable');
  assert.equal(status.ideas.reason, 'unavailable');
  assert.equal(status.configured, false);
});

test('runtime LLM status reports applied when either analysis or ideas used the LLM', () => {
  const status = buildRuntimeLlmStatus({
    agentAnalysisMeta: buildAgentAnalysisMeta({ source: 'llm', refinementState: 'completed', refinementCompletion: 'llm-applied' }),
    ideasSource: 'llm',
  }, { provider: 'ollama', model: 'qwen' });

  assert.equal(status.status, 'applied');
  assert.equal(status.label, 'LLM APPLIED');
  assert.equal(status.analysis.participated, true);
  assert.equal(status.ideas.participated, true);
  assert.match(status.summary, /participated in the current published output/i);
});
