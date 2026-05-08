import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSourceHealth } from '../lib/source-health.mjs';
import { buildEvidenceSummary } from '../lib/evidence-summary.mjs';
import { getFreshnessPolicy } from '../lib/freshness-policy.mjs';

test('source health exposes effective freshness policy metadata', () => {
  const now = '2026-04-24T18:40:00.000Z';
  const sweep = {
    crucix: { timestamp: now },
    sources: {
      OpenSky: { timestamp: '2026-04-24T18:10:00.000Z' },
      YFinance: { timestamp: '2026-04-24T18:30:00.000Z' },
    },
  };

  const { entries, summary, policy } = buildSourceHealth(sweep);
  const openSky = entries.find(entry => entry.name === 'OpenSky');

  assert.equal(openSky.freshnessTargetMinutes, getFreshnessPolicy().sources.OpenSky.freshnessTargetMinutes);
  assert.equal(summary.policy.defaultFreshnessMinutes, getFreshnessPolicy().defaultFreshnessMinutes);
  assert.equal(summary.policy.sources.OpenSky.freshnessTargetMinutes, getFreshnessPolicy().sources.OpenSky.freshnessTargetMinutes);
  assert.equal(policy.sources.YFinance.freshnessTargetMinutes, getFreshnessPolicy().sources.YFinance.freshnessTargetMinutes);
});

test('evidence summary uses shared area freshness policy metadata', () => {
  const summary = buildEvidenceSummary({
    nowTs: '2026-04-24T18:40:00.000Z',
    airMeta: { timestamp: '2026-04-24T18:20:00.000Z', source: 'OpenSky' },
    markets: { timestamp: '2026-04-24T18:25:00.000Z' },
    tg: { topPosts: [{ date: '2026-04-24T18:15:00.000Z' }] },
    news: [{ date: '2026-04-24T17:00:00.000Z' }],
    healthSummary: { failed: 1 },
    openSkyHealth: null,
  });

  assert.deepEqual(Object.keys(summary.policy), ['air', 'markets', 'telegram', 'news']);
  assert.equal(summary.sources.find(source => source.area === 'air').freshness, 'fresh');
  assert.equal(summary.sources.find(source => source.area === 'markets').freshness, 'fresh');
  assert.equal(summary.sources.find(source => source.area === 'news').freshness, 'fresh');
});
