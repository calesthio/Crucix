// Mistral provider — integration test (calls real API)
// Requires MISTRAL_API_KEY environment variable
// Run: MISTRAL_API_KEY=sk-... node --test test/llm-minimax-integration.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MistralProvider } from '../lib/llm/mistral.mjs';

const API_KEY = process.env.MISTRAL_API_KEY;

describe('Mistral integration', { skip: !API_KEY && 'MISTRAL_API_KEY not set' }, () => {
  it('should complete a prompt with mistral large latest', async () => {
    const provider = new MistralProvider({ apiKey: API_KEY, model: 'mistral-large-latest' });
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
