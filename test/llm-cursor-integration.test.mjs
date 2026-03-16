// Integration test for Cursor LLM provider (requires Cursor CLI + proxy)

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLLMProvider } from '../lib/llm/index.mjs';

const skip = process.env.LLM_PROVIDER !== 'cursor';

test('CursorProvider integration test', { skip }, async (t) => {
  await t.test('performs live API call', async () => {
    const provider = createLLMProvider({
      provider: 'cursor',
      apiKey: process.env.LLM_API_KEY || null,
      model: process.env.LLM_MODEL || 'auto',
    });

    const result = await provider.complete(
      'Reply with exactly "Hello".',
      'Hi'
    );
    assert.ok(result.text.length > 0, 'Should return text');
    assert.ok(
      result.usage.inputTokens >= 0 && result.usage.outputTokens >= 0,
      'Should return usage'
    );
  });
});
