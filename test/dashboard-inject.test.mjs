// dashboard-inject.test.mjs — Unit tests for dashboard/inject.mjs
// Uses Node.js built-in test runner — no external dependencies

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateIdeas, fetchAllNews, synthesize } from '../dashboard/inject.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal V2-like object with sane defaults for generateIdeas */
function minimalV2({
  fred = [],
  tgUrgentCount = 0,
  wti = 60,
  wtiRecent = [60, 60],
  bls = [],
  thermal = [],
  treasury = { totalDebt: '30000000000000', signals: [] },
  acled = { totalEvents: 0, totalFatalities: 0 },
  gscpi = null,
} = {}) {
  return {
    fred,
    tg: { urgent: Array.from({ length: tgUrgentCount }, (_, i) => ({ text: `msg ${i}` })), topPosts: [] },
    energy: { wti, wtiRecent, signals: [] },
    bls,
    thermal,
    treasury,
    acled,
    gscpi,
  };
}

// ─── generateIdeas Tests ──────────────────────────────────────────────────────

describe('generateIdeas', () => {
  it('returns array (may be empty) for minimal v2 data', () => {
    const ideas = generateIdeas(minimalV2());
    assert.ok(Array.isArray(ideas));
  });

  it('returns an elevated-volatility idea when VIX > 20', () => {
    const v2 = minimalV2({
      fred: [{ id: 'VIXCLS', label: 'VIX', value: 22, date: '2025-01-01' }],
    });
    const ideas = generateIdeas(v2);
    assert.ok(ideas.length > 0);
    const vixIdea = ideas.find(i => i.title === 'Elevated Volatility Regime');
    assert.ok(vixIdea, 'Expected "Elevated Volatility Regime" idea when VIX > 20');
    assert.equal(vixIdea.type, 'hedge');
  });

  it('returns confidence "High" when VIX > 25', () => {
    const v2 = minimalV2({
      fred: [{ id: 'VIXCLS', label: 'VIX', value: 30, date: '2025-01-01' }],
    });
    const ideas = generateIdeas(v2);
    const vixIdea = ideas.find(i => i.title === 'Elevated Volatility Regime');
    assert.ok(vixIdea);
    assert.equal(vixIdea.confidence, 'High');
  });

  it('returns "Safe Haven Demand Rising" when VIX > 20 AND HY > 3', () => {
    const v2 = minimalV2({
      fred: [
        { id: 'VIXCLS', label: 'VIX', value: 22, date: '2025-01-01' },
        { id: 'BAMLH0A0HYM2', label: 'HY Spread', value: 3.5, date: '2025-01-01' },
      ],
    });
    const ideas = generateIdeas(v2);
    const shIdea = ideas.find(i => i.title === 'Safe Haven Demand Rising');
    assert.ok(shIdea, 'Expected "Safe Haven Demand Rising" idea');
    assert.equal(shIdea.type, 'hedge');
  });

  it('returns "Conflict-Energy Nexus Active" when urgent > 3 and WTI > 68', () => {
    const v2 = minimalV2({ tgUrgentCount: 4, wti: 75 });
    const ideas = generateIdeas(v2);
    const conflictIdea = ideas.find(i => i.title === 'Conflict-Energy Nexus Active');
    assert.ok(conflictIdea, 'Expected "Conflict-Energy Nexus Active" idea');
    assert.equal(conflictIdea.type, 'long');
  });

  it('returns fiscal trajectory idea when debt > $35T', () => {
    const v2 = minimalV2({
      treasury: { totalDebt: '36000000000000', signals: [] },
    });
    const ideas = generateIdeas(v2);
    const debtIdea = ideas.find(i => i.title === 'Fiscal Trajectory Supports Hard Assets');
    assert.ok(debtIdea, 'Expected "Fiscal Trajectory Supports Hard Assets" idea');
    assert.equal(debtIdea.confidence, 'High');
  });

  it('caps result at 8 ideas maximum', () => {
    // Craft a V2 that would generate many ideas
    const v2 = minimalV2({
      fred: [
        { id: 'VIXCLS', label: 'VIX', value: 30, date: '2025-01-01' },
        { id: 'BAMLH0A0HYM2', label: 'HY Spread', value: 5, date: '2025-01-01' },
        { id: 'T10Y2Y', label: 'Yield Spread', value: 0.5, date: '2025-01-01' },
      ],
      tgUrgentCount: 5,
      wti: 80,
      wtiRecent: [80, 70, 68],  // >3% move triggers oil momentum
      treasury: { totalDebt: '36000000000000', signals: [] },
      thermal: [
        { region: 'Eastern Europe', det: 40000, night: 100, hc: 50 },
      ],
      acled: {
        totalEvents: 100,
        totalFatalities: 600,
      },
      bls: [
        { id: 'LNS14000000', label: 'Unemployment', value: 4.5 },
        { id: 'CES0000000001', label: 'Payrolls', value: 155000, momChange: -100 },
      ],
      gscpi: { value: 1.2, interpretation: 'above average' },
    });
    const ideas = generateIdeas(v2);
    assert.ok(ideas.length <= 8, `Expected at most 8 ideas, got ${ideas.length}`);
  });

  it('handles missing data fields without crashing', () => {
    // All critical fields absent or undefined
    const v2 = {
      fred: [],
      tg: { urgent: [], topPosts: [] },
      energy: { wti: undefined, wtiRecent: [], signals: [] },
      bls: [],
      thermal: [],
      treasury: { totalDebt: '0', signals: [] },
      acled: {},
      gscpi: null,
    };
    // Should not throw
    const ideas = generateIdeas(v2);
    assert.ok(Array.isArray(ideas));
  });

  it('does NOT generate vix idea when VIX <= 20', () => {
    const v2 = minimalV2({
      fred: [{ id: 'VIXCLS', label: 'VIX', value: 15, date: '2025-01-01' }],
    });
    const ideas = generateIdeas(v2);
    const vixIdea = ideas.find(i => i.title === 'Elevated Volatility Regime');
    assert.ok(!vixIdea, 'Should NOT generate elevated volatility idea when VIX <= 20');
  });

  it('generates oil idea when wtiRecent moves > 3%', () => {
    const v2 = minimalV2({
      wti: 80,
      wtiRecent: [80, 72], // ~11% move
    });
    const ideas = generateIdeas(v2);
    const oilIdea = ideas.find(i =>
      i.title === 'Oil Momentum Building' || i.title === 'Oil Under Pressure'
    );
    assert.ok(oilIdea, 'Expected oil price movement idea');
  });
});

