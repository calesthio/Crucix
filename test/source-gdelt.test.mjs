import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

import { searchEvents, toneTrend, volumeTrend, geoEvents, briefing } from '../apis/sources/gdelt.mjs';

before(() => saveFetch());
after(() => restoreFetch());

const sampleArticle = {
  title: 'Military conflict in eastern region escalates',
  url: 'https://example.com/article1',
  seendate: '20260410T120000Z',
  domain: 'example.com',
  language: 'English',
  sourcecountry: 'United States',
};

describe('gdelt - searchEvents', () => {
  it('returns articles on success', async () => {
    mockFetch({ articles: [sampleArticle] });
    const result = await searchEvents('military conflict');
    assert.ok(result.articles);
    assert.equal(result.articles.length, 1);
    assert.equal(result.articles[0].title, sampleArticle.title);
  });

  it('uses default query when empty', async () => {
    const fn = mockFetch({ articles: [] });
    await searchEvents('');
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('conflict+OR+crisis'));
  });

  it('passes all options as URL params', async () => {
    const fn = mockFetch({ articles: [] });
    await searchEvents('test', { mode: 'TimelineVol', maxRecords: 50, timespan: '7d', sortBy: 'ToneDesc' });
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('mode=TimelineVol'));
    assert.ok(url.includes('maxrecords=50'));
    assert.ok(url.includes('timespan=7d'));
    assert.ok(url.includes('sort=ToneDesc'));
  });

  it('handles API error', async () => {
    mockFetchError('GDELT down');
    const result = await searchEvents('test');
    assert.ok(result.error);
  });
});

describe('gdelt - toneTrend', () => {
  it('requests TimelineTone mode', async () => {
    const fn = mockFetch({ timeline: [] });
    await toneTrend('economy', '7d');
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('mode=TimelineTone'));
    assert.ok(url.includes('timespan=7d'));
  });
});

describe('gdelt - volumeTrend', () => {
  it('requests TimelineVol mode', async () => {
    const fn = mockFetch({ timeline: [] });
    await volumeTrend('war', '3m');
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('mode=TimelineVol'));
    assert.ok(url.includes('timespan=3m'));
  });
});

describe('gdelt - geoEvents', () => {
  it('requests GeoJSON format', async () => {
    const fn = mockFetch({ type: 'FeatureCollection', features: [] });
    await geoEvents('protest');
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('format=GeoJSON'));
    assert.ok(url.includes('mode=PointData'));
  });

  it('uses default query when empty', async () => {
    const fn = mockFetch({ features: [] });
    await geoEvents('');
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('conflict+OR+military'));
  });
});

describe('gdelt - briefing', () => {
  it('returns categorized articles and geo points', async () => {
    const articles = [
      { ...sampleArticle, title: 'Military strikes reported' },
      { ...sampleArticle, title: 'Economy in recession fears' },
      { ...sampleArticle, title: 'Health crisis outbreak detected' },
      { ...sampleArticle, title: 'Refugee crisis deepens' },
    ];

    const geoFeature = {
      geometry: { type: 'Point', coordinates: [35.0, 48.0] },
      properties: { name: 'Conflict Zone', count: 5, type: 'event' },
    };

    let callNum = 0;
    globalThis.fetch = async (url) => {
      callNum++;
      // First call is searchEvents, second is geoEvents
      const body = url.includes('/geo/')
        ? { type: 'FeatureCollection', features: [geoFeature] }
        : { articles };
      return {
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body),
      };
    };

    const result = await briefing();
    assert.equal(result.source, 'GDELT');
    assert.ok(result.timestamp);
    assert.equal(result.totalArticles, 4);
    assert.equal(result.allArticles.length, 4);

    // Categorization
    assert.ok(result.conflicts.length > 0); // "Military strikes"
    assert.ok(result.economy.length > 0);   // "Economy in recession"
    assert.ok(result.health.length > 0);    // "Health crisis outbreak"
    assert.ok(result.crisis.length > 0);    // "Refugee crisis"

    // Geo points
    assert.ok(result.geoPoints.length > 0);
    assert.equal(result.geoPoints[0].lat, 48.0);
    assert.equal(result.geoPoints[0].lon, 35.0);
    assert.equal(result.geoPoints[0].name, 'Conflict Zone');
  });

  it('handles empty articles', async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ articles: [] })),
      json: () => Promise.resolve({ articles: [] }),
    });

    const result = await briefing();
    assert.equal(result.totalArticles, 0);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.economy, []);
  });

  it('handles geo endpoint failure gracefully', async () => {
    let callNum = 0;
    globalThis.fetch = async (url) => {
      callNum++;
      if (url.includes('/geo/')) {
        throw new Error('Geo unavailable');
      }
      const body = { articles: [sampleArticle] };
      return {
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body),
      };
    };

    const result = await briefing();
    assert.equal(result.source, 'GDELT');
    assert.deepEqual(result.geoPoints, []);
    assert.equal(result.totalArticles, 1);
  });
});
