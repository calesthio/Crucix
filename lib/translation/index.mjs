// Translation Service for Crucix
// Provides real-time bilingual translation using MiniMax-M2.7
// Designed to work alongside the i18n static labels system

import { createRequire } from 'node:url';
const require = createRequire(import.meta.url);
try { require('../../.env'); } catch {} // Load LLM_API_KEY

import { createLLMProvider } from '../llm/index.mjs';
import { config } from '../../crucix.config.mjs';

// LLM provider (lazy init)
let _provider = null;
function getLLMProvider() {
  if (!_provider) {
    _provider = createLLMProvider(config.llm);
  }
  return _provider;
}

// LRU translation cache (key = text|context)
const _cache = new Map();
const MAX_CACHE = 2000;

// Bilingual metric/indicator names (static, no LLM call needed)
const METRIC_LABELS = {
  // FRED indicators
  'VIXCLS':         { en: 'VIXCLS', zh: 'VIX 恐慌指数', abbr: 'VIX' },
  'BAMLH0A0HYM2':    { en: 'BAMLH0A0HYM2', zh: '高收益债利差', abbr: 'HY利差' },
  'T10Y2Y':          { en: 'T10Y2Y', zh: '10Y-2Y收益率差', abbr: '10Y-2Y' },
  'T10Y3M':          { en: 'T10Y3M', zh: '10Y-3M收益率差', abbr: '10Y-3M' },
  'DFF':             { en: 'DFF', zh: '联邦基金利率', abbr: 'FF Rate' },
  'DGS10':           { en: 'DGS10', zh: '10年期国债收益率', abbr: '10Y Yield' },
  'DGS2':            { en: 'DGS2', zh: '2年期国债收益率', abbr: '2Y Yield' },
  'DGS30':           { en: 'DGS30', zh: '30年期国债收益率', abbr: '30Y Yield' },
  'CPIAUCSL':        { en: 'CPIAUCSL', zh: 'CPI 消费者价格指数', abbr: 'CPI' },
  'CPILFESL':        { en: 'CPILFESL', zh: '核心CPI (排除食品能源)', abbr: 'Core CPI' },
  'PCEPI':           { en: 'PCEPI', zh: 'PCE个人消费支出价格指数', abbr: 'PCE' },
  'MICH':            { en: 'MICH', zh: '密歇根通胀预期', abbr: 'Inflation Exp.' },
  'UNRATE':          { en: 'UNRATE', zh: '失业率', abbr: 'Unemp.' },
  'PAYEMS':          { en: 'PAYEMS', zh: '非农就业人数', abbr: 'Payrolls' },
  'ICSA':            { en: 'ICSA', zh: '初请失业金人数', abbr: 'Claims' },
  'M2SL':            { en: 'M2SL', zh: 'M2 货币供应量', abbr: 'M2' },
  'WALCL':           { en: 'WALCL', zh: '美联储总资产', abbr: 'Fed Assets' },
  'DCOILWTICO':      { en: 'DCOILWTICO', zh: 'WTI 原油价格', abbr: 'WTI' },
  'GOLDAMGBD228NLBM':{ en: 'GOLDAMGBD228NLBM', zh: '伦敦金价', abbr: 'Gold' },
  'MORTGAGE30US':    { en: 'MORTGAGE30US', zh: '30年期抵押贷款利率', abbr: '30Y Mort.' },
  'DTWEXBGS':        { en: 'DTWEXBGS', zh: '美元贸易加权指数', abbr: 'USD Index' },
  // Commodities
  'wti':             { en: 'WTI', zh: 'WTI 原油', abbr: 'WTI' },
  'brent':           { en: 'Brent', zh: '布伦特原油', abbr: 'Brent' },
  'natgas':          { en: 'Nat. Gas', zh: '天然气', abbr: 'Nat. Gas' },
  'gold':            { en: 'Gold', zh: '黄金', abbr: 'Gold' },
  'silver':          { en: 'Silver', zh: '白银', abbr: 'Silver' },
  // Source labels
  'GDELT':           { en: 'GDELT', zh: 'GDELT 全球新闻数据库', abbr: 'GDELT' },
  'FIRMS':           { en: 'FIRMS', zh: 'FIRMS 火点监测', abbr: 'FIRMS' },
  'OpenSky':         { en: 'OpenSky', zh: 'OpenSky 航班追踪', abbr: 'OpenSky' },
  'ACLED':           { en: 'ACLED', zh: 'ACLED 冲突数据', abbr: 'ACLED' },
  'NOAA':            { en: 'NOAA', zh: 'NOAA 气象预警', abbr: 'NOAA' },
  'WHO':             { en: 'WHO', zh: '世卫组织', abbr: 'WHO' },
  'EIA':             { en: 'EIA', zh: '能源信息署', abbr: 'EIA' },
  'FRED':            { en: 'FRED', zh: '美联储经济数据', abbr: 'FRED' },
  'BLS':             { en: 'BLS', zh: '劳工统计局', abbr: 'BLS' },
  'USAspending':     { en: 'USAspending', zh: '美国政府支出', abbr: 'USAspend' },
  // Market terms
  'bull_market':     { en: 'Bull Market', zh: '牛市', abbr: '牛市' },
  'bear_market':     { en: 'Bear Market', zh: '熊市', abbr: '熊市' },
  'recession':       { en: 'Recession', zh: '经济衰退', abbr: '衰退' },
  'inflation':       { en: 'Inflation', zh: '通胀', abbr: '通胀' },
  'deflation':       { en: 'Deflation', zh: '通缩', abbr: '通缩' },
  'stagflation':     { en: 'Stagflation', zh: '滞胀', abbr: '滞胀' },
  'risk_off':        { en: 'Risk-Off', zh: '风险规避', abbr: 'Risk-Off' },
  'risk_on':         { en: 'Risk-On', zh: '风险偏好', abbr: 'Risk-On' },
  // Layer labels
  'Air Activity':    { en: 'Air Activity', zh: '空中活动', abbr: '空中' },
  'SDR Coverage':    { en: 'SDR Coverage', zh: 'SDR 覆盖', abbr: 'SDR' },
  'Maritime Watch':  { en: 'Maritime Watch', zh: '海上监控', abbr: '海上' },
  'Nuclear Sites':   { en: 'Nuclear Sites', zh: '核电站监测', abbr: '核监测' },
  'Health Watch':    { en: 'Health Watch', zh: '公共卫生监测', abbr: '卫生' },
  'OSINT Feed':      { en: 'OSINT Feed', zh: '开源情报', abbr: 'OSINT' },
  'Space Activity':  { en: 'Space Activity', zh: '太空活动', abbr: '太空' },
};

