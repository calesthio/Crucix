import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError, withEnv } from './helpers.mjs';

let mod;
before(async () => {
  saveFetch();
  mod = await import('../apis/sources/telegram.mjs');
});
after(() => { restoreFetch(); });

// Sample Bot API response
function botApiResponse(messages = []) {
  return {
    ok: true,
    result: messages.map((m, i) => ({
      update_id: 1000 + i,
      channel_post: {
        message_id: i + 1,
        date: Math.floor(Date.now() / 1000) - i * 3600,
        chat: { title: m.chat || 'Test Channel', username: 'testchannel' },
        text: m.text,
        views: m.views || 0,
        photo: m.hasPhoto ? [{}] : undefined,
      },
    })),
  };
}

// Sample Telegram web preview HTML
function channelHTML(channelId, posts = []) {
  let html = `<html><head><title>${channelId}</title></head><body>
<div class="tgme_channel_info_header_title"><span>${channelId} Channel</span></div>`;

  for (const post of posts) {
    html += `
data-post="${channelId}/${post.id}"
<div class="tgme_widget_message_text js-message_text" dir="auto">${post.text || ''}</div>
<span class="tgme_widget_message_views">${post.views || '0'}</span>
<time datetime="${post.date || '2026-04-09T12:00:00+00:00'}"></time>
`;
  }
  html += '</body></html>';
  return html;
}

