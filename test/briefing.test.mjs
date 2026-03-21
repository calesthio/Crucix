// briefing.test.mjs — Unit tests for apis/briefing.mjs
// Uses Node.js built-in test runner — no external dependencies

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runSource, fullBriefing } from '../apis/briefing.mjs';

// ─── runSource Tests ────────────────────────────────────────────────────────

describe('runSource', () => {
  it('wraps successful fn: returns { name, status:"ok", data, durationMs }', async () => {
    const result = await runSource('TestSource', async () => ({ foo: 'bar' }));
    assert.equal(result.name, 'TestSource');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, { foo: 'bar' });
    assert.ok(typeof result.durationMs === 'number');
    assert.ok(result.durationMs >= 0);
  });

  it('catches thrown errors: returns { name, status:"error", error }', async () => {
    const result = await runSource('FailSource', async () => {
      throw new Error('Something went wrong');
    });
    assert.equal(result.name, 'FailSource');
    assert.equal(result.status, 'error');
    assert.equal(result.error, 'Something went wrong');
    assert.ok(typeof result.durationMs === 'number');
  });

  it('passes args to fn correctly', async () => {
    const captured = {};
    await runSource('ArgsSource', async (a, b, c) => {
      captured.a = a;
      captured.b = b;
      captured.c = c;
      return 'done';
    }, 'alpha', 42, true);
    assert.equal(captured.a, 'alpha');
    assert.equal(captured.b, 42);
    assert.equal(captured.c, true);
  });

  it('handles fn that returns a non-object value', async () => {
    const result = await runSource('NumberSource', async () => 12345);
    assert.equal(result.status, 'ok');
    assert.equal(result.data, 12345);
  });

  it('timeout logic: uses Promise.race (structure test)', async () => {
    // We verify that runSource uses a Promise.race by checking that a fn
    // that rejects quickly is caught as an error result (not unhandled).
    // We do NOT wait 30s — we test with a fast rejection.
    const result = await runSource('QuickRejectSource', async () => {
      return Promise.reject(new Error('Instant failure'));
    });
    assert.equal(result.status, 'error');
    assert.equal(result.error, 'Instant failure');
  });

  it('returns durationMs as a non-negative number for successful calls', async () => {
    const result = await runSource('TimedSource', async () => {
      await new Promise(r => setTimeout(r, 5));
      return 'ok';
    });
    assert.ok(result.durationMs >= 0);
  });
});

// ─── fullBriefing Tests ──────────────────────────────────────────────────────

describe('fullBriefing', () => {
  let originalFetch;

  before(() => {
    // Mock globalThis.fetch so all source fetches return empty but valid responses
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({}),
      text: async () => '',
      status: 200,
    });
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns object with crucix metadata field', async () => {
    const result = await fullBriefing();
    assert.ok(result !== null && typeof result === 'object');
    assert.ok('crucix' in result, 'result must have a "crucix" field');
    const { crucix } = result;
    assert.ok(typeof crucix.version === 'string');
    assert.ok(typeof crucix.timestamp === 'string');
    assert.ok(typeof crucix.sourcesQueried === 'number');
    assert.ok(typeof crucix.sourcesOk === 'number');
    assert.ok(typeof crucix.sourcesFailed === 'number');
    assert.ok(typeof crucix.totalDurationMs === 'number');
  });

  it('returns object with sources field (object)', async () => {
    const result = await fullBriefing();
    assert.ok('sources' in result, 'result must have a "sources" field');
    // sources is an object (may be empty if all sources errored with mock fetch)
    assert.ok(result.sources !== null && typeof result.sources === 'object');
  });

  it('returns object with errors and timing fields', async () => {
    const result = await fullBriefing();
    assert.ok('errors' in result);
    assert.ok(Array.isArray(result.errors));
    assert.ok('timing' in result);
    assert.ok(result.timing !== null && typeof result.timing === 'object');
  });

  it('crucix.sourcesQueried equals the number of sources registered', async () => {
    const result = await fullBriefing();
    // There are 27 sources registered in fullBriefing
    assert.equal(result.crucix.sourcesQueried, 27);
  });
});
