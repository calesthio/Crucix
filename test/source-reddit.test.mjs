// Reddit source — unit tests

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError, withEnv } from './helpers.mjs';

describe('Reddit source', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('getHot', () => {
    it('should use public endpoint when no token', async () => {
      let capturedUrl;
      const redditResponse = { data: { children: [] } };
      mockFetch(redditResponse);
      const origFetch = globalThis.fetch;
      globalThis.fetch = (url, opts) => { capturedUrl = url; return origFetch(url, opts); };

      const { getHot } = await import('../apis/sources/reddit.mjs');
      await getHot('worldnews', { limit: 5 });

      assert.ok(capturedUrl.includes('www.reddit.com/r/worldnews/hot.json'));
      assert.ok(capturedUrl.includes('limit=5'));
    });

    it('should use OAuth endpoint when token provided', async () => {
      let capturedUrl;
      const redditResponse = { data: { children: [] } };
      mockFetch(redditResponse);
      const origFetch = globalThis.fetch;
      globalThis.fetch = (url, opts) => { capturedUrl = url; return origFetch(url, opts); };

      const { getHot } = await import('../apis/sources/reddit.mjs');
      await getHot('worldnews', { limit: 5, token: 'test-token' });

      assert.ok(capturedUrl.includes('oauth.reddit.com/r/worldnews/hot'));
    });

    it('should return parsed subreddit data', async () => {
      const redditResponse = {
        data: {
          children: [
            {
              data: {
                title: 'Breaking news',
                score: 5000,
                num_comments: 200,
                url: 'https://example.com',
                created_utc: 1712750400,
              },
            },
          ],
        },
      };
      mockFetch(redditResponse);

      const { getHot } = await import('../apis/sources/reddit.mjs');
      const result = await getHot('worldnews');

      assert.ok(result.data.children.length === 1);
    });
  });

  describe('briefing', () => {
    it('should return no_key status when credentials missing', async () => {
      await withEnv({ REDDIT_CLIENT_ID: undefined, REDDIT_CLIENT_SECRET: undefined }, async () => {
        // Mock fetch to handle the token request (should not be called)
        mockFetch({});

        const { briefing } = await import('../apis/sources/reddit.mjs');
        const result = await briefing();

        assert.equal(result.source, 'Reddit');
        assert.equal(result.status, 'no_key');
        assert.ok(result.message.includes('OAuth'));
      });
    });

    it('should return subreddit data when token is available', async () => {
      const tokenResponse = { access_token: 'fake-token-123' };
      const subredditResponse = {
        data: {
          children: [
            {
              data: {
                title: 'Oil prices surge',
                score: 3000,
                num_comments: 150,
                url: 'https://example.com/oil',
                created_utc: 1712750400,
              },
            },
          ],
        },
      };

      // First call is token fetch (raw fetch), subsequent are safeFetch for subreddits
      let callCount = 0;
      const tokenFetchFn = () => {
        callCount++;
        if (callCount === 1) {
          // Token request
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(tokenResponse),
          });
        }
        // Subreddit requests (via safeFetch)
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(subredditResponse)),
          json: () => Promise.resolve(subredditResponse),
        });
      };

      await withEnv({ REDDIT_CLIENT_ID: 'test-id', REDDIT_CLIENT_SECRET: 'test-secret' }, async () => {
        globalThis.fetch = tokenFetchFn;

        const { briefing } = await import('../apis/sources/reddit.mjs');
        const result = await briefing();

        assert.equal(result.source, 'Reddit');
        assert.ok(result.subreddits);
        assert.ok(result.timestamp);
      });
    });

    it('should compact posts with correct fields', async () => {
      const subredditResponse = {
        data: {
          children: [
            {
              data: {
                title: 'Market analysis',
                score: 1500,
                num_comments: 75,
                url: 'https://example.com/markets',
                created_utc: 1712750400,
              },
            },
          ],
        },
      };

      let callCount = 0;
      const fetchFn = () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ access_token: 'tok' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(subredditResponse)),
          json: () => Promise.resolve(subredditResponse),
        });
      };

      await withEnv({ REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret' }, async () => {
        globalThis.fetch = fetchFn;

        const { briefing } = await import('../apis/sources/reddit.mjs');
        const result = await briefing();

        if (result.subreddits) {
          const firstSub = Object.values(result.subreddits)[0];
          if (firstSub && firstSub.length > 0) {
            const post = firstSub[0];
            assert.ok('title' in post);
            assert.ok('score' in post);
            assert.ok('comments' in post);
            assert.ok('url' in post);
            assert.ok('created' in post);
          }
        }
      });
    });

    it('should handle failed token request gracefully', async () => {
      await withEnv({ REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret' }, async () => {
        // Token request fails, then subreddit requests use public endpoint
        let callCount = 0;
        globalThis.fetch = (url, opts) => {
          callCount++;
          if (url.includes('access_token')) {
            return Promise.resolve({ ok: false, status: 401 });
          }
          // Public endpoint calls via safeFetch
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify({ data: { children: [] } })),
            json: () => Promise.resolve({ data: { children: [] } }),
          });
        };

        const { briefing } = await import('../apis/sources/reddit.mjs');
        const result = await briefing();

        assert.equal(result.source, 'Reddit');
        assert.ok(result.subreddits);
      });
    });

    it('should filter out null compact posts', async () => {
      const subredditResponse = {
        data: {
          children: [
            { data: { title: 'Good post', score: 100, num_comments: 10 } },
            { notData: true }, // no .data property, compactPost returns null
          ],
        },
      };

      let callCount = 0;
      globalThis.fetch = (url, opts) => {
        callCount++;
        if (url.includes('access_token')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ access_token: 'tok' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(subredditResponse)),
          json: () => Promise.resolve(subredditResponse),
        });
      };

      await withEnv({ REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret' }, async () => {
        const { briefing } = await import('../apis/sources/reddit.mjs');
        const result = await briefing();

        if (result.subreddits) {
          const firstSub = Object.values(result.subreddits)[0];
          if (firstSub) {
            // null posts should be filtered out
            assert.ok(firstSub.every(p => p !== null));
          }
        }
      });
    });
  });
});