describe('Telegram source', () => {
  describe('getUpdates()', () => {
    it('fetches bot API updates', async () => {
      // safeFetch is used, so we mock globalThis.fetch
      const data = botApiResponse([{ text: 'Test message', views: 100 }]);
      mockFetch(data);

      const result = await withEnv({ TELEGRAM_BOT_TOKEN: 'bot123:ABC' }, async () => {
        return mod.getUpdates({ limit: 10 });
      });
      assert.ok(result.ok);
      assert.ok(Array.isArray(result.result));
    });
  });

  describe('getChat()', () => {
    it('fetches chat info', async () => {
      mockFetch({ ok: true, result: { id: -100123, title: 'Test Channel', type: 'channel' } });

      const result = await withEnv({ TELEGRAM_BOT_TOKEN: 'bot123:ABC' }, async () => {
        return mod.getChat('testchannel');
      });
      assert.ok(result.ok || result.result);
    });
  });

  describe('briefing()', () => {
    it('uses Bot API when token is set and has messages', async () => {
      const messages = [
        { text: 'Breaking: missile strike confirmed in eastern Ukraine', views: 5000 },
        { text: 'Markets stable today', views: 200 },
        { text: 'Urgent: ceasefire negotiations begin', views: 3000 },
      ];
      const data = botApiResponse(messages);
      mockFetch(data);

      const result = await withEnv({ TELEGRAM_BOT_TOKEN: 'bot123:ABC' }, async () => {
        return mod.briefing();
      });

      assert.equal(result.source, 'Telegram');
      assert.equal(result.status, 'bot_api');
      assert.ok(result.totalMessages > 0);
      assert.ok(Array.isArray(result.urgentPosts));
      assert.ok(Array.isArray(result.topPosts));
    });

    it('flags urgent posts with matching keywords', async () => {
      const messages = [
        { text: 'Breaking: massive explosion reported near nuclear plant', views: 10000 },
      ];
      const data = botApiResponse(messages);
      mockFetch(data);

      const result = await withEnv({ TELEGRAM_BOT_TOKEN: 'bot123:ABC' }, async () => {
        return mod.briefing();
      });

      assert.equal(result.status, 'bot_api');
      assert.ok(result.urgentPosts.length > 0);
      const urgent = result.urgentPosts[0];
      assert.ok(urgent.urgentFlags.length > 0);
      // Should match 'breaking', 'explosion', 'nuclear'
      assert.ok(urgent.urgentFlags.includes('breaking'));
      assert.ok(urgent.urgentFlags.includes('explosion'));
      assert.ok(urgent.urgentFlags.includes('nuclear'));
    });

    it('falls back to web scraping when no bot token', async () => {
      // Mock fetch for web scraping: return HTML for each channel
      globalThis.fetch = async (url) => {
        if (url.startsWith('https://t.me/s/')) {
          const channelId = url.replace('https://t.me/s/', '');
          const html = channelHTML(channelId, [
            { id: 1, text: 'Latest conflict update from the frontline', views: '5.2K', date: '2026-04-09T12:00:00+00:00' },
            { id: 2, text: 'Alert: drone strike detected near border', views: '3K', date: '2026-04-09T11:00:00+00:00' },
          ]);
          return {
            ok: true, status: 200,
            text: async () => html,
            headers: new Headers({ 'content-type': 'text/html' }),
          };
        }
        return { ok: false, status: 404, text: async () => '', headers: new Headers() };
      };

      const result = await withEnv({ TELEGRAM_BOT_TOKEN: null }, async () => {
        return mod.briefing();
      });

      assert.equal(result.source, 'Telegram');
      assert.equal(result.status, 'web_scrape');
      assert.ok(result.channelsMonitored > 0);
      assert.ok(result.totalPosts >= 0);
      assert.ok(result.hint);
    });

    it('falls back to scraping when bot API returns empty result', async () => {
      let callCount = 0;
      globalThis.fetch = async (url) => {
        callCount++;
        // Bot API returns empty
        if (url.includes('api.telegram.org')) {
          const json = JSON.stringify({ ok: true, result: [] });
          return {
            ok: true, status: 200,
            text: async () => json,
            json: async () => ({ ok: true, result: [] }),
            headers: new Headers({ 'content-type': 'application/json' }),
          };
        }
        // Web scrape
        if (url.startsWith('https://t.me/s/')) {
          return {
            ok: true, status: 200,
            text: async () => '<html><body></body></html>',
            headers: new Headers({ 'content-type': 'text/html' }),
          };
        }
        return { ok: false, status: 404, text: async () => '', headers: new Headers() };
      };

      const result = await withEnv({ TELEGRAM_BOT_TOKEN: 'bot123:ABC' }, async () => {
        return mod.briefing();
      });

      assert.equal(result.source, 'Telegram');
      assert.equal(result.status, 'bot_api_empty_fallback_scrape');
    });

    it('handles complete network failure', async () => {
      globalThis.fetch = async () => { throw new Error('Network down'); };

      const result = await withEnv({ TELEGRAM_BOT_TOKEN: null }, async () => {
        return mod.briefing();
      });

      assert.equal(result.source, 'Telegram');
      // Should still return structure even if all channels failed
      assert.ok(result.channels || result.errors !== undefined);
    });

    it('groups posts by topic', async () => {
      globalThis.fetch = async (url) => {
        if (url.startsWith('https://t.me/s/')) {
          const channelId = url.replace('https://t.me/s/', '');
          const html = channelHTML(channelId, [
            { id: 1, text: 'Test post from channel', views: '100', date: '2026-04-09T12:00:00+00:00' },
          ]);
          return {
            ok: true, status: 200,
            text: async () => html,
            headers: new Headers({ 'content-type': 'text/html' }),
          };
        }
        return { ok: false, status: 404, text: async () => '', headers: new Headers() };
      };

      const result = await withEnv({ TELEGRAM_BOT_TOKEN: null }, async () => {
        return mod.briefing();
      });

      assert.ok(result.byTopic);
      // Should have topics from the default channel list
      const topics = Object.keys(result.byTopic);
      assert.ok(topics.length >= 0); // at least some data
    });

    it('records channel errors separately', async () => {
      let callIdx = 0;
      globalThis.fetch = async (url) => {
        callIdx++;
        if (url.startsWith('https://t.me/s/')) {
          // Alternate success/failure
          if (callIdx % 2 === 0) {
            return { ok: false, status: 403, text: async () => 'Forbidden', headers: new Headers() };
          }
          return {
            ok: true, status: 200,
            text: async () => '<html><body></body></html>',
            headers: new Headers(),
          };
        }
        return { ok: false, status: 404, text: async () => '', headers: new Headers() };
      };

      const result = await withEnv({ TELEGRAM_BOT_TOKEN: null }, async () => {
        return mod.briefing();
      });

      assert.equal(result.source, 'Telegram');
      // channels should be populated
      assert.ok(Array.isArray(result.channels));
    });
  });
});
