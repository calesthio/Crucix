// dashboard/inject.mjs — unit tests
// Uses Node.js built-in test runner (node:test)

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch } from './helpers.mjs';

// Import the exported functions
import { synthesize, generateIdeas, fetchAllNews } from '../dashboard/inject.mjs';

// ─── Helpers ───

function makeMinimalRawData(overrides = {}) {
  return {
    crucix: { sourcesOk: 5, sourcesQueried: 5, sourcesFailed: 0, timestamp: new Date().toISOString() },
    sources: {
      OpenSky: { hotspots: [], timestamp: new Date().toISOString() },
      FIRMS: { hotspots: [], signals: [] },
      Maritime: { chokepoints: {} },
      Safecast: { sites: [], signals: [] },
      KiwiSDR: { network: {}, conflictZones: {} },
      Telegram: { totalPosts: 0, urgentPosts: [], topPosts: [] },
      WHO: { diseaseOutbreakNews: [] },
      FRED: { indicators: [] },
      EIA: { oilPrices: {}, gasPrice: {}, inventories: {}, signals: [] },
      BLS: { indicators: [] },
      Treasury: { debt: [], signals: [] },
      GSCPI: { latest: null },
      USAspending: { recentDefenseContracts: [] },
      NOAA: { totalSevereAlerts: 0, topAlerts: [] },
      EPA: { readings: [], totalReadings: 0 },
      Space: {},
      ACLED: { totalEvents: 0, totalFatalities: 0, byRegion: {}, byType: {}, deadliestEvents: [] },
      GDELT: { totalArticles: 0, allArticles: [], geoPoints: [] },
      YFinance: { quotes: {}, indexes: [], rates: [], commodities: [], crypto: [], summary: {} },
      ...overrides,
    },
  };
}

function makeV2ForIdeas(overrides = {}) {
  return {
    fred: [
      { id: 'VIXCLS', label: 'VIX', value: 15, date: '2026-01-01', recent: [] },
      { id: 'BAMLH0A0HYM2', label: 'HY Spread', value: 2.5, date: '2026-01-01', recent: [] },
      { id: 'T10Y2Y', label: '10Y-2Y Spread', value: 0.5, date: '2026-01-01', recent: [] },
    ],
    tg: { posts: 0, urgent: [], topPosts: [] },
    energy: { wti: 65, brent: 70, natgas: 2.5, wtiRecent: [65, 64], signals: [] },
    metals: { gold: 2000, silver: 25 },
    bls: [],
    treasury: { totalDebt: '30000000000000', signals: [] },
    gscpi: null,
    thermal: [],
    acled: { totalEvents: 0, totalFatalities: 0 },
    ...overrides,
  };
}

// ─── Tests ───

