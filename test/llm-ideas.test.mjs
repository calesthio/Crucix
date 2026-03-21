// LLM Ideas generation — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { generateLLMIdeas } from '../lib/llm/ideas.mjs';

// ─── Helpers ───

const minimalSweepData = { fred: {}, energy: {}, bls: {} };

function makeMockProvider(responseText) {
  return {
    isConfigured: true,
    complete: async () => ({ text: responseText }),
  };
}

const sampleIdeasJson = JSON.stringify([
  { title: 'Buy SPY', type: 'LONG', ticker: 'SPY', confidence: 'HIGH', rationale: 'Momentum strong', risk: 'Rate spike', horizon: 'Weeks', signals: ['VIX low'] },
  { title: 'Short TLT', type: 'SHORT', ticker: 'TLT', confidence: 'MEDIUM', rationale: 'Rising rates', risk: 'Fed pivot', horizon: 'Months', signals: ['DGS10 up'] },
]);

// ─── Unit Tests ───

describe('generateLLMIdeas', () => {
  it('returns null when provider is null', async () => {
    const result = await generateLLMIdeas(null, minimalSweepData, null);
    assert.equal(result, null);
  });

  it('returns null when provider.isConfigured is false', async () => {
    const provider = { isConfigured: false, complete: async () => ({ text: '[]' }) };
    const result = await generateLLMIdeas(provider, minimalSweepData, null);
    assert.equal(result, null);
  });

  it('calls provider.complete() and returns parsed ideas array', async () => {
    const provider = makeMockProvider(sampleIdeasJson);
    const result = await generateLLMIdeas(provider, minimalSweepData, null);
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
    assert.equal(result[0].title, 'Buy SPY');
    assert.equal(result[0].type, 'LONG');
  });

  it('adds source="llm" to each idea', async () => {
    const provider = makeMockProvider(sampleIdeasJson);
    const result = await generateLLMIdeas(provider, minimalSweepData, null);
    assert.ok(Array.isArray(result));
    for (const idea of result) {
      assert.equal(idea.source, 'llm');
    }
  });

  it('handles markdown-wrapped JSON response (```json [...] ```)', async () => {
    const wrapped = '```json\n' + sampleIdeasJson + '\n```';
    const provider = makeMockProvider(wrapped);
    const result = await generateLLMIdeas(provider, minimalSweepData, null);
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
    assert.equal(result[0].title, 'Buy SPY');
  });

  it('handles plain ``` code block wrapping', async () => {
    const wrapped = '```\n' + sampleIdeasJson + '\n```';
    const provider = makeMockProvider(wrapped);
    const result = await generateLLMIdeas(provider, minimalSweepData, null);
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
  });

  it('returns null on completely unparseable response', async () => {
    const provider = makeMockProvider('This is not JSON at all, just gibberish text.');
    const result = await generateLLMIdeas(provider, minimalSweepData, null);
    assert.equal(result, null);
  });

  it('returns null when provider.complete() throws', async () => {
    const provider = {
      isConfigured: true,
      complete: async () => { throw new Error('Network error'); },
    };
    const result = await generateLLMIdeas(provider, minimalSweepData, null);
    assert.equal(result, null);
  });

  it('returns null when parsed result is empty array', async () => {
    const provider = makeMockProvider('[]');
    const result = await generateLLMIdeas(provider, minimalSweepData, null);
    assert.equal(result, null);
  });

  it('filters out ideas missing required fields (title, type, confidence)', async () => {
    const partial = JSON.stringify([
      { title: 'Good Idea', type: 'LONG', ticker: 'SPY', confidence: 'HIGH', rationale: 'ok', risk: 'ok', horizon: 'Days', signals: [] },
      { type: 'SHORT', ticker: 'TLT' }, // missing title and confidence — filtered out
    ]);
    const provider = makeMockProvider(partial);
    const result = await generateLLMIdeas(provider, minimalSweepData, null);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Good Idea');
  });
});
