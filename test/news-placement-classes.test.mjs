import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNewsClusters } from '../dashboard/inject.mjs';

test('buildNewsClusters marks source-native placements explicitly', async () => {
  const news = [{
    title: 'Custom feed reports incident near exact coordinates',
    source: 'Operator Feed',
    date: '2026-04-24T18:00:00Z',
    url: 'https://example.com/native',
    lat: 35.1,
    lon: 51.4,
    region: 'Tehran',
    placementPrecision: 'source-native',
    placementBasis: 'source-native',
    placementClass: 'source-native',
  }];

  const { clusters } = await buildNewsClusters(news, null, { mode: 'off' });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].placementClass, 'source-native');
  assert.equal(clusters[0].placementPrecision, 'source-native');
  assert.ok(clusters[0].qualityFlags.includes('source-native-placement'));
  assert.equal(clusters[0].sourceProvenance.totalItems, 1);
  assert.equal(clusters[0].sourceProvenance.topSources[0].source, 'Operator Feed');
  assert.equal(clusters[0].sourceProvenance.topSources[0].runtimeSource, 'GDELT');
});

test('buildNewsClusters marks keyword geocoding as inferred precision', async () => {
  const news = [{
    title: 'Somalia conflict displaces thousands after new fighting',
    source: 'Test Wire',
    date: '2026-04-24T18:05:00Z',
    url: 'https://example.com/somalia',
    lat: 5,
    lon: 46,
    region: 'Somalia',
    placementPrecision: 'country',
    placementBasis: 'keyword',
    placementClass: 'inferred-country',
  }];

  const { clusters } = await buildNewsClusters(news, null, { mode: 'off' });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].placementClass, 'inferred-country');
  assert.equal(clusters[0].placementBasis, 'keyword');
});

test('buildNewsClusters preserves source-fallback class when clustered items were already tagged as source fallbacks', async () => {
  const news = [{
    title: 'Abidjan youth wage war on trash',
    source: 'Africa News',
    date: '2026-04-24T18:10:00Z',
    url: 'https://example.com/abidjan',
    lat: 9.082,
    lon: 8.6753,
    region: 'Africa',
    placementPrecision: 'source-fallback',
    placementBasis: 'source',
    placementClass: 'source-fallback',
  }];

  const llmProvider = {
    async generateObject() {
      return [{
        idx: 0,
        storyKey: 'abidjan_trash_story',
        subject: 'Abidjan trash campaign',
        primaryRegion: 'Africa',
        confidence: 'high',
      }];
    }
  };

  const { clusters } = await buildNewsClusters(news, llmProvider, { mode: 'always' });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].placementClass, 'source-fallback');
  assert.ok(clusters[0].qualityFlags.includes('source-fallback-placement'));
});

test('buildNewsClusters keeps urgent Telegram incidents eligible for mapped clustering', async () => {
  const news = [{
    title: 'Secret Service confirms shooting near White House complex during correspondents dinner lockdown',
    source: 'OSINT ALERTS',
    type: 'telegram',
    date: '2026-04-28T18:20:00Z',
    url: null,
    lat: 38.9,
    lon: -77,
    region: 'White House',
    placementPrecision: 'subregion',
    placementBasis: 'telegram-urgent',
    placementClass: 'inferred-subregion',
  }];

  const { clusters } = await buildNewsClusters(news, null, { mode: 'off' });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].placementBasis, 'telegram-urgent');
  assert.equal(clusters[0].placementClass, 'inferred-subregion');
  assert.equal(clusters[0].sourceProvenance.topSources[0].runtimeSource, 'Telegram');
});

test('buildNewsClusters prefers exact Telegram coordinates over generic regional aliases', async () => {
  const news = [{
    title: 'White House lockdown after Secret Service response in Washington',
    source: 'FIELD SIGNAL',
    type: 'telegram',
    date: '2026-04-28T18:25:00Z',
    url: null,
    lat: 38.9,
    lon: -77,
    region: 'United States',
    placementPrecision: 'subregion',
    placementBasis: 'telegram-urgent',
    placementClass: 'inferred-subregion',
  }];

  const { clusters } = await buildNewsClusters(news, null, { mode: 'off' });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].region, 'United States');
  assert.ok(Math.abs(clusters[0].lat - 38.9) < 3);
  assert.ok(Math.abs(clusters[0].lon + 77) < 3);
});

test('buildNewsClusters merges urgent Telegram map candidates with matching RSS corroboration in-region', async () => {
  const news = [
    {
      title: 'Secret Service confirms shooting near White House complex during correspondents dinner lockdown',
      source: 'OSINT ALERTS',
      type: 'telegram',
      date: '2026-04-28T18:20:00Z',
      url: null,
      lat: 38.9,
      lon: -77,
      region: 'White House',
      placementPrecision: 'subregion',
      placementBasis: 'telegram-urgent',
      placementClass: 'inferred-subregion',
    },
    {
      title: 'White House shooting prompts Secret Service lockdown during correspondents dinner',
      source: 'Reuters',
      type: 'rss',
      date: '2026-04-28T18:24:00Z',
      url: 'https://example.com/reuters/white-house',
      lat: 38.89,
      lon: -77.03,
      region: 'White House',
      placementPrecision: 'source-native',
      placementBasis: 'source-native',
      placementClass: 'source-native',
    },
  ];

  const { clusters, qualitySummary } = await buildNewsClusters(news, null, { mode: 'off' });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].storyCount, 2);
  assert.equal(clusters[0].sourceCount, 2);
  assert.equal(clusters[0].placementBasis, 'telegram-urgent');
  assert.equal(clusters[0].sourceProvenance.topSources.some(item => item.runtimeSource === 'Telegram'), true);
  assert.equal(clusters[0].sourceProvenance.topSources.some(item => item.runtimeSource === 'GDELT'), true);
  assert.equal(qualitySummary.reviewMetrics.suspiciousNearDuplicateCount, 0);
});