/**
 * Get bilingual label for a metric/source ID
 * @param {string} id - Metric ID (e.g., 'VIXCLS', 'wti', 'GDELT')
 * @returns {{ en: string, zh: string, abbr: string }}
 */
export function bilingualLabel(id) {
  const info = METRIC_LABELS[id];
  if (info) return info;
  return { en: id, zh: id, abbr: id };
}

/**
 * Translate text using MiniMax-M2.7 with caching
 * @param {string} text - Text to translate
 * @param {string} context - Translation context hint
 * @returns {Promise<string>} Chinese translation
 */
export async function translateText(text, context = '') {
  if (!text?.trim()) return '';
  
  const cacheKey = `${context}:${text.slice(0, 200)}`;
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);
  
  const provider = getLLMProvider();
  if (!provider?.isConfigured) {
    return ''; // No LLM configured, skip translation
  }
  
  const systemPrompt = `You are a professional financial and geopolitical translator.
Translate English to Simplified Chinese (zh-CN).
Rules:
1. Metric/indicator names: keep English + Chinese in parentheses on first occurrence
2. Country names: use official Chinese translations
3. Organization names: use known Chinese names (IMF→国际货币基金组织, OPEC→欧佩克, NATO→北约, WHO→世界卫生组织)
4. Market terms: translate standard terms (bull market→牛市, bear market→熊市, spread→利差)
5. Technical terms: translate with brief explanation
6. Return ONLY the Chinese translation, no quotes, no explanation
7. Keep person names and proper nouns in original form when no standard Chinese exists
8. If translation fails, return empty string`;

  try {
    const result = await provider.complete(systemPrompt, text, { maxTokens: 400 });
    const zh = result.text.trim();
    
    // LRU eviction
    if (_cache.size >= MAX_CACHE) {
      const firstKey = _cache.keys().next().value;
      _cache.delete(firstKey);
    }
    _cache.set(cacheKey, zh);
    return zh;
  } catch (err) {
    console.warn(`[Translator] Failed: "${text.slice(0,50)}..." — ${err.message}`);
    return '';
  }
}

/**
 * Batch translate texts (parallel, with concurrency limit)
 * @param {string[]} texts
 * @param {string} context
 * @returns {Promise<string[]>} Chinese translations (parallel order)
 */
export async function translateBatch(texts, context = '') {
  const CONCURRENCY = 4;
  const results = new Array(texts.length).fill('');
  const pending = [];
  
  for (let i = 0; i < texts.length; i++) {
    if (!texts[i]?.trim()) { results[i] = ''; continue; }
    pending.push({ idx: i, text: texts[i] });
  }
  
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(({ idx, text }) => translateText(text, context))
    );
    resolved.forEach((zh, j) => { results[batch[j].idx] = zh; });
  }
  
  return results;
}

/**
 * Translate dashboard V2 data object in-place
 * Adds _zh suffix fields for all user-facing strings that were translated
 * @param {object} V2 - Synthesized dashboard data (modified in place)
 * @returns {Promise<object>} The same V2 object (mutated)
 */
