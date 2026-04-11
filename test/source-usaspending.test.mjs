import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

import { searchAwards, getAgencySpending, getDefenseSpending, briefing } from '../apis/sources/usaspending.mjs';

before(() => saveFetch());
after(() => restoreFetch());

const sampleAward = {
  'Award ID': 'W911QY-26-C-0001',
  'Recipient Name': 'Lockheed Martin',
  'Award Amount': 50000000,
  'Description': 'Aircraft maintenance',
  'Awarding Agency': 'Department of Defense',
  'Start Date': '2026-03-01',
  'Award Type': 'Definitive Contract',
};

const sampleAgency = {
  agency_name: 'Department of Defense',
  budget_authority_amount: 800000000000,
  obligated_amount: 750000000000,
  outlay_amount: 700000000000,
};

describe('usaspending - searchAwards', () => {
  it('returns award results on success', async () => {
    mockFetch({ results: [sampleAward], page_metadata: { total: 100 } });
    const result = await searchAwards({ keywords: ['defense'], limit: 10 });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]['Award ID'], 'W911QY-26-C-0001');
  });

  it('uses POST method', async () => {
    const fn = mockFetch({ results: [] });
    await searchAwards();
    const callArgs = fn.mock.calls[0].arguments;
    assert.ok(callArgs[0].includes('spending_by_award'));
    assert.equal(callArgs[1].method, 'POST');
    assert.equal(callArgs[1].headers['Content-Type'], 'application/json');
  });

  it('returns error object on HTTP failure', async () => {
    // searchAwards uses raw fetch, not safeFetch
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service unavailable'),
    });
    const result = await searchAwards();
    assert.ok(result.error);
    assert.ok(result.error.includes('503'));
    assert.deepEqual(result.results, []);
  });

  it('returns error on network failure', async () => {
    mockFetchError('ECONNREFUSED');
    const result = await searchAwards();
    assert.ok(result.error);
    assert.ok(result.error.includes('ECONNREFUSED'));
    assert.deepEqual(result.results, []);
  });

  it('uses default options when none provided', async () => {
    const fn = mockFetch({ results: [] });
    await searchAwards();
    const body = JSON.parse(fn.mock.calls[0].arguments[1].body);
    assert.deepEqual(body.filters.keywords, ['defense', 'military']);
    assert.equal(body.limit, 20);
    assert.equal(body.sort, 'Award Amount');
    assert.equal(body.order, 'desc');
  });
});

describe('usaspending - getAgencySpending', () => {
  it('returns agency data via safeFetch', async () => {
    mockFetch({ results: [sampleAgency] });
    const result = await getAgencySpending();
    assert.equal(result.results[0].agency_name, 'Department of Defense');
  });
});

describe('usaspending - getDefenseSpending', () => {
  it('searches with defense keywords', async () => {
    const fn = mockFetch({ results: [sampleAward] });
    await getDefenseSpending(14);
    const body = JSON.parse(fn.mock.calls[0].arguments[1].body);
    assert.ok(body.filters.keywords.includes('defense'));
    assert.ok(body.filters.keywords.includes('missile'));
    assert.ok(body.filters.keywords.includes('aircraft'));
  });
});

describe('usaspending - briefing', () => {
  it('returns structured briefing with defense and agencies', async () => {
    let callCount = 0;
    globalThis.fetch = async (url, opts) => {
      callCount++;
      // First call is POST (searchAwards for defense), second is GET (getAgencySpending via safeFetch)
      const body = opts?.method === 'POST'
        ? { results: [sampleAward] }
        : { results: [sampleAgency] };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body),
      };
    };

    const result = await briefing();
    assert.equal(result.source, 'USAspending');
    assert.ok(result.timestamp);
    assert.equal(result.recentDefenseContracts.length, 1);
    assert.equal(result.recentDefenseContracts[0].awardId, 'W911QY-26-C-0001');
    assert.equal(result.recentDefenseContracts[0].recipient, 'Lockheed Martin');
    assert.equal(result.topAgencies.length, 1);
    assert.equal(result.topAgencies[0].name, 'Department of Defense');
    assert.ok(!result.defenseError);
  });

  it('includes defenseError when search fails', async () => {
    globalThis.fetch = async (url, opts) => {
      if (opts?.method === 'POST') {
        return { ok: false, status: 500, text: () => Promise.resolve('Internal error') };
      }
      // safeFetch for agencies
      return {
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ results: [] })),
        json: () => Promise.resolve({ results: [] }),
      };
    };

    const result = await briefing();
    assert.ok(result.defenseError);
  });

  it('handles empty results', async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ results: [] })),
      json: () => Promise.resolve({ results: [] }),
    });

    const result = await briefing();
    assert.deepEqual(result.recentDefenseContracts, []);
    assert.deepEqual(result.topAgencies, []);
  });
});