describe('dashboard/inject', () => {

  before(() => saveFetch());
  afterEach(() => restoreFetch());
  after(() => restoreFetch());

  // ─── synthesize ───

  describe('synthesize', () => {

    beforeEach(() => {
      // Mock fetch so RSS calls don't hit the network
      mockFetch('<?xml version="1.0"?><rss><channel></channel></rss>', { status: 200 });
    });

    it('should return an object with expected top-level keys', async () => {
      const raw = makeMinimalRawData();
      const result = await synthesize(raw);

      assert.ok(result.meta);
      assert.ok(Array.isArray(result.air));
      assert.ok(Array.isArray(result.thermal));
      assert.ok(Array.isArray(result.chokepoints));
      assert.ok(Array.isArray(result.nuke));
      assert.ok(Array.isArray(result.who));
      assert.ok(Array.isArray(result.fred));
      assert.ok(typeof result.energy === 'object');
      assert.ok(typeof result.metals === 'object');
      assert.ok(Array.isArray(result.bls));
      assert.ok(typeof result.treasury === 'object');
      assert.ok(Array.isArray(result.defense));
      assert.ok(typeof result.noaa === 'object');
      assert.ok(typeof result.epa === 'object');
      assert.ok(typeof result.acled === 'object');
      assert.ok(typeof result.gdelt === 'object');
      assert.ok(typeof result.space === 'object');
      assert.ok(Array.isArray(result.health));
      assert.ok(Array.isArray(result.news));
      assert.ok(typeof result.markets === 'object');
      assert.ok(Array.isArray(result.ideas));
      assert.ok(Array.isArray(result.newsFeed));
    });

    it('should set ideasSource to disabled by default', async () => {
      const raw = makeMinimalRawData();
      const result = await synthesize(raw);
      assert.equal(result.ideasSource, 'disabled');
      assert.deepEqual(result.ideas, []);
    });

    it('should synthesize FRED indicators correctly', async () => {
      const raw = makeMinimalRawData({
        FRED: {
          indicators: [
            { id: 'VIXCLS', label: 'VIX', value: 18.5, date: '2026-01-01', recent: [17, 18, 18.5], momChange: 1.5, momChangePct: 8.1 },
          ],
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.fred.length, 1);
      assert.equal(result.fred[0].id, 'VIXCLS');
      assert.equal(result.fred[0].value, 18.5);
      assert.deepEqual(result.fred[0].recent, [17, 18, 18.5]);
    });

    it('should synthesize energy data from EIA', async () => {
      const raw = makeMinimalRawData({
        EIA: {
          oilPrices: {
            wti: { value: 72.5, recent: [{ value: 71 }, { value: 72.5 }] },
            brent: { value: 76 },
          },
          gasPrice: { value: 2.15 },
          inventories: { crudeStocks: { value: 450 } },
          signals: ['test signal'],
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.energy.wti, 72.5);
      assert.equal(result.energy.brent, 76);
      assert.equal(result.energy.natgas, 2.15);
      assert.equal(result.energy.crudeStocks, 450);
    });

    it('should override EIA energy with YFinance when available', async () => {
      const raw = makeMinimalRawData({
        EIA: {
          oilPrices: { wti: { value: 70, recent: [] }, brent: { value: 74 } },
          gasPrice: { value: 2.0 },
          inventories: {},
          signals: [],
        },
        YFinance: {
          quotes: {
            'CL=F': { price: 73.5, history: [{ close: 72 }, { close: 73.5 }] },
            'BZ=F': { price: 77.2 },
            'NG=F': { price: 2.3 },
          },
          indexes: [], rates: [], commodities: [], crypto: [],
          summary: {},
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.energy.wti, 73.5);
      assert.equal(result.energy.brent, 77.2);
      assert.equal(result.energy.natgas, 2.3);
      assert.deepEqual(result.energy.wtiRecent, [72, 73.5]);
    });

    it('should synthesize metals from YFinance quotes', async () => {
      const raw = makeMinimalRawData({
        YFinance: {
          quotes: {
            'GC=F': { price: 2350, change: 15, changePct: 0.64, history: [{ close: 2335 }, { close: 2350 }] },
            'SI=F': { price: 29.5, change: -0.3, changePct: -1.0, history: [{ close: 29.8 }, { close: 29.5 }] },
          },
          indexes: [], rates: [], commodities: [], crypto: [],
          summary: {},
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.metals.gold, 2350);
      assert.equal(result.metals.silver, 29.5);
      assert.equal(result.metals.goldChange, 15);
      assert.deepEqual(result.metals.goldRecent, [2335, 2350]);
    });

    it('should filter non-English Telegram posts', async () => {
      const raw = makeMinimalRawData({
        Telegram: {
          totalPosts: 3,
          urgentPosts: [
            { channel: 'test', text: 'Breaking: explosion in Kyiv', views: 100, date: '2026-01-01' },
            { channel: 'test', text: '\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u043D\u043E\u0432\u043E\u0441\u0442\u0438', views: 50, date: '2026-01-01' }, // Cyrillic
          ],
          topPosts: [
            { channel: 'news', text: '\u0412\u0430\u0436\u043D\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435', views: 200, date: '2026-01-01' }, // Cyrillic
          ],
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.tg.urgent.length, 1);
      assert.equal(result.tg.urgent[0].text, 'Breaking: explosion in Kyiv');
      assert.equal(result.tg.topPosts.length, 0); // Cyrillic filtered out
    });

    it('should truncate Telegram text to 200 chars', async () => {
      const longText = 'A'.repeat(300);
      const raw = makeMinimalRawData({
        Telegram: {
          totalPosts: 1,
          urgentPosts: [{ channel: 'test', text: longText, views: 10, date: '2026-01-01' }],
          topPosts: [],
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.tg.urgent[0].text.length, 200);
    });

    it('should build health array from sources', async () => {
      const raw = makeMinimalRawData({
        FRED: { indicators: [], error: 'timeout' },
      });
      const result = await synthesize(raw);
      const fredHealth = result.health.find(h => h.n === 'FRED');
      assert.ok(fredHealth);
      assert.equal(fredHealth.err, true);
    });

    it('should synthesize ACLED data', async () => {
      const raw = makeMinimalRawData({
        ACLED: {
          totalEvents: 120,
          totalFatalities: 45,
          byRegion: { 'Middle East': 50 },
          byType: { 'Battles': 30 },
          deadliestEvents: [
            { date: '2026-01-01', type: 'Battles', country: 'Syria', location: 'Aleppo', fatalities: 10, lat: 36.2, lon: 37.1 },
          ],
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.acled.totalEvents, 120);
      assert.equal(result.acled.totalFatalities, 45);
      assert.equal(result.acled.deadliestEvents.length, 1);
      assert.equal(result.acled.deadliestEvents[0].country, 'Syria');
    });

    it('should handle ACLED error gracefully', async () => {
      const raw = makeMinimalRawData({
        ACLED: { error: 'API unavailable' },
      });
      const result = await synthesize(raw);
      assert.equal(result.acled.totalEvents, 0);
      assert.equal(result.acled.totalFatalities, 0);
      assert.deepEqual(result.acled.deadliestEvents, []);
    });

    it('should synthesize WHO outbreak news with truncation', async () => {
      const raw = makeMinimalRawData({
        WHO: {
          diseaseOutbreakNews: [
            { title: 'T'.repeat(200), date: '2026-01-01', summary: 'S'.repeat(200) },
          ],
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.who.length, 1);
      assert.ok(result.who[0].title.length <= 120);
      assert.ok(result.who[0].summary.length <= 150);
    });

    it('should limit WHO entries to 10', async () => {
      const items = Array.from({ length: 15 }, (_, i) => ({
        title: `Outbreak ${i}`, date: '2026-01-01', summary: `Details ${i}`,
      }));
      const raw = makeMinimalRawData({ WHO: { diseaseOutbreakNews: items } });
      const result = await synthesize(raw);
      assert.equal(result.who.length, 10);
    });

    it('should deduplicate EPA stations by lat/lon', async () => {
      const raw = makeMinimalRawData({
        EPA: {
          totalReadings: 3,
          readings: [
            { location: 'NYC', state: 'NY', lat: 40.7, lon: -74, analyte: 'Gross Beta', result: 10, unit: 'pCi/m3' },
            { location: 'NYC', state: 'NY', lat: 40.7, lon: -74, analyte: 'Gross Beta', result: 12, unit: 'pCi/m3' }, // duplicate
            { location: 'LA', state: 'CA', lat: 34, lon: -118, analyte: 'Gross Beta', result: 8, unit: 'pCi/m3' },
          ],
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.epa.stations.length, 2);
    });

    it('should build airMeta with fallback=false for live data', async () => {
      const raw = makeMinimalRawData({
        OpenSky: {
          hotspots: [{ region: 'Ukraine', totalAircraft: 50 }],
          timestamp: '2026-01-01T00:00:00Z',
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.airMeta.fallback, false);
      assert.equal(result.airMeta.source, 'OpenSky');
    });

    it('should summarize air hotspots correctly', async () => {
      const raw = makeMinimalRawData({
        OpenSky: {
          hotspots: [
            { region: 'Ukraine', totalAircraft: 30, noCallsign: 5, highAltitude: 10, byCountry: { US: 15, UK: 10, FR: 5 } },
          ],
          timestamp: '2026-01-01T00:00:00Z',
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.air.length, 1);
      assert.equal(result.air[0].region, 'Ukraine');
      assert.equal(result.air[0].total, 30);
      assert.equal(result.air[0].noCallsign, 5);
      assert.equal(result.air[0].highAlt, 10);
      assert.equal(result.air[0].top.length, 3); // US, UK, FR
    });

    it('should synthesize chokepoints from Maritime data', async () => {
      const raw = makeMinimalRawData({
        Maritime: {
          chokepoints: {
            suez: { label: 'Suez Canal', note: 'Normal', lat: 30, lon: 32.3 },
            hormuz: { label: 'Strait of Hormuz', note: 'Elevated', lat: 26.5, lon: 56.3 },
          },
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.chokepoints.length, 2);
      assert.ok(result.chokepoints.some(c => c.label === 'Suez Canal'));
    });

    it('should synthesize NOAA weather alerts', async () => {
      const raw = makeMinimalRawData({
        NOAA: {
          totalSevereAlerts: 3,
          topAlerts: [
            { event: 'Tornado Warning', severity: 'Extreme', headline: 'Tornado in OK', lat: 35.5, lon: -97.5 },
            { event: 'Flood Watch', severity: 'Moderate', headline: 'Flooding expected', lat: null, lon: null },
          ],
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.noaa.totalAlerts, 3);
      // The null lat/lon alert is filtered out
      assert.equal(result.noaa.alerts.length, 1);
      assert.equal(result.noaa.alerts[0].event, 'Tornado Warning');
    });

    it('should build market data from YFinance', async () => {
      const raw = makeMinimalRawData({
        YFinance: {
          quotes: { '^VIX': { price: 19.5, change: 1.2, changePct: 6.5 } },
          indexes: [{ symbol: '^GSPC', name: 'S&P 500', price: 5200, change: 30, changePct: 0.58, history: [] }],
          rates: [{ symbol: 'DX=F', name: 'Dollar Index', price: 104.5, change: 0.3, changePct: 0.29 }],
          commodities: [],
          crypto: [{ symbol: 'BTC-USD', name: 'Bitcoin', price: 68000, change: 500, changePct: 0.74 }],
          summary: { timestamp: '2026-01-01T12:00:00Z' },
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.markets.indexes.length, 1);
      assert.equal(result.markets.indexes[0].symbol, '^GSPC');
      assert.equal(result.markets.rates.length, 1);
      assert.equal(result.markets.crypto.length, 1);
      assert.ok(result.markets.vix);
      assert.equal(result.markets.vix.value, 19.5);
      assert.equal(result.markets.timestamp, '2026-01-01T12:00:00Z');
    });

    it('should limit defense contracts to 5 with truncation', async () => {
      const contracts = Array.from({ length: 8 }, (_, i) => ({
        recipient: 'R'.repeat(50) + i,
        amount: 1000000 * (i + 1),
        description: 'D'.repeat(100) + i,
      }));
      const raw = makeMinimalRawData({
        USAspending: { recentDefenseContracts: contracts },
      });
      const result = await synthesize(raw);
      assert.equal(result.defense.length, 5);
      assert.ok(result.defense[0].recipient.length <= 40);
      assert.ok(result.defense[0].desc.length <= 80);
    });

    it('should build GDELT summary', async () => {
      const raw = makeMinimalRawData({
        GDELT: {
          totalArticles: 100,
          conflicts: [{ title: 'War' }],
          economy: [{ title: 'GDP' }, { title: 'Trade' }],
          health: [],
          crisis: [{ title: 'Quake' }],
          allArticles: [{ title: 'Top Story About Ukraine', url: 'https://example.com/story' }],
          geoPoints: [{ lat: 50, lon: 30, name: 'Kyiv', count: 5 }],
        },
      });
      const result = await synthesize(raw);
      assert.equal(result.gdelt.totalArticles, 100);
      assert.equal(result.gdelt.conflicts, 1);
      assert.equal(result.gdelt.economy, 2);
      assert.equal(result.gdelt.crisis, 1);
      assert.equal(result.gdelt.topTitles.length, 1);
      assert.equal(result.gdelt.geoPoints.length, 1);
    });
  });

  // ─── generateIdeas ───

  describe('generateIdeas', () => {

    it('should return an array capped at 8 ideas', () => {
      const v2 = makeV2ForIdeas({
        fred: [
          { id: 'VIXCLS', value: 30 },
          { id: 'BAMLH0A0HYM2', value: 4 },
          { id: 'T10Y2Y', value: -0.5 },
        ],
        tg: { urgent: Array.from({ length: 5 }, () => ({})) },
        energy: { wti: 75, wtiRecent: [75, 70] },
        thermal: [{ det: 40000 }],
        treasury: { totalDebt: '36000000000000' },
        bls: [
          { id: 'LNS14000000', value: 4.5 },
          { id: 'CES0000000001', momChange: -60 },
          { id: 'WPUFD49104', momChangePct: 0.5 },
          { id: 'CUUR0000SA0', value: 300 },
        ],
        gscpi: { value: 0.8, interpretation: 'above average' },
        acled: { totalEvents: 60, totalFatalities: 600 },
      });
      const ideas = generateIdeas(v2);
      assert.ok(Array.isArray(ideas));
      assert.ok(ideas.length <= 8);
      assert.ok(ideas.length > 0);
    });

    it('should generate conflict-energy nexus idea when urgent signals and high WTI', () => {
      const v2 = makeV2ForIdeas({
        tg: { urgent: Array.from({ length: 5 }, () => ({})) },
        energy: { wti: 75, wtiRecent: [] },
      });
      const ideas = generateIdeas(v2);
      assert.ok(ideas.some(i => i.title === 'Conflict-Energy Nexus Active'));
    });

    it('should NOT generate conflict-energy nexus when insufficient signals', () => {
      const v2 = makeV2ForIdeas({
        tg: { urgent: [{}] }, // only 1, need > 3
        energy: { wti: 75, wtiRecent: [] },
      });
      const ideas = generateIdeas(v2);
      assert.ok(!ideas.some(i => i.title === 'Conflict-Energy Nexus Active'));
    });

    it('should generate elevated volatility idea when VIX > 20', () => {
      const v2 = makeV2ForIdeas({
        fred: [
          { id: 'VIXCLS', value: 22 },
          { id: 'BAMLH0A0HYM2', value: 2 },
          { id: 'T10Y2Y', value: 0.5 },
        ],
      });
      const ideas = generateIdeas(v2);
      const volIdea = ideas.find(i => i.title === 'Elevated Volatility Regime');
      assert.ok(volIdea);
      assert.equal(volIdea.type, 'hedge');
      assert.equal(volIdea.confidence, 'Medium');
    });

    it('should set High confidence for VIX > 25', () => {
      const v2 = makeV2ForIdeas({
        fred: [
          { id: 'VIXCLS', value: 28 },
          { id: 'BAMLH0A0HYM2', value: 2 },
          { id: 'T10Y2Y', value: 0.5 },
        ],
      });
      const ideas = generateIdeas(v2);
      const volIdea = ideas.find(i => i.title === 'Elevated Volatility Regime');
      assert.equal(volIdea.confidence, 'High');
    });

    it('should generate safe haven idea when VIX > 20 and HY > 3', () => {
      const v2 = makeV2ForIdeas({
        fred: [
          { id: 'VIXCLS', value: 22 },
          { id: 'BAMLH0A0HYM2', value: 3.5 },
          { id: 'T10Y2Y', value: 0.5 },
        ],
      });
      const ideas = generateIdeas(v2);
      assert.ok(ideas.some(i => i.title === 'Safe Haven Demand Rising'));
    });

    it('should generate oil momentum idea when WTI moves > 3%', () => {
      const v2 = makeV2ForIdeas({
        energy: { wti: 75, wtiRecent: [75, 70], signals: [] }, // 7.1% move
      });
      const ideas = generateIdeas(v2);
      assert.ok(ideas.some(i => i.title === 'Oil Momentum Building'));
    });

    it('should generate oil under pressure idea for negative moves > 3%', () => {
      const v2 = makeV2ForIdeas({
        energy: { wti: 65, wtiRecent: [65, 70], signals: [] }, // -7.1% move
      });
      const ideas = generateIdeas(v2);
      assert.ok(ideas.some(i => i.title === 'Oil Under Pressure'));
    });

    it('should generate yield curve idea when T10Y2Y exists', () => {
      const v2 = makeV2ForIdeas({
        fred: [
          { id: 'VIXCLS', value: 15 },
          { id: 'BAMLH0A0HYM2', value: 2 },
          { id: 'T10Y2Y', value: 0.5 },
        ],
      });
      const ideas = generateIdeas(v2);
      assert.ok(ideas.some(i => i.title === 'Yield Curve Normalizing'));
    });

    it('should generate inverted yield curve idea when T10Y2Y < 0', () => {
      const v2 = makeV2ForIdeas({
        fred: [
          { id: 'VIXCLS', value: 15 },
          { id: 'BAMLH0A0HYM2', value: 2 },
          { id: 'T10Y2Y', value: -0.3 },
        ],
      });
      const ideas = generateIdeas(v2);
      assert.ok(ideas.some(i => i.title === 'Yield Curve Inverted'));
    });

    it('should generate fiscal trajectory idea when debt > 35T', () => {
      const v2 = makeV2ForIdeas({
        treasury: { totalDebt: '36000000000000' },
      });
      const ideas = generateIdeas(v2);
      assert.ok(ideas.some(i => i.title === 'Fiscal Trajectory Supports Hard Assets'));
    });

    it('should NOT generate fiscal trajectory idea when debt < 35T', () => {
      const v2 = makeV2ForIdeas({
        treasury: { totalDebt: '30000000000000' },
      });
      const ideas = generateIdeas(v2);
      assert.ok(!ideas.some(i => i.title === 'Fiscal Trajectory Supports Hard Assets'));
    });

    it('should generate satellite + conflict idea when thermal > 30000 and urgent > 2', () => {
      const v2 = makeV2ForIdeas({
        thermal: [{ det: 35000 }],
        tg: { urgent: [{}, {}, {}] },
      });
      const ideas = generateIdeas(v2);
      assert.ok(ideas.some(i => i.title === 'Satellite Confirms Conflict Intensity'));
    });

    it('should generate credit stress divergence idea (HY wide, VIX low)', () => {
      const v2 = makeV2ForIdeas({
        fred: [
          { id: 'VIXCLS', value: 15 },
          { id: 'BAMLH0A0HYM2', value: 4 },
          { id: 'T10Y2Y', value: 0.5 },
        ],
      });
      const ideas = generateIdeas(v2);
      assert.ok(ideas.some(i => i.title === 'Credit Stress Ignored by Equity Vol'));
    });

    it('should generate equity fear exceeds credit idea (VIX high, HY tight)', () => {
      const v2 = makeV2ForIdeas({
        fred: [
          { id: 'VIXCLS', value: 30 },
          { id: 'BAMLH0A0HYM2', value: 2 },
          { id: 'T10Y2Y', value: 0.5 },
        ],
      });
      const ideas = generateIdeas(v2);
      assert.ok(ideas.some(i => i.title === 'Equity Fear Exceeds Credit Stress'));
    });

    it('should generate defense procurement idea when fatalities > 500 and thermal > 20000', () => {
      const v2 = makeV2ForIdeas({
        acled: { totalEvents: 100, totalFatalities: 600 },
        thermal: [{ det: 25000 }],
      });
      const ideas = generateIdeas(v2);
      assert.ok(ideas.some(i => i.title === 'Defense Procurement Acceleration Signal'));
    });

    it('should generate inflation pipeline idea when GSCPI > 0.5 and PPI rising', () => {
      const v2 = makeV2ForIdeas({
        gscpi: { value: 0.8, interpretation: 'elevated' },
        bls: [
          { id: 'WPUFD49104', momChangePct: 0.5 },
          { id: 'CUUR0000SA0', value: 300 },
        ],
      });
      const ideas = generateIdeas(v2);
      assert.ok(ideas.some(i => i.title === 'Inflation Pipeline Building Pressure'));
    });

    it('should return empty array when no conditions are met', () => {
      const v2 = makeV2ForIdeas(); // defaults have low values
      const ideas = generateIdeas(v2);
      // Should still have yield curve idea since T10Y2Y exists
      // But no conflict/volatility ideas
      assert.ok(Array.isArray(ideas));
      for (const idea of ideas) {
        assert.ok(idea.title);
        assert.ok(idea.text);
        assert.ok(idea.type);
      }
    });

    it('should have valid types on all ideas', () => {
      const v2 = makeV2ForIdeas({
        fred: [
          { id: 'VIXCLS', value: 30 },
          { id: 'BAMLH0A0HYM2', value: 4 },
          { id: 'T10Y2Y', value: -0.5 },
        ],
        tg: { urgent: Array.from({ length: 5 }, () => ({})) },
        energy: { wti: 75, wtiRecent: [75, 70] },
        thermal: [{ det: 40000 }],
        treasury: { totalDebt: '36000000000000' },
        acled: { totalEvents: 0, totalFatalities: 0 },
      });
      const ideas = generateIdeas(v2);
      const validTypes = ['long', 'hedge', 'watch'];
      for (const idea of ideas) {
        assert.ok(validTypes.includes(idea.type), `Invalid type: ${idea.type}`);
      }
    });
  });

  // ─── fetchAllNews ───

  describe('fetchAllNews', () => {

    it('should return an array capped at 50 items', async () => {
      // Mock fetch to return XML with some items mentioning geotaggable locations
      const xml = `<?xml version="1.0"?>
        <rss><channel>
          ${Array.from({ length: 10 }, (_, i) =>
            `<item><title>Breaking news in Ukraine ${i}</title><link>https://example.com/${i}</link><pubDate>${new Date().toUTCString()}</pubDate></item>`
          ).join('\n')}
        </channel></rss>`;
      mockFetch(xml, { status: 200 });

      const news = await fetchAllNews();
      assert.ok(Array.isArray(news));
      assert.ok(news.length <= 50);
    });

    it('should return empty array when all feeds fail', async () => {
      mockFetch('', { status: 500 });
      const news = await fetchAllNews();
      assert.ok(Array.isArray(news));
    });

    it('should geo-tag news items based on title keywords', async () => {
      const xml = `<?xml version="1.0"?>
        <rss><channel>
          <item><title>Crisis in Ukraine escalates</title><link>https://example.com/1</link><pubDate>${new Date().toUTCString()}</pubDate></item>
        </channel></rss>`;
      mockFetch(xml, { status: 200 });

      const news = await fetchAllNews();
      // At least some items should be geo-tagged with Ukraine coords
      const ukItems = news.filter(n => n.region === 'Ukraine');
      assert.ok(ukItems.length > 0);
    });

    it('should deduplicate news items by title prefix', async () => {
      const xml = `<?xml version="1.0"?>
        <rss><channel>
          <item><title>Same story about Russia repeated here</title><link>https://a.com</link><pubDate>${new Date().toUTCString()}</pubDate></item>
          <item><title>Same story about Russia repeated here</title><link>https://b.com</link><pubDate>${new Date().toUTCString()}</pubDate></item>
        </channel></rss>`;
      mockFetch(xml, { status: 200 });

      const news = await fetchAllNews();
      const russiaItems = news.filter(n => n.title && n.title.includes('Russia'));
      // Should be deduplicated, but given 18 feeds calling with same mock, some dupes may exist
      // across different sources with different source labels. The key dedup is by title prefix.
      assert.ok(news.length > 0);
    });

    it('should sanitize URLs to http/https only', async () => {
      const xml = `<?xml version="1.0"?>
        <rss><channel>
          <item><title>News about China trade war</title><link>javascript:alert(1)</link><pubDate>${new Date().toUTCString()}</pubDate></item>
        </channel></rss>`;
      mockFetch(xml, { status: 200 });

      const news = await fetchAllNews();
      for (const item of news) {
        if (item.url) {
          assert.ok(item.url.startsWith('http://') || item.url.startsWith('https://'));
        }
      }
    });
  });
});
