// Telegram source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/telegram.mjs';

// Canned HTML that mimics a Telegram public channel web preview
const CANNED_HTML = `<html><body>
  <div class="tgme_widget_message_wrap" data-post="test/1">
    <div data-post="test/1">
      <div class="tgme_widget_message_text">Test message about geopolitics</div>
      <span class="tgme_widget_message_views">1.5K</span>
      <time datetime="2026-01-01T12:00:00+00:00"></time>
    </div>
  </div>
</body></html>`;

describe('telegram briefing — web scrape mode (no token)', () => {
  let savedToken;

  beforeEach(() => {
    // Ensure no token is set so we go into scraping mode
    savedToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  afterEach(() => {
    if (savedToken !== undefined) {
      process.env.TELEGRAM_BOT_TOKEN = savedToken;
    } else {
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
  });

  it('returns structured data with web_scrape status', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => CANNED_HTML,
      json: async () => { throw new Error('not json'); },
    });
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      assert.equal(result.source, 'Telegram');
      assert.equal(result.status, 'web_scrape');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('includes channel summary and post counts', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => CANNED_HTML,
      json: async () => { throw new Error('not json'); },
    });
    try {
      const result = await briefing();
      assert.ok(typeof result.channelsMonitored === 'number');
      assert.ok(typeof result.channelsReachable === 'number');
      assert.ok(typeof result.totalPosts === 'number');
      assert.ok(Array.isArray(result.topPosts));
      assert.ok(Array.isArray(result.urgentPosts));
      assert.ok(result.channels);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('includes a hint when no token is set', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => CANNED_HTML,
      json: async () => { throw new Error('not json'); },
    });
    try {
      const result = await briefing();
      assert.ok(result.hint);
      assert.ok(result.hint.includes('TELEGRAM_BOT_TOKEN'));
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
      assert.equal(result.source, 'Telegram');
      assert.ok(result.timestamp);
      // Even with all channels failing, should still return structure
      assert.ok(typeof result.totalPosts === 'number');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns a valid ISO timestamp', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => CANNED_HTML,
      json: async () => { throw new Error('not json'); },
    });
    try {
      const result = await briefing();
      assert.ok(!isNaN(Date.parse(result.timestamp)));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('telegram briefing — bot API mode (with token)', () => {
  let savedToken;

  beforeEach(() => {
    savedToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-123';
  });

  afterEach(() => {
    if (savedToken !== undefined) {
      process.env.TELEGRAM_BOT_TOKEN = savedToken;
    } else {
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
  });

  it('falls through to scraping when bot API returns no messages', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('api.telegram.org')) {
        // Bot API returns ok but empty result
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, result: [] }),
          json: async () => ({ ok: true, result: [] }),
        };
      }
      // Public channel web scraping
      return {
        ok: true,
        status: 200,
        text: async () => CANNED_HTML,
        json: async () => { throw new Error('not json'); },
      };
    };
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.equal(result.source, 'Telegram');
      // Should be bot_api_empty_fallback_scrape since token is set but no messages
      assert.equal(result.status, 'bot_api_empty_fallback_scrape');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns bot_api status when bot returns messages', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('api.telegram.org')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ok: true,
            result: [
              {
                message: {
                  text: 'Breaking: geopolitical update',
                  date: Math.floor(Date.now() / 1000),
                  chat: { title: 'Test Channel', username: 'testchan' },
                  views: 5000,
                },
              },
            ],
          }),
          json: async () => ({
            ok: true,
            result: [
              {
                message: {
                  text: 'Breaking: geopolitical update',
                  date: Math.floor(Date.now() / 1000),
                  chat: { title: 'Test Channel', username: 'testchan' },
                  views: 5000,
                },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => CANNED_HTML,
        json: async () => { throw new Error('not json'); },
      };
    };
    try {
      const result = await briefing();
      assert.equal(result.source, 'Telegram');
      assert.equal(result.status, 'bot_api');
      assert.ok(Array.isArray(result.topPosts));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
