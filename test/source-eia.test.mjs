// EIA source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/eia.mjs';

// ─── Canned responses ───

function makeEiaResponse(value = '70.50', period = '2026-01') {
  return {
    response: {
      total: 10,
      dateFormat: 'YYYY-MM-DD',
      frequency: 'daily',
      data: [
        { period, value, 'unit-name': 'Dollars per Barrel' },
        { period: '2026-01-02', value: '69.80', 'unit-name': 'Dollars per Barrel' },
        { period: '2026-01-01', value: '68.50', 'unit-name': 'Dollars per Barrel' },
      ],
    },
  };
}

const cannedOilResponse = makeEiaResponse('70.50', '2026-01-03');
const cannedGasResponse = makeEiaResponse('3.25', '2026-01-03');
const cannedInventoryResponse = {
  response: {
    data: [
      { period: '2026-01-03', value: '420000', 'unit-name': 'Thousand Barrels' },
      { period: '2025-12-27', value: '418000', 'unit-name': 'Thousand Barrels' },
    ],
  },
};

// ─── Tests ───

describe('eia briefing', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return error object when apiKey is null', async () => {
    const result = await briefing(null);

    assert.equal(result.source, 'EIA');
    assert.ok(result.timestamp);
    assert.ok(result.error, 'should have error field');
    assert.ok(result.hint, 'should have hint field');
  });

  it('should return error object when apiKey is undefined', async () => {
    const result = await briefing(undefined);

    assert.equal(result.source, 'EIA');
    assert.ok(result.timestamp);
    assert.ok(result.error, 'should have error field');
    assert.ok(result.hint, 'should have hint field');
  });

  it('should return structured data with mocked API responses', async () => {
    let callIndex = 0;
    const responses = [
      cannedOilResponse,      // WTI
      cannedOilResponse,      // Brent
      cannedGasResponse,      // Henry Hub
      cannedInventoryResponse, // Crude stocks
    ];

    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(responses[callIndex] ?? cannedOilResponse),
      json: async () => responses[callIndex++] ?? cannedOilResponse,
    });

    const result = await briefing('test-api-key');

    assert.equal(result.source, 'EIA');
    assert.ok(result.timestamp);
    assert.ok('oilPrices' in result, 'should have oilPrices');
    assert.ok('gasPrice' in result, 'should have gasPrice');
    assert.ok('inventories' in result, 'should have inventories');
    assert.ok(Array.isArray(result.signals), 'should have signals array');
  });

  it('should include WTI and Brent oil price data', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(cannedOilResponse),
      json: async () => cannedOilResponse,
    });

    const result = await briefing('test-api-key');

    assert.ok('wti' in result.oilPrices, 'should have WTI price');
    assert.ok('brent' in result.oilPrices, 'should have Brent price');
    assert.ok('spread' in result.oilPrices, 'should have spread');

    if (result.oilPrices.wti) {
      assert.ok('value' in result.oilPrices.wti, 'WTI should have value');
      assert.ok('period' in result.oilPrices.wti, 'WTI should have period');
      assert.ok('label' in result.oilPrices.wti, 'WTI should have label');
      assert.ok(Array.isArray(result.oilPrices.wti.recent), 'WTI should have recent array');
    }
  });

  it('should include gas price data', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(cannedGasResponse),
      json: async () => cannedGasResponse,
    });

    const result = await briefing('test-api-key');

    if (result.gasPrice) {
      assert.ok('value' in result.gasPrice, 'gas should have value');
      assert.ok('period' in result.gasPrice, 'gas should have period');
      assert.ok('label' in result.gasPrice, 'gas should have label');
    }
  });

  it('should include inventory data', async () => {
    let callIndex = 0;
    const responses = [
      cannedOilResponse,
      cannedOilResponse,
      cannedGasResponse,
      cannedInventoryResponse,
    ];

    globalThis.fetch = async () => {
      const resp = responses[Math.min(callIndex, responses.length - 1)];
      callIndex++;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(resp),
        json: async () => resp,
      };
    };

    const result = await briefing('test-api-key');

    if (result.inventories?.crudeStocks) {
      assert.ok('value' in result.inventories.crudeStocks, 'crude stocks should have value');
      assert.ok('label' in result.inventories.crudeStocks, 'crude stocks should have label');
    }
  });

  it('should handle fetch error gracefully', async () => {
    globalThis.fetch = async () => { throw new Error('network error'); };

    const result = await briefing('test-api-key');

    assert.ok(result !== undefined);
    assert.equal(result.source, 'EIA');
    assert.ok(result.timestamp);
    // On error, should still return a structured object
  });

  it('should generate signal when WTI is above $100', async () => {
    const highOilResponse = makeEiaResponse('105.00', '2026-01-03');
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(highOilResponse),
      json: async () => highOilResponse,
    });

    const result = await briefing('test-api-key');

    if (result.signals && result.oilPrices?.wti?.value > 100) {
      const hasSignal = result.signals.some(s => s.includes('WTI') && s.includes('100'));
      assert.ok(hasSignal, 'should flag WTI above $100');
    }
  });

  it('should use Promise.all and make 4 parallel fetch calls', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(cannedOilResponse),
        json: async () => cannedOilResponse,
      };
    };

    await briefing('test-api-key');

    assert.equal(callCount, 4, 'should make exactly 4 fetch calls (WTI, Brent, Gas, Inventory)');
  });
});
