// GDELT — Global Database of Events, Language, and Tone — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/gdelt.mjs';

const CANNED_ARTICLE_FEED = {
  articles: [
    {
      title: 'Military conflict escalates in region',
      url: 'https://example.com/article1',
      seendate: '20260101T120000Z',
      domain: 'example.com',
      language: 'English',
      sourcecountry: 'US',
    },
    {
      title: 'Economic sanctions impact global trade',
      url: 'https://example.com/article2',
      seendate: '20260101T110000Z',
      domain: 'example.com',
      language: 'English',
      sourcecountry: 'GB',
    },
  ],
};

const CANNED_GEO_FEED = {
  features: [
    {
      geometry: { coordinates: [-77.0, 38.9] },
      properties: { name: 'Washington DC', count: 5, type: 'event' },
    },
  ],
};

describe('gdelt briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async (url) => {
      callCount++;
      // Return geo data for geo endpoint, article data for doc endpoint
      if (url && url.includes('geo/geo')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(CANNED_GEO_FEED),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(CANNED_ARTICLE_FEED),
      };
    };
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'GDELT');
      assert.ok(result.timestamp);
      assert.ok(typeof result.totalArticles === 'number');
      assert.ok(Array.isArray(result.allArticles));
      assert.ok(Array.isArray(result.geoPoints));
      assert.ok(Array.isArray(result.conflicts));
      assert.ok(Array.isArray(result.economy));
      assert.ok(Array.isArray(result.health));
      assert.ok(Array.isArray(result.crisis));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('categorizes articles correctly by keyword', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url && url.includes('geo/geo')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ features: [] }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(CANNED_ARTICLE_FEED),
      };
    };
    try {
      const result = await briefing();
      // "Military conflict escalates" should appear in conflicts
      assert.ok(result.conflicts.length >= 1);
      // "Economic sanctions impact" should appear in economy
      assert.ok(result.economy.length >= 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles fetch failure gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    try {
      const result = await briefing();
      assert.ok(result !== undefined); // must not throw
      assert.equal(result.source, 'GDELT');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles empty article list gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url && url.includes('geo/geo')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ features: [] }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ articles: [] }),
      };
    };
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.totalArticles, 0);
      assert.equal(result.allArticles.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles non-ok HTTP response gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests',
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'GDELT');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
