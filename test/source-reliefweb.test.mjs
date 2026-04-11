import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

// The module uses raw fetch (not safeFetch) for rwPost, and safeFetch for hdxFallback
import { searchReports, getDisasters, briefing } from '../apis/sources/reliefweb.mjs';

describe('reliefweb', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('searchReports', () => {
    it('returns reports on success', async () => {
      mockFetch({
        data: [
          {
            fields: {
              title: 'Earthquake in Turkey',
              date: { created: '2026-01-15T00:00:00Z' },
              country: [{ name: 'Turkey' }],
              disaster_type: [{ name: 'Earthquake' }],
              url_alias: '/report/earthquake-turkey',
              source: [{ name: 'OCHA' }],
            },
          },
        ],
      });

      const result = await searchReports({ query: 'earthquake', limit: 5 });
      assert.ok(result.data);
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].fields.title, 'Earthquake in Turkey');
    });

    it('returns error object on network failure', async () => {
      mockFetchError('Connection refused');
      const result = await searchReports();
      assert.ok(result.error);
      assert.ok(result.error.includes('Connection refused'));
    });

    it('returns error on HTTP error status', async () => {
      const fn = mockFetch('', { status: 403 });
      // Override text() to return a string for the error body
      globalThis.fetch = async (...args) => {
        return {
          ok: false,
          status: 403,
          text: () => Promise.resolve('Forbidden'),
          json: () => Promise.resolve({}),
        };
      };
      const result = await searchReports();
      assert.ok(result.error);
      assert.ok(result.error.includes('403'));
    });
  });

  describe('getDisasters', () => {
    it('returns ongoing disasters', async () => {
      mockFetch({
        data: [
          {
            fields: {
              name: 'Syria Crisis',
              date: { created: '2026-02-01T00:00:00Z' },
              country: [{ name: 'Syria' }],
              type: [{ name: 'Complex Emergency' }],
              status: 'ongoing',
            },
          },
        ],
      });

      const result = await getDisasters({ limit: 5 });
      assert.ok(result.data);
      assert.equal(result.data[0].fields.name, 'Syria Crisis');
    });
  });

  describe('briefing', () => {
    it('returns ReliefWeb data when API succeeds', async () => {
      // briefing calls searchReports + getDisasters in parallel (both use fetch POST)
      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [
              {
                fields: {
                  title: 'Flood Report',
                  date: { created: '2026-03-01T00:00:00Z' },
                  country: [{ name: 'Bangladesh' }],
                  disaster_type: [{ name: 'Flood' }],
                  url_alias: '/report/flood-bangladesh',
                  source: [{ name: 'IFRC' }],
                  name: 'Bangladesh Floods 2026',
                  type: [{ name: 'Flood' }],
                  status: 'ongoing',
                },
              },
            ],
          }),
          text: () => Promise.resolve(''),
        };
      };

      const result = await briefing();
      assert.equal(result.source, 'ReliefWeb (UN OCHA)');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.latestReports));
      assert.ok(Array.isArray(result.activeDisasters));
    });

    it('falls back to HDX when ReliefWeb fails', async () => {
      // First two calls (rwPost) fail, third call (safeFetch for HDX) succeeds
      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        if (callCount <= 2) {
          // ReliefWeb POST calls fail
          return {
            ok: false,
            status: 403,
            text: () => Promise.resolve('Forbidden'),
            json: () => Promise.resolve({}),
          };
        }
        // HDX fallback call (via safeFetch)
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            result: {
              results: [
                {
                  title: 'Crisis Dataset',
                  metadata_modified: '2026-03-01',
                  dataset_source: 'UNHCR',
                  groups: [{ display_name: 'Somalia' }],
                  name: 'crisis-dataset-somalia',
                },
              ],
            },
          })),
          json: () => Promise.resolve({
            result: {
              results: [
                {
                  title: 'Crisis Dataset',
                  metadata_modified: '2026-03-01',
                  dataset_source: 'UNHCR',
                  groups: [{ display_name: 'Somalia' }],
                  name: 'crisis-dataset-somalia',
                },
              ],
            },
          }),
        };
      };

      const result = await briefing();
      assert.ok(result.source.includes('HDX'));
      assert.ok(result.rwError);
      assert.ok(result.rwNote);
      assert.ok(Array.isArray(result.hdxDatasets));
      assert.equal(result.hdxDatasets.length, 1);
      assert.equal(result.hdxDatasets[0].title, 'Crisis Dataset');
      assert.ok(result.hdxDatasets[0].url.includes('crisis-dataset-somalia'));
    });

    it('returns empty arrays when ReliefWeb succeeds but has no data', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
        text: () => Promise.resolve(''),
      });

      const result = await briefing();
      assert.equal(result.source, 'ReliefWeb (UN OCHA)');
      assert.deepStrictEqual(result.latestReports, []);
      assert.deepStrictEqual(result.activeDisasters, []);
    });
  });
});
