import test from 'node:test';
import assert from 'node:assert/strict';
import { createLLMProvider } from '../lib/llm/index.mjs';

test('OpenRouterProvider Integration Test', { skip: !process.env.LLM_API_KEY || process.env.LLM_PROVIDER !== 'openrouter' }, async (t) => {
  await t.test('Performs live API call', async () => {
    const provider = createLLMProvider({
      provider: 'openrouter',
      apiKey: process.env.LLM_API_KEY,
      model: process.env.LLM_MODEL || 'openrouter/auto'
    });

    const result = await provider.complete('Reply with exactly "Hello".', 'Hi');
    assert.ok(result.text.length > 0, 'Should return text');
    assert.ok(result.usage.inputTokens > 0, 'Should return input token usage');
  });
});
