// Bluesky source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/bluesky.mjs';

// ─── Canned response ───

const cannedPostResponse = {
  posts: [
    {
      record: {
        text: 'Test post about Iran war and missile strike developments',
        createdAt: '2026-01-01T00:00:00Z',
      },
      author: {
        handle: 'test.bsky.social',
        displayName: 'Test User',
      },
      likeCount: 5,
      repostCount: 2,
    },
    {
      record: {
        text: 'Oil prices surge amid geopolitical tensions',
        createdAt: '2026-01-01T01:00:00Z',
      },
      author: {
        handle: 'news.bsky.social',
        displayName: 'News Account',
      },
      likeCount: 12,
      repostCount: 8,
    },
  ],
};

const emptyPostResponse = { posts: [] };

// ─── Tests ───

describe('bluesky briefing', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return structured data with mocked post data', async () => {
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(cannedPostResponse),
      json: async () => cannedPostResponse,
    });

    const result = await briefing();

    assert.equal(result.source, 'Bluesky');
    assert.ok(result.timestamp);
    assert.ok('topics' in result, 'should have topics object');
    assert.ok('conflict' in result.topics, 'should have conflict topic');
    assert.ok('markets' in result.topics, 'should have markets topic');
    assert.ok('health' in result.topics, 'should have health topic');
    assert.ok(Array.isArray(result.topics.conflict), 'conflict should be an array');
    assert.ok(Array.isArray(result.topics.markets), 'markets should be an array');
    assert.ok(Array.isArray(result.topics.health), 'health should be an array');
  });

  it('should compact posts with correct fields', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(cannedPostResponse),
      json: async () => cannedPostResponse,
    });

    const result = await briefing();

    // Each topic should contain compacted posts with text, author, date, likes
    const allTopicPosts = [
      ...result.topics.conflict,
      ...result.topics.markets,
      ...result.topics.health,
    ];

    if (allTopicPosts.length > 0) {
      const post = allTopicPosts[0];
      assert.ok('text' in post, 'post should have text');
      assert.ok('author' in post, 'post should have author');
      assert.ok('date' in post, 'post should have date');
      assert.ok('likes' in post, 'post should have likes');
    }
  });

  it('should handle empty post response gracefully', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(emptyPostResponse),
      json: async () => emptyPostResponse,
    });

    const result = await briefing();

    assert.equal(result.source, 'Bluesky');
    assert.ok(result.timestamp);
    assert.ok('topics' in result);
    assert.equal(result.topics.conflict.length, 0);
    assert.equal(result.topics.markets.length, 0);
    assert.equal(result.topics.health.length, 0);
  });

  it('should handle fetch error gracefully', async () => {
    globalThis.fetch = async () => { throw new Error('network error'); };

    const result = await briefing();

    // Should not throw — safeFetch returns null/error object on failure
    assert.ok(result !== undefined);
    assert.equal(result.source, 'Bluesky');
    assert.ok(result.timestamp);
    // Topics may be empty arrays when fetch fails
    assert.ok('topics' in result);
  });

  it('should handle HTTP error response gracefully', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests',
      json: async () => { throw new Error('not JSON'); },
    });

    const result = await briefing();

    assert.ok(result !== undefined);
    assert.equal(result.source, 'Bluesky');
    assert.ok(result.timestamp);
    assert.ok('topics' in result);
  });

  it('should make three search requests (one per topic)', async () => {
    let callCount = 0;
    globalThis.fetch = async (url) => {
      callCount++;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(cannedPostResponse),
        json: async () => cannedPostResponse,
      };
    };

    await briefing();

    // briefing() runs 3 sequential searches (conflict, markets, health)
    assert.equal(callCount, 3, 'should make exactly 3 fetch calls');
  });
});
