// Bluesky source — unit tests

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

describe('Bluesky source', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('searchPosts', () => {
    it('should call the correct API URL with default params', async () => {
      let capturedUrl;
      mockFetch({ posts: [] });
      const origFetch = globalThis.fetch;
      globalThis.fetch = (url, opts) => { capturedUrl = url; return origFetch(url, opts); };

      const { searchPosts } = await import('../apis/sources/bluesky.mjs');
      await searchPosts('test query');

      assert.ok(capturedUrl.includes('app.bsky.feed.searchPosts'));
      assert.ok(capturedUrl.includes('q=test+query'));
      assert.ok(capturedUrl.includes('limit=25'));
      assert.ok(capturedUrl.includes('sort=latest'));
    });

    it('should return parsed API response', async () => {
      const payload = {
        posts: [
          {
            record: { text: 'Hello world', createdAt: '2026-04-10T12:00:00Z' },
            author: { handle: 'alice.bsky.social', displayName: 'Alice' },
            likeCount: 42,
          },
        ],
      };
      mockFetch(payload);

      const { searchPosts } = await import('../apis/sources/bluesky.mjs');
      const result = await searchPosts('hello');
      assert.ok(result.posts);
      assert.equal(result.posts.length, 1);
    });
  });

  describe('briefing', () => {
    it('should return structured briefing with three topic categories', async () => {
      const apiResponse = {
        posts: [
          {
            record: { text: 'Sanctions on Iran escalate', createdAt: '2026-04-10T10:00:00Z' },
            author: { handle: 'geo.analyst', displayName: 'Geo Analyst' },
            likeCount: 15,
          },
          {
            record: { text: 'Oil prices surge amid tensions', createdAt: '2026-04-10T11:00:00Z' },
            author: { handle: 'market.watch' },
            likeCount: 30,
          },
        ],
      };
      mockFetch(apiResponse);

      const { briefing } = await import('../apis/sources/bluesky.mjs');
      const result = await briefing();

      assert.equal(result.source, 'Bluesky');
      assert.ok(result.timestamp);
      assert.ok(result.topics);
      assert.ok(Array.isArray(result.topics.conflict));
      assert.ok(Array.isArray(result.topics.markets));
      assert.ok(Array.isArray(result.topics.health));
    });

    it('should compact posts with text, author, date, likes', async () => {
      const apiResponse = {
        posts: [
          {
            record: { text: 'A very long post about market crash', createdAt: '2026-04-10T10:00:00Z' },
            author: { handle: 'analyst.bsky.social', displayName: 'Analyst' },
            likeCount: 5,
          },
        ],
      };
      mockFetch(apiResponse);

      const { briefing } = await import('../apis/sources/bluesky.mjs');
      const result = await briefing();

      // At least one topic should have posts
      const allPosts = [
        ...result.topics.conflict,
        ...result.topics.markets,
        ...result.topics.health,
      ];
      if (allPosts.length > 0) {
        const post = allPosts[0];
        assert.ok('text' in post);
        assert.ok('author' in post);
        assert.ok('date' in post);
        assert.ok('likes' in post);
      }
    });

    it('should handle empty posts gracefully', async () => {
      mockFetch({ posts: [] });

      const { briefing } = await import('../apis/sources/bluesky.mjs');
      const result = await briefing();

      assert.equal(result.source, 'Bluesky');
      assert.deepEqual(result.topics.conflict, []);
      assert.deepEqual(result.topics.markets, []);
      assert.deepEqual(result.topics.health, []);
    });

    it('should handle API error gracefully', async () => {
      mockFetchError('Connection refused');

      const { briefing } = await import('../apis/sources/bluesky.mjs');
      const result = await briefing();

      // safeFetch returns { error, source } on failure; briefing uses result?.posts || []
      assert.equal(result.source, 'Bluesky');
      assert.deepEqual(result.topics.conflict, []);
      assert.deepEqual(result.topics.markets, []);
      assert.deepEqual(result.topics.health, []);
    });

    it('should handle missing author fields', async () => {
      const apiResponse = {
        posts: [
          {
            record: { text: 'No author info here', createdAt: '2026-04-10T10:00:00Z' },
            likeCount: 0,
          },
        ],
      };
      mockFetch(apiResponse);

      const { briefing } = await import('../apis/sources/bluesky.mjs');
      const result = await briefing();
      assert.equal(result.source, 'Bluesky');
    });
  });
});
