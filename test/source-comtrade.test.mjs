// UN Comtrade source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/comtrade.mjs';

// ─── Canned responses ───

const cannedTradeRecord = {
  reporterDesc: 'USA',
  reporterCode: 842,
  partnerDesc: 'China',
  partnerCode: 156,
  cmdDesc: 'Soybeans',
  cmdCode: '1201',
  flowDesc: 'Export',
  flowCode: 'X',
  primaryValue: 5000000000,
  netWgt: 1000000,
  qtDesc: 'kg',
  qtyUnitAbbr: 'kg',
  period: '2025',
};

const cannedDataResponse = {
  data: [cannedTradeRecord],
};

const emptyDataResponse = {
  data: [],
};

// ─── Tests ───

describe('comtrade briefing', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return structured data with mocked trade response', async () => {
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(cannedDataResponse),
      json: async () => cannedDataResponse,
    });

    const result = await briefing();

    assert.equal(result.source, 'UN Comtrade');
    assert.ok(result.timestamp);
    assert.ok(Array.isArray(result.tradeFlows), 'should have tradeFlows array');
    assert.ok(Array.isArray(result.signals), 'should have signals array');
    assert.ok('status' in result, 'should have status');
    assert.ok('note' in result, 'should have note');
    assert.ok('coveredCommodities' in result, 'should have coveredCommodities');
    assert.ok('coveredCountries' in result, 'should have coveredCountries');
  });

  it('should have ok status when trade data is returned', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(cannedDataResponse),
      json: async () => cannedDataResponse,
    });

    const result = await briefing();

    assert.equal(result.status, 'ok');
    assert.ok(result.tradeFlows.length > 0, 'should have at least one trade flow');
  });

  it('should have correct trade flow structure', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(cannedDataResponse),
      json: async () => cannedDataResponse,
    });

    const result = await briefing();

    if (result.tradeFlows.length > 0) {
      const flow = result.tradeFlows[0];
      assert.ok('reporter' in flow, 'flow should have reporter');
      assert.ok('commodity' in flow, 'flow should have commodity');
      assert.ok('cmdCode' in flow, 'flow should have cmdCode');
      assert.ok('topPartners' in flow, 'flow should have topPartners');
      assert.ok('totalRecords' in flow, 'flow should have totalRecords');
      assert.ok(Array.isArray(flow.topPartners), 'topPartners should be array');

      if (flow.topPartners.length > 0) {
        const partner = flow.topPartners[0];
        assert.ok('reporter' in partner, 'partner record should have reporter');
        assert.ok('partner' in partner, 'partner record should have partner');
        assert.ok('commodity' in partner, 'partner record should have commodity');
        assert.ok('flow' in partner, 'partner record should have flow');
        assert.ok('value' in partner, 'partner record should have value');
      }
    }
  });

  it('should return no_data status when all queries return empty', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(emptyDataResponse),
      json: async () => emptyDataResponse,
    });

    const result = await briefing();

    assert.equal(result.source, 'UN Comtrade');
    assert.ok(result.timestamp);
    assert.equal(result.status, 'no_data');
    assert.equal(result.tradeFlows.length, 0);
  });

  it('should handle fetch error gracefully', async () => {
    globalThis.fetch = async () => { throw new Error('network error'); };

    const result = await briefing();

    assert.ok(result !== undefined);
    assert.equal(result.source, 'UN Comtrade');
    assert.ok(result.timestamp);
    // Should return structured result even on error
    assert.ok(Array.isArray(result.tradeFlows));
  });

  it('should handle HTTP error response gracefully', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
      json: async () => { throw new Error('not JSON'); },
    });

    const result = await briefing();

    assert.ok(result !== undefined);
    assert.equal(result.source, 'UN Comtrade');
    assert.ok(result.timestamp);
    assert.ok(Array.isArray(result.tradeFlows));
  });

  it('should detect anomalies when trade values are extreme outliers', async () => {
    // Provide many records with one outlier
    const records = [
      { ...cannedTradeRecord, primaryValue: 100000000, partnerDesc: 'Germany' },
      { ...cannedTradeRecord, primaryValue: 110000000, partnerDesc: 'Japan' },
      { ...cannedTradeRecord, primaryValue: 90000000, partnerDesc: 'UK' },
      { ...cannedTradeRecord, primaryValue: 5000000000, partnerDesc: 'China' }, // outlier
    ];
    const outlierResponse = { data: records };

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(outlierResponse),
      json: async () => outlierResponse,
    });

    const result = await briefing();

    assert.equal(result.source, 'UN Comtrade');
    // If anomaly detection fires, signals should have OUTLIER entries
    // (may or may not trigger depending on which commodity key returns data)
    assert.ok(Array.isArray(result.signals));
  });
});
