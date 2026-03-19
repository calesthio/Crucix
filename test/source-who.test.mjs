// WHO source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/who.mjs';

// Canned outbreak response — note: this endpoint uses .json() not .text()
const OUTBREAK_RESPONSE = {
  value: [
    {
      Id: 1,
      Title: 'Test Outbreak',
      Summary: '<p>Test disease outbreak</p>',
      PublicationDate: '2026-01-01T00:00:00Z',
      PrimaryLanguage: 'EN',
      DonId: 'DON123',
      ItemDefaultUrl: '/details/test-outbreak',
    },
  ],
};

// A response with a recent date (within last 30 days from test run)
const RECENT_OUTBREAK_RESPONSE = {
  value: [
    {
      Id: 2,
      Title: 'Recent Outbreak',
      Summary: '<p>Recent disease event</p>',
      // Use current date so it passes the 30-day filter in who.mjs
      PublicationDate: new Date().toISOString(),
      PrimaryLanguage: 'EN',
      DonId: 'DON456',
      ItemDefaultUrl: '/details/recent-outbreak',
    },
  ],
};

describe('WHO briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    // getOutbreakNews uses raw fetch with .json() (not safeFetch/.text())
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => RECENT_OUTBREAK_RESPONSE,
    });
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.equal(result.source, 'WHO');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.diseaseOutbreakNews));
      assert.ok(Array.isArray(result.monitoringCapabilities));
      assert.ok(result.monitoringCapabilities.length > 0);
      // With a recent date the item should pass the 30-day filter
      if (result.diseaseOutbreakNews.length > 0) {
        const item = result.diseaseOutbreakNews[0];
        assert.equal(item.title, 'Recent Outbreak');
        assert.ok(item.date);
        // HTML tags should be stripped from summary
        assert.ok(!item.summary || !item.summary.includes('<p>'));
      }
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
      assert.equal(result.source, 'WHO');
      assert.ok(result.timestamp);
      // On error, diseaseOutbreakNews should be empty array and outbreakError set
      assert.ok(Array.isArray(result.diseaseOutbreakNews));
      assert.equal(result.diseaseOutbreakNews.length, 0);
      assert.ok(result.outbreakError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles HTTP error response gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'WHO');
      assert.ok(Array.isArray(result.diseaseOutbreakNews));
      assert.equal(result.diseaseOutbreakNews.length, 0);
      assert.ok(result.outbreakError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('filters out items older than 30 days', async () => {
    const originalFetch = globalThis.fetch;
    // Use an old date that will be filtered out
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        value: [
          {
            Id: 99,
            Title: 'Old Outbreak',
            Summary: 'Old event',
            PublicationDate: oldDate,
            PrimaryLanguage: 'EN',
          },
        ],
      }),
    });
    try {
      const result = await briefing();
      assert.equal(result.source, 'WHO');
      // Old items should be filtered out
      assert.equal(result.diseaseOutbreakNews.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('strips HTML tags from summary', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        value: [
          {
            Id: 3,
            Title: 'HTML Test',
            Summary: '<p><strong>Bold text</strong> and <em>italic</em></p>',
            PublicationDate: new Date().toISOString(),
            PrimaryLanguage: 'EN',
          },
        ],
      }),
    });
    try {
      const result = await briefing();
      if (result.diseaseOutbreakNews.length > 0) {
        const summary = result.diseaseOutbreakNews[0].summary;
        assert.ok(summary !== null);
        assert.ok(!summary.includes('<p>'));
        assert.ok(!summary.includes('<strong>'));
        assert.ok(summary.includes('Bold text'));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
