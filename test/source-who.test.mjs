// WHO source — unit tests

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

describe('WHO source', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('getIndicator', () => {
    it('should call the GHO API with correct params', async () => {
      let capturedUrl;
      mockFetch({ value: [] });
      const origFetch = globalThis.fetch;
      globalThis.fetch = (url, opts) => { capturedUrl = url; return origFetch(url, opts); };

      const { getIndicator } = await import('../apis/sources/who.mjs');
      await getIndicator('MDG_0000000020', { top: 10 });

      assert.ok(capturedUrl.includes('ghoapi.azureedge.net/api/MDG_0000000020'));
      assert.ok(capturedUrl.includes('$top=10'));
    });
  });

  describe('getOutbreakNews', () => {
    it('should return parsed outbreak news sorted by date', async () => {
      const now = new Date();
      const recent = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
      const older = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();

      const apiResponse = {
        value: [
          {
            Title: 'Older outbreak',
            PublicationDate: older,
            DonId: 'DON-002',
            ItemDefaultUrl: '/item-2',
            Summary: 'Summary of older outbreak',
          },
          {
            Title: 'Recent outbreak',
            PublicationDate: recent,
            DonId: 'DON-001',
            ItemDefaultUrl: '/item-1',
            Summary: '<p>Summary with <b>HTML</b> tags</p>',
          },
        ],
      };

      // getOutbreakNews uses raw fetch, not safeFetch
      mockFetch(apiResponse);

      const { getOutbreakNews } = await import('../apis/sources/who.mjs');
      const result = await getOutbreakNews();

      assert.ok(Array.isArray(result));
      assert.equal(result.length, 2);
      // Should be sorted by date descending (recent first)
      assert.equal(result[0].title, 'Recent outbreak');
      assert.equal(result[1].title, 'Older outbreak');
    });

    it('should strip HTML tags from summaries', async () => {
      const now = new Date();
      const recent = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

      mockFetch({
        value: [
          {
            Title: 'Test',
            PublicationDate: recent,
            Summary: '<p>This is a <strong>bold</strong> summary</p>',
          },
        ],
      });

      const { getOutbreakNews } = await import('../apis/sources/who.mjs');
      const result = await getOutbreakNews();

      assert.ok(!result[0].summary.includes('<'));
      assert.ok(result[0].summary.includes('bold'));
    });

    it('should filter to last 30 days only', async () => {
      const now = new Date();
      const recent = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
      const old = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();

      mockFetch({
        value: [
          { Title: 'Recent', PublicationDate: recent, Summary: '' },
          { Title: 'Old', PublicationDate: old, Summary: '' },
        ],
      });

      const { getOutbreakNews } = await import('../apis/sources/who.mjs');
      const result = await getOutbreakNews();

      assert.equal(result.length, 1);
      assert.equal(result[0].title, 'Recent');
    });

    it('should return error object on fetch failure', async () => {
      mockFetchError('Network timeout');

      const { getOutbreakNews } = await import('../apis/sources/who.mjs');
      const result = await getOutbreakNews();

      assert.ok(result.error);
      assert.ok(result.error.includes('Network timeout'));
    });

    it('should handle empty value array', async () => {
      mockFetch({ value: [] });

      const { getOutbreakNews } = await import('../apis/sources/who.mjs');
      const result = await getOutbreakNews();

      assert.ok(Array.isArray(result));
      assert.equal(result.length, 0);
    });
  });

  describe('briefing', () => {
    it('should return structured briefing with outbreak news', async () => {
      const now = new Date();
      const recent = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();

      mockFetch({
        value: [
          {
            Title: 'Ebola outbreak in DRC',
            PublicationDate: recent,
            DonId: 'DON-100',
            ItemDefaultUrl: '/ebola-drc',
            Summary: 'Active Ebola transmission in eastern DRC',
          },
        ],
      });

      const { briefing } = await import('../apis/sources/who.mjs');
      const result = await briefing();

      assert.equal(result.source, 'WHO');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.diseaseOutbreakNews));
      assert.equal(result.diseaseOutbreakNews.length, 1);
      assert.equal(result.outbreakError, null);
      assert.ok(Array.isArray(result.monitoringCapabilities));
    });

    it('should report outbreak error when fetch fails', async () => {
      mockFetchError('API down');

      const { briefing } = await import('../apis/sources/who.mjs');
      const result = await briefing();

      assert.equal(result.source, 'WHO');
      assert.deepEqual(result.diseaseOutbreakNews, []);
      assert.ok(result.outbreakError);
    });

    it('should limit outbreak news to 15 items', async () => {
      const now = new Date();
      const items = Array.from({ length: 20 }, (_, i) => ({
        Title: `Outbreak ${i}`,
        PublicationDate: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
        Summary: `Summary ${i}`,
      }));

      mockFetch({ value: items });

      const { briefing } = await import('../apis/sources/who.mjs');
      const result = await briefing();

      assert.ok(result.diseaseOutbreakNews.length <= 15);
    });

    it('should construct correct DON URL', async () => {
      const now = new Date();
      const recent = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

      mockFetch({
        value: [
          {
            Title: 'Test',
            PublicationDate: recent,
            ItemDefaultUrl: '/some-path',
            Summary: '',
          },
        ],
      });

      const { getOutbreakNews } = await import('../apis/sources/who.mjs');
      const result = await getOutbreakNews();

      assert.ok(result[0].url.startsWith('https://www.who.int/emergencies/disease-outbreak-news'));
      assert.ok(result[0].url.includes('/some-path'));
    });
  });
});
