// Reddit source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/reddit.mjs';

const CANNED_RESPONSE = {
  data: {
    children: [
      {
        data: {
          title: 'Test Post',
          score: 1000,
          num_comments: 50,
          url: 'https://reddit.com/r/test/1',
          created_utc: 1700000000,
        },
      },
    ],
  },
};

describe('reddit briefing — no credentials', () => {
  it('returns no_key status when env vars are absent', async () => {
    // Ensure credentials are not set
    const savedId = process.env.REDDIT_CLIENT_ID;
    const savedSecret = process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;

    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      assert.equal(result.source, 'Reddit');
      assert.equal(result.status, 'no_key');
      assert.ok(result.message);
    } finally {
      if (savedId !== undefined) process.env.REDDIT_CLIENT_ID = savedId;
      if (savedSecret !== undefined) process.env.REDDIT_CLIENT_SECRET = savedSecret;
    }
  });
});

describe('reddit briefing — with credentials (mocked OAuth)', () => {
  it('returns subreddit data when OAuth succeeds', async () => {
    const savedId = process.env.REDDIT_CLIENT_ID;
    const savedSecret = process.env.REDDIT_CLIENT_SECRET;
    process.env.REDDIT_CLIENT_ID = 'test-client-id';
    process.env.REDDIT_CLIENT_SECRET = 'test-client-secret';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      // Mock OAuth token endpoint
      if (url.includes('/api/v1/access_token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'mock-token' }),
          text: async () => JSON.stringify({ access_token: 'mock-token' }),
        };
      }
      // Mock subreddit hot posts endpoint (oauth.reddit.com)
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(CANNED_RESPONSE),
      };
    };

    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      assert.equal(result.source, 'Reddit');
      assert.ok(result.subreddits);
      assert.ok(typeof result.subreddits === 'object');
    } finally {
      globalThis.fetch = originalFetch;
      if (savedId !== undefined) process.env.REDDIT_CLIENT_ID = savedId;
      else delete process.env.REDDIT_CLIENT_ID;
      if (savedSecret !== undefined) process.env.REDDIT_CLIENT_SECRET = savedSecret;
      else delete process.env.REDDIT_CLIENT_SECRET;
    }
  });

  it('compacts posts correctly when OAuth token obtained', async () => {
    const savedId = process.env.REDDIT_CLIENT_ID;
    const savedSecret = process.env.REDDIT_CLIENT_SECRET;
    process.env.REDDIT_CLIENT_ID = 'test-client-id';
    process.env.REDDIT_CLIENT_SECRET = 'test-client-secret';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('/api/v1/access_token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'mock-token' }),
          text: async () => JSON.stringify({ access_token: 'mock-token' }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(CANNED_RESPONSE),
      };
    };

    try {
      const result = await briefing();
      // Check the first subreddit has posts
      const firstSubreddit = Object.keys(result.subreddits)[0];
      const posts = result.subreddits[firstSubreddit];
      assert.ok(Array.isArray(posts));
      assert.ok(posts.length > 0);
      const post = posts[0];
      assert.equal(post.title, 'Test Post');
      assert.equal(post.score, 1000);
      assert.equal(post.comments, 50);
      assert.equal(post.url, 'https://reddit.com/r/test/1');
      assert.ok(post.created); // ISO string derived from created_utc
    } finally {
      globalThis.fetch = originalFetch;
      if (savedId !== undefined) process.env.REDDIT_CLIENT_ID = savedId;
      else delete process.env.REDDIT_CLIENT_ID;
      if (savedSecret !== undefined) process.env.REDDIT_CLIENT_SECRET = savedSecret;
      else delete process.env.REDDIT_CLIENT_SECRET;
    }
  });

  it('falls back gracefully when OAuth token fetch fails', async () => {
    const savedId = process.env.REDDIT_CLIENT_ID;
    const savedSecret = process.env.REDDIT_CLIENT_SECRET;
    process.env.REDDIT_CLIENT_ID = 'test-client-id';
    process.env.REDDIT_CLIENT_SECRET = 'test-client-secret';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      // OAuth fails
      if (url.includes('/api/v1/access_token')) {
        return { ok: false, status: 401, text: async () => 'Unauthorized' };
      }
      // Public endpoint also fails (403 is typical without auth)
      return { ok: false, status: 403, text: async () => 'Forbidden' };
    };

    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'Reddit');
      // When token is null but REDDIT_CLIENT_ID is set, code tries public endpoint
      // Public endpoint returns 403 error, so subreddits contain empty arrays
      assert.ok(result.subreddits);
    } finally {
      globalThis.fetch = originalFetch;
      if (savedId !== undefined) process.env.REDDIT_CLIENT_ID = savedId;
      else delete process.env.REDDIT_CLIENT_ID;
      if (savedSecret !== undefined) process.env.REDDIT_CLIENT_SECRET = savedSecret;
      else delete process.env.REDDIT_CLIENT_SECRET;
    }
  });
});

describe('reddit briefing — fetch failure', () => {
  it('handles network error during OAuth gracefully', async () => {
    const savedId = process.env.REDDIT_CLIENT_ID;
    const savedSecret = process.env.REDDIT_CLIENT_SECRET;
    process.env.REDDIT_CLIENT_ID = 'test-client-id';
    process.env.REDDIT_CLIENT_SECRET = 'test-client-secret';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };

    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'Reddit');
    } finally {
      globalThis.fetch = originalFetch;
      if (savedId !== undefined) process.env.REDDIT_CLIENT_ID = savedId;
      else delete process.env.REDDIT_CLIENT_ID;
      if (savedSecret !== undefined) process.env.REDDIT_CLIENT_SECRET = savedSecret;
      else delete process.env.REDDIT_CLIENT_SECRET;
    }
  });
});
