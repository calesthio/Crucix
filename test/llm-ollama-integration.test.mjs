// Ollama provider — integration test (calls real Ollama instance)
// Requires a running Ollama server with a model pulled
// Run: OLLAMA_MODEL=llama3.1:8b node --test test/llm-ollama-integration.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaProvider } from '../lib/llm/ollama.mjs';

const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

// Check if Ollama is reachable before running tests
let ollamaAvailable = false;
try {
  const res = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
  ollamaAvailable = res.ok;
} catch { /* not available */ }

describe('Ollama integration', { skip: !ollamaAvailable && 'Ollama not reachable' }, () => {
  it('should complete a prompt via local Ollama', async () => {
    const provider = new OllamaProvider({ model: MODEL, baseUrl: BASE_URL });
    assert.equal(provider.isConfigured, true);

    const result = await provider.complete(
      'You are a helpful assistant. Respond in exactly one sentence.',
      'What is 2+2?',
      { maxTokens: 128, timeout: 60000 }
    );

    assert.ok(result.text.length > 0, 'Response text should not be empty');
    assert.ok(result.model, 'Should report model name');
    console.log(`  Response: ${result.text}`);
    console.log(`  Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
    console.log(`  Model: ${result.model}`);
  });
});
