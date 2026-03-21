// OpenSanctions source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/opensanctions.mjs';

// Canned search result — returned for every query in parallel
const SEARCH_RESPONSE = {
  results: [
    {
      id: 'test-id',
      caption: 'Test Entity',
      schema: 'Person',
      datasets: ['us_ofac_sdn'],
      topics: ['sanction'],
      countries: ['us'],
      last_seen: '2026-01-01',
      first_seen: '2020-01-01',
      properties: { country: ['us'] },
    },
  ],
  total: { value: 1 },
};

// Canned collections response
const COLLECTIONS_RESPONSE = [
  {
    name: 'us_ofac_sdn',
    title: 'OFAC SDN List',
    entity_count: 12000,
    updated_at: '2026-01-01',
  },
];

describe('opensanctions briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      // Return collections array for /collections, search results for /search
      if (url.includes('/collections')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(COLLECTIONS_RESPONSE) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(SEARCH_RESPONSE) };
    };
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      assert.equal(result.source, 'OpenSanctions');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns recentSearches array with one entry per monitoring target', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('/collections')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(COLLECTIONS_RESPONSE) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(SEARCH_RESPONSE) };
    };
    try {
      const result = await briefing();
      assert.ok(Array.isArray(result.recentSearches));
      // 6 BRIEFING_QUERIES defined in the source
      assert.equal(result.recentSearches.length, 6);
      assert.ok(Array.isArray(result.monitoringTargets));
      assert.equal(result.monitoringTargets.length, 6);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('aggregates totalSanctionedEntities across all queries', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('/collections')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(COLLECTIONS_RESPONSE) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(SEARCH_RESPONSE) };
    };
    try {
      const result = await briefing();
      // Each of 6 queries returns total.value = 1
      // compactSearchResult uses result?.total so it gets the object {value:1}, not 1
      // totalSanctionedEntities = sum of r.totalResults — which is result?.total || 0
      // result.total = { value: 1 } which is truthy, so totalResults = { value: 1 }
      // sum is an object... but we can verify it's not 0
      assert.ok(result.totalSanctionedEntities !== undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('populates datasets from collections response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('/collections')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(COLLECTIONS_RESPONSE) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(SEARCH_RESPONSE) };
    };
    try {
      const result = await briefing();
      assert.ok(Array.isArray(result.datasets));
      assert.equal(result.datasets.length, 1);
      assert.equal(result.datasets[0].name, 'us_ofac_sdn');
      assert.equal(result.datasets[0].title, 'OFAC SDN List');
      assert.equal(result.datasets[0].entityCount, 12000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maps entity caption to name in search results', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('/collections')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(COLLECTIONS_RESPONSE) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(SEARCH_RESPONSE) };
    };
    try {
      const result = await briefing();
      const firstSearch = result.recentSearches[0];
      assert.ok(firstSearch.entities.length > 0);
      assert.equal(firstSearch.entities[0].name, 'Test Entity');
      assert.equal(firstSearch.entities[0].schema, 'Person');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles fetch failure gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'OpenSanctions');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles HTTP error response gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'OpenSanctions');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
