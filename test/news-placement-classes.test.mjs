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