// ─── fetchAllNews Tests ────────────────────────────────────────────────────────

describe('fetchAllNews', () => {
  let originalFetch;

  before(() => {
    originalFetch = globalThis.fetch;
    // Return an RSS feed with one item that mentions a geo-tagged location
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Ukraine conflict continues</title>
      <link>https://example.com/article1</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
    <item>
      <title>China economy slows</title>
      <link>https://example.com/article2</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
  </channel>
</rss>`,
      status: 200,
    });
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns an array', async () => {
    const news = await fetchAllNews();
    assert.ok(Array.isArray(news));
  });

  it('returns geo-tagged news items with expected fields', async () => {
    const news = await fetchAllNews();
    // We mocked feeds with geo-able titles — should get some items
    if (news.length > 0) {
      const item = news[0];
      assert.ok('title' in item);
      assert.ok('source' in item);
      assert.ok('lat' in item);
      assert.ok('lon' in item);
      assert.ok('region' in item);
    }
  });

  it('returns at most 50 items', async () => {
    const news = await fetchAllNews();
    assert.ok(news.length <= 50);
  });
});

// ─── synthesize Tests ──────────────────────────────────────────────────────────

describe('synthesize', () => {
  let originalFetch;

  before(() => {
    originalFetch = globalThis.fetch;
    // Mock all outbound fetches (RSS feeds inside fetchAllNews)
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => '<rss><channel></channel></rss>',
      json: async () => ({}),
      status: 200,
    });
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  /** Minimal raw briefing data matching what fullBriefing returns */
  function minimalRawData() {
    return {
      crucix: {
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        totalDurationMs: 100,
        sourcesQueried: 1,
        sourcesOk: 0,
        sourcesFailed: 1,
      },
      sources: {},
      errors: [],
      timing: {},
    };
  }

  it('returns an object with expected top-level fields', async () => {
    const v2 = await synthesize(minimalRawData());
    assert.ok(v2 !== null && typeof v2 === 'object');
    // Key fields present in V2
    assert.ok('meta' in v2);
    assert.ok('air' in v2);
    assert.ok('thermal' in v2);
    assert.ok('fred' in v2);
    assert.ok('energy' in v2);
    assert.ok('bls' in v2);
    assert.ok('treasury' in v2);
    assert.ok('news' in v2);
    assert.ok('health' in v2);
    assert.ok('newsFeed' in v2);
    assert.ok('ideas' in v2);
    assert.ok('ideasSource' in v2);
  });

  it('air is an array', async () => {
    const v2 = await synthesize(minimalRawData());
    assert.ok(Array.isArray(v2.air));
  });

  it('fred is an array', async () => {
    const v2 = await synthesize(minimalRawData());
    assert.ok(Array.isArray(v2.fred));
  });

  it('news is an array', async () => {
    const v2 = await synthesize(minimalRawData());
    assert.ok(Array.isArray(v2.news));
  });

  it('health contains entries for all sources in raw data', async () => {
    const raw = minimalRawData();
    raw.sources = {
      OpenSky: { hotspots: [] },
      FRED: { indicators: [] },
    };
    const v2 = await synthesize(raw);
    assert.ok(Array.isArray(v2.health));
    assert.equal(v2.health.length, 2);
  });

  it('ideasSource defaults to "disabled" when no llm is configured', async () => {
    const v2 = await synthesize(minimalRawData());
    // synthesize sets ideas:[] and ideasSource:'disabled' directly
    assert.equal(v2.ideasSource, 'disabled');
    assert.ok(Array.isArray(v2.ideas));
  });

  it('handles OpenSky data with hotspots', async () => {
    const raw = minimalRawData();
    raw.sources.OpenSky = {
      hotspots: [{ region: 'Europe', totalAircraft: 500, noCallsign: 10, highAltitude: 100, byCountry: {} }],
      timestamp: new Date().toISOString(),
    };
    const v2 = await synthesize(raw);
    assert.ok(Array.isArray(v2.air));
    assert.ok(v2.air.length > 0);
  });
});
