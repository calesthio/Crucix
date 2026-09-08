import test from 'node:test';
import assert from 'node:assert/strict';
import { createLLMProvider } from '../lib/llm/index.mjs';

test('RequestyProvider Integration Test', { skip: !process.env.LLM_API_KEY || process.env.LLM_PROVIDER !== 'requesty' }, async (t) => {
  await t.test('Performs live API call', async () => {
    const provider = createLLMProvider({
      provider: 'requesty',
      apiKey: process.env.LLM_API_KEY,
      model: process.env.LLM_MODEL || 'openai/gpt-4o-mini'
    });

    const result = await provider.complete('Reply with exactly "Hello".', 'Hi');
    assert.ok(result.text.length > 0, 'Should return text');
    assert.ok(result.usage.inputTokens > 0, 'Should return input token usage');
  });
});
