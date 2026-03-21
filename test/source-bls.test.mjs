// BLS source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/bls.mjs';

// ─── Canned responses ───

const cannedBlsResponse = {
  status: 'REQUEST_SUCCEEDED',
  responseTime: 53,
  message: [],
  Results: {
    series: [
      {
        seriesID: 'CUUR0000SA0',
        data: [
          { year: '2026', period: 'M01', value: '315.0', periodName: 'January', footnotes: [{}] },
          { year: '2025', period: 'M12', value: '314.0', periodName: 'December', footnotes: [{}] },
        ],
      },
      {
        seriesID: 'CUUR0000SA0L1E',
        data: [
          { year: '2026', period: 'M01', value: '320.5', periodName: 'January', footnotes: [{}] },
          { year: '2025', period: 'M12', value: '319.8', periodName: 'December', footnotes: [{}] },
        ],
      },
      {
        seriesID: 'LNS14000000',
        data: [
          { year: '2026', period: 'M01', value: '4.1', periodName: 'January', footnotes: [{}] },
          { year: '2025', period: 'M12', value: '4.0', periodName: 'December', footnotes: [{}] },
        ],
      },
      {
        seriesID: 'CES0000000001',
        data: [
          { year: '2026', period: 'M01', value: '159200', periodName: 'January', footnotes: [{}] },
          { year: '2025', period: 'M12', value: '159100', periodName: 'December', footnotes: [{}] },
        ],
      },
      {
        seriesID: 'WPUFD49104',
        data: [
          { year: '2026', period: 'M01', value: '145.2', periodName: 'January', footnotes: [{}] },
          { year: '2025', period: 'M12', value: '144.8', periodName: 'December', footnotes: [{}] },
        ],
      },
    ],
  },
};

// ─── Tests ───

describe('bls briefing', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return structured indicators with mocked BLS response', async () => {
    globalThis.fetch = async (url, opts) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(cannedBlsResponse),
      json: async () => cannedBlsResponse,
    });

    const result = await briefing(null);

    assert.equal(result.source, 'BLS');
    assert.ok(result.timestamp);
    assert.ok(Array.isArray(result.indicators), 'should have indicators array');
    assert.ok(Array.isArray(result.signals), 'should have signals array');
    assert.ok(result.indicators.length > 0, 'should have at least one indicator');

    // Check structure of first indicator
    const ind = result.indicators[0];
    assert.ok('id' in ind, 'indicator should have id');
    assert.ok('label' in ind, 'indicator should have label');
    assert.ok('value' in ind, 'indicator should have value');
    assert.ok('period' in ind, 'indicator should have period');
  });

  it('should work without an apiKey (null key uses v1 endpoint)', async () => {
    globalThis.fetch = async (url, opts) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(cannedBlsResponse),
      json: async () => cannedBlsResponse,
    });

    const result = await briefing(null);

    assert.equal(result.source, 'BLS');
    assert.ok(!result.error, 'should not have error with null key');
    assert.ok(Array.isArray(result.indicators));
  });

  it('should work with an apiKey (uses v2 endpoint)', async () => {
    let capturedBody;
    globalThis.fetch = async (url, opts) => {
      if (opts?.body) capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(cannedBlsResponse),
        json: async () => cannedBlsResponse,
      };
    };

    const result = await briefing('test-api-key');

    assert.equal(result.source, 'BLS');
    assert.ok(Array.isArray(result.indicators));
    // With key, registrationkey should be in the POST body
    if (capturedBody) {
      assert.equal(capturedBody.registrationkey, 'test-api-key');
    }
  });

  it('should handle fetch network error gracefully', async () => {
    globalThis.fetch = async () => { throw new Error('network error'); };

    const result = await briefing(null);

    assert.ok(result !== undefined);
    assert.equal(result.source, 'BLS');
    assert.ok(result.error, 'should have error field on network failure');
  });

  it('should handle BLS API failure status gracefully', async () => {
    const failResponse = {
      status: 'REQUEST_FAILED',
      message: ['Daily limit exceeded for IP address'],
      Results: {},
    };

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(failResponse),
      json: async () => failResponse,
    });

    const result = await briefing(null);

    assert.ok(result !== undefined);
    assert.equal(result.source, 'BLS');
    assert.ok(result.error || result.rawStatus, 'should indicate API failure');
  });

  it('should include momChange and momChangePct for indicators with two data points', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(cannedBlsResponse),
      json: async () => cannedBlsResponse,
    });

    const result = await briefing(null);

    const cpiIndicator = result.indicators?.find(i => i.id === 'CUUR0000SA0');
    if (cpiIndicator) {
      assert.ok('momChange' in cpiIndicator, 'should have momChange');
      assert.ok('momChangePct' in cpiIndicator, 'should have momChangePct');
    }
  });
});
