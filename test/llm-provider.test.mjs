// Base LLMProvider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { LLMProvider } from '../lib/llm/provider.mjs';

// ─── Unit Tests ───

describe('LLMProvider', () => {
  it('should store config and set name to base', () => {
    const config = { apiKey: 'test-key', model: 'some-model' };
    const provider = new LLMProvider(config);
    assert.deepEqual(provider.config, config);
    assert.equal(provider.name, 'base');
  });

  it('should return false for isConfigured', () => {
    const provider = new LLMProvider({ apiKey: 'anything' });
    assert.equal(provider.isConfigured, false);
  });

  it('should throw an error matching /not implemented/ from complete()', async () => {
    const provider = new LLMProvider({});
    await assert.rejects(
      () => provider.complete('system', 'user'),
      (err) => {
        assert.match(err.message, /not implemented/);
        return true;
      }
    );
  });

  it('should include provider name in the error message from complete()', async () => {
    const provider = new LLMProvider({});
    // name is 'base'
    await assert.rejects(
      () => provider.complete('system', 'user'),
      (err) => {
        assert.match(err.message, /base/);
        return true;
      }
    );
  });
});
