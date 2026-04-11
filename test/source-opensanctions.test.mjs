import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

// safeFetch uses globalThis.fetch internally
import { searchEntities, getCollections, getDataset, getEntity, briefing } from '../apis/sources/opensanctions.mjs';

before(() => saveFetch());
after(() => restoreFetch());

describe('opensanctions - searchEntities', () => {
  it('returns search results with compact entities', async () => {
    mockFetch({
      total: 42,
      results: [
        {
          id: 'NK-001',
          caption: 'Kim Jong Un',
          schema: 'Person',
          datasets: ['us_ofac_sdn'],
          topics: ['sanction'],
          properties: { country: ['KP'] },
          last_seen: '2026-04-01',
          first_seen: '2018-01-01',
        },
      ],
    });

    const result = await searchEntities('North Korea', { limit: 10, topics: 'sanction' });
    assert.equal(result.total, 42);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].id, 'NK-001');
  });

  it('passes schema and topics params', async () => {
    const fn = mockFetch({ total: 0, results: [] });
    await searchEntities('test', { limit: 5, schema: 'Person', topics: 'crime' });
    const calledUrl = fn.mock.calls[0].arguments[0];
    assert.ok(calledUrl.includes('schema=Person'));
    assert.ok(calledUrl.includes('topics=crime'));
    assert.ok(calledUrl.includes('limit=5'));
  });

  it('handles API error gracefully', async () => {
    mockFetchError('Connection refused');
    const result = await searchEntities('test');
    assert.ok(result.error);
    assert.ok(result.error.includes('Connection refused'));
  });
});

describe('opensanctions - getCollections', () => {
  it('returns collection list', async () => {
    mockFetch([
      { name: 'us_ofac_sdn', title: 'US OFAC SDN', entity_count: 12000, updated_at: '2026-04-01' },
    ]);

    const result = await getCollections();
    assert.ok(Array.isArray(result));
    assert.equal(result[0].name, 'us_ofac_sdn');
  });
});

describe('opensanctions - getDataset', () => {
  it('fetches dataset by name', async () => {
    const fn = mockFetch({ name: 'eu_sanctions', title: 'EU Sanctions', entity_count: 5000 });
    const result = await getDataset('eu_sanctions');
    const calledUrl = fn.mock.calls[0].arguments[0];
    assert.ok(calledUrl.includes('/datasets/eu_sanctions'));
    assert.equal(result.name, 'eu_sanctions');
  });
});

describe('opensanctions - getEntity', () => {
  it('fetches entity by ID', async () => {
    const fn = mockFetch({ id: 'Q123', caption: 'Test Entity', schema: 'Person' });
    const result = await getEntity('Q123');
    const calledUrl = fn.mock.calls[0].arguments[0];
    assert.ok(calledUrl.includes('/entities/Q123'));
    assert.equal(result.id, 'Q123');
  });
});

describe('opensanctions - briefing', () => {
  it('returns structured briefing with searches and datasets', async () => {
    // briefing calls searchEntities 6 times (BRIEFING_QUERIES) + getCollections once
    let callCount = 0;
    globalThis.fetch = async (url) => {
      callCount++;
      const body = url.includes('/collections')
        ? [
            { name: 'us_ofac_sdn', title: 'OFAC SDN', entity_count: 12000, updated_at: '2026-04-01' },
          ]
        : {
            total: 10,
            results: [
              {
                id: `ENT-${callCount}`,
                caption: `Entity ${callCount}`,
                schema: 'Person',
                datasets: ['test'],
                topics: ['sanction'],
                properties: { country: ['US'] },
                last_seen: '2026-04-01',
                first_seen: '2020-01-01',
              },
            ],
          };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body),
      };
    };

    const result = await briefing();
    assert.equal(result.source, 'OpenSanctions');
    assert.ok(result.timestamp);
    assert.equal(result.recentSearches.length, 6); // 6 BRIEFING_QUERIES
    assert.ok(result.totalSanctionedEntities > 0);
    assert.ok(Array.isArray(result.datasets));
    assert.deepEqual(result.monitoringTargets, ['Iran', 'Russia', 'North Korea', 'Syria', 'Venezuela', 'Wagner']);

    // Check compact entity shape
    const firstSearch = result.recentSearches[0];
    assert.ok(firstSearch.query);
    assert.ok(typeof firstSearch.totalResults === 'number');
    assert.ok(Array.isArray(firstSearch.entities));
    const entity = firstSearch.entities[0];
    assert.ok(entity.id);
    assert.ok(entity.name);
    assert.ok(entity.schema);
  });

  it('handles all API errors gracefully', async () => {
    mockFetchError('Service unavailable');
    const result = await briefing();
    assert.equal(result.source, 'OpenSanctions');
    // Should still return structure even with errors
    assert.ok(result.recentSearches);
    assert.equal(result.totalSanctionedEntities, 0);
  });

  it('handles non-array collections', async () => {
    // Return error object for collections
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ total: 0, results: [] })),
      json: () => Promise.resolve({ total: 0, results: [] }),
    });

    const result = await briefing();
    assert.equal(result.source, 'OpenSanctions');
    assert.deepEqual(result.datasets, []);
  });
});
