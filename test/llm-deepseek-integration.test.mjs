// DeepSeek Provider Integration Test
// Run: DEEPSEEK_API_KEY=sk-... node --test test/llm-deepseek-integration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekProvider } from '../lib/llm/deepseek.mjs';

const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY;

test('DeepSeekProvider Integration Test', { skip: !API_KEY }, async (t) => {
  const provider = new DeepSeekProvider({
    apiKey: API_KEY,
    model: process.env.LLM_MODEL || 'deepseek-chat',
  });

  await t.test('should complete a prompt with deepseek-chat', async () => {
    const result = await provider.complete(
      'You are a helpful assistant. Reply with a single word.',
      'What is the capital of France?'
    );
    assert.ok(result.text.length > 0, 'Expected non-empty response');
    assert.ok(result.usage.inputTokens > 0, 'Expected input tokens');
    assert.ok(result.usage.outputTokens > 0, 'Expected output tokens');
    console.log('DeepSeek response:', result.text.substring(0, 100));
  });
});
