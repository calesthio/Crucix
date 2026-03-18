// MiniMax provider — integration test (calls real API)
// Requires MINIMAX_API_KEY environment variable
// Run: MINIMAX_API_KEY=sk-... node --test test/llm-minimax-integration.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MiniMaxProvider } from '../lib/llm/minimax.mjs';

const API_KEY = process.env.MINIMAX_API_KEY;

describe('MiniMax integration', { skip: !API_KEY && 'MINIMAX_API_KEY not set' }, () => {
  it('should complete a prompt with MiniMax-M2.7', async () => {
    const provider = new MiniMaxProvider({ apiKey: API_KEY, model: 'MiniMax-M2.7' });
    assert.equal(provider.isConfigured, true);

    const result = await provider.complete(
      'You are a helpful assistant. Respond in exactly one sentence.',
      'What is 2+2?',
      { maxTokens: 128, timeout: 30000 }
    );

    assert.ok(result.text.length > 0, 'Response text should not be empty');
    assert.ok(result.usage.inputTokens > 0, 'Should report input tokens');
    assert.ok(result.usage.outputTokens > 0, 'Should report output tokens');
    assert.ok(result.model, 'Should report model name');
    console.log(`  Response: ${result.text}`);
    console.log(`  Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
    console.log(`  Model: ${result.model}`);
  });
});