export async function translateDashboard(V2) {
  const lang = process.env.CRUCIX_LANG || 'en';
  if (lang !== 'zh') return V2; // Only translate when zh mode is active
  
  const provider = getLLMProvider();
  if (!provider?.isConfigured) {
    console.warn('[Translator] LLM not configured, skipping real-time translation');
    return V2;
  }

  console.log('[Translator] Starting bilingual translation via MiniMax-M2.7...');
  const start = Date.now();

  // === 1. Translate FRED indicator labels ===
  const fredItems = V2.fred || [];
  const fredLabels = fredItems.map(f => f.label);
  const translatedFredLabels = await translateBatch(fredLabels, 'economic indicator name');
  fredItems.forEach((f, i) => {
    f.labelZh = translatedFredLabels[i] || f.label;
  });

  // === 2. Translate GDELT news headlines ===
  const gdeltTitles = V2.gdelt?.topTitles || [];
  const translatedTitles = await translateBatch(gdeltTitles, 'news headline');
  gdeltTitles.forEach((t, i) => {
    if (V2.gdelt?.topTitles) V2.gdelt.topTitles[i] = { original: t, zh: translatedTitles[i] || t };
  });

  // === 3. Translate WHO alert titles ===
  const whoAlerts = V2.who || [];
  const whoTitles = whoAlerts.map(w => w.title);
  const translatedWho = await translateBatch(whoTitles, 'disease alert');
  whoAlerts.forEach((w, i) => {
    w.titleZh = translatedWho[i] || w.title;
    w.summaryZh = w.summary ? (translateText(w.summary, 'disease alert summary') || '') : '';
  });

  // === 4. Translate defense contract descriptions ===
  const defenseItems = V2.defense || [];
  const defenseDescs = defenseItems.map(c => c.desc);
  const translatedDefense = await translateBatch(defenseDescs, 'government contract');
  defenseItems.forEach((c, i) => {
    c.descZh = translatedDefense[i] || c.desc;
  });

  // === 5. Translate news feed headlines ===
  const newsFeed = V2.newsFeed || [];
  const newsHeadlines = newsFeed.map(n => n.headline);
  const translatedNews = await translateBatch(newsHeadlines, 'intelligence headline');
  newsFeed.forEach((n, i) => {
    n.headlineZh = translatedNews[i] || n.headline;
  });

  // === 6. Translate Telegram urgent posts ===
  const tgPosts = V2.tg?.urgent || [];
  const tgTexts = tgPosts.map(p => p.text);
  const translatedTg = await translateBatch(tgTexts, 'OSINT telegram post');
  tgPosts.forEach((p, i) => {
    p.textZh = translatedTg[i] || p.text;
  });

  // === 7. Translate NOAA alert headlines ===
  const noaaAlerts = V2.noaa?.alerts || [];
  const noaaHeadlines = noaaAlerts.map(a => a.headline);
  const translatedNoaa = await translateBatch(noaaHeadlines, 'weather alert');
  noaaAlerts.forEach((a, i) => {
    a.headlineZh = translatedNoaa[i] || a.headline;
  });

  // === 8. Translate space launch names ===
  const launches = V2.space?.recentLaunches || [];
  const launchNames = launches.map(l => l.name);
  const translatedLaunches = await translateBatch(launchNames, 'space launch name');
  launches.forEach((l, i) => {
    l.nameZh = translatedLaunches[i] || l.name;
  });

  // === 9. Translate idea titles (if LLM ideas exist) ===
  if (V2.ideas?.length) {
    const ideaTitles = V2.ideas.map(idea => idea.title);
    const translatedIdeas = await translateBatch(ideaTitles, 'trading idea');
    V2.ideas.forEach((idea, i) => {
      idea.titleZh = translatedIdeas[i] || idea.title;
    });
  }

  const elapsed = Date.now() - start;
  console.log(`[Translator] Done — ${Object.keys(_cache).length} cached, ${elapsed}ms`);
  
  return V2;
}

/**
 * Check translator health
 * @returns {Promise<{ok: boolean, model: string, cacheSize: number}>}
 */
export async function check() {
  try {
    const provider = getLLMProvider();
    if (!provider?.isConfigured) {
      return { ok: false, reason: 'LLM not configured', model: null, cacheSize: 0 };
    }
    // Quick test
    const test = await provider.complete(
      'You are a test assistant. Reply with exactly: OK',
      'Reply OK',
      { maxTokens: 10 }
    );
    return {
      ok: test.text.trim() === 'OK',
      model: provider.model || 'MiniMax-M2.7',
      cacheSize: _cache.size,
    };
  } catch (err) {
    return { ok: false, reason: err.message, model: null, cacheSize: _cache.size };
  }
}

// Export cache stats for debugging
export function cacheStats() {
  return { size: _cache.size, max: MAX_CACHE };
}