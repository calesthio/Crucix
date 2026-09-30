import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceHealth, summarizeSourceHealth } from '../lib/source-health.mjs';

test('health distinguishes missing credentials, failures, partial and stale data', () => {
  assert.equal(sourceHealth({ status: 'no_key' }).status, 'unconfigured');
  assert.equal(sourceHealth({ error: 'No FRED API key. Get one free' }).status, 'unconfigured');
  assert.equal(sourceHealth({ status: 'no_credentials', error: 'No token' }).status, 'unconfigured');
  assert.equal(sourceHealth({ error: 'HTTP 503' }).status, 'failed');
  assert.equal(sourceHealth({ status: 'limited' }).status, 'degraded');
  assert.equal(sourceHealth({ stale: true, error: 'Upstream unavailable' }).status, 'degraded');
  assert.equal(sourceHealth({ attacks: { vectorError: 'HTTP 403' } }).status, 'degraded');
  assert.equal(sourceHealth({ status: 'error' }).status, 'failed');
  assert.equal(sourceHealth({ errors: ['One channel unavailable'] }).status, 'degraded');
  assert.equal(sourceHealth({ outbreakError: null, entries: [] }).status, 'healthy');
});

test('health includes timed-out sources and counts each state separately', () => {
  const result = summarizeSourceHealth({
    sources: { Good: {}, Key: { status: 'no_key' }, Partial: { rwError: 'HTTP 406' } },
    errors: [{ name: 'Timeout', error: 'Timed out' }],
    timing: { Good: {}, Key: {}, Partial: {}, Timeout: {} },
  });
  assert.deepEqual(result.counts, { sourcesQueried: 4, sourcesOk: 1, sourcesDegraded: 1, sourcesUnconfigured: 1, sourcesFailed: 1 });
  assert.equal(result.health.find(source => source.n === 'Timeout').status, 'failed');
  assert.equal(result.health.find(source => source.n === 'Partial').detail, 'HTTP 406');
});
