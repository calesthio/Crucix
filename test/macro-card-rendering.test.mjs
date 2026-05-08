import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync('/Users/rightclaw/services/crucix/dashboard/public/jarvis.html', 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(){`;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`Could not find ${name}`);
  let depth = 0;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`Could not extract ${name}`);
  return html.slice(start, end);
}

const code = `${extractFunction('renderLower')}
this.renderLower = renderLower;`;

function makeSnapshot() {
  return {
    fred: [],
    bls: [],
    gscpi: { value: 0.68, interpretation: 'above average' },
    markets: {
      indexes: [],
      crypto: [],
      rates: [],
      vix: { value: 18.7, changePct: -3.11 },
      timestamp: '2026-04-24T23:30:00.000Z',
    },
    metals: {
      gold: 4725.4,
      goldChangePct: 0.43,
      goldRecent: [4806.6, 4698.4, 4732.5, 4705.1, 4725.4],
      silver: 75.69,
      silverChangePct: 0.29,
      silverRecent: [79.95, 76.41, 77.89, 75.46, 75.68],
    },
    energy: { wti: 94.88, brent: 99.78, natgas: 2.69, wtiRecent: [89.61, 92.13, 92.96, 95.85, 94.88] },
    health: [
      { name: 'FRED', n: 'FRED', state: 'failed', failure: { class: 'setup-debt', operatorLabel: 'Setup debt' }, counters: {} },
      { name: 'BLS', n: 'BLS', state: 'failed', failure: { class: 'external-limit', operatorLabel: 'External limit' }, counters: {} },
      { name: 'GSCPI', n: 'GSCPI', state: 'ok', failure: { class: 'none' }, counters: {} },
      { name: 'YFinance', n: 'YFinance', state: 'ok', failure: { class: 'none' }, counters: {} },
    ],
    newsFeed: [],
    ideas: [],
    ideasSource: 'llm-failed',
    agentAnalysis: { confidenceLabel: 'low', status: 'ready' },
    agentAnalysisMeta: { source: 'deterministic', refinementCompletion: 'fallback-parse-failed', error: 'parse-failed' },
    evidenceSummary: {},
    corroboratedSignals: [],
    suspectSignals: [],
  };
}

function runRender(snapshot = makeSnapshot()) {
  const lowerGrid = { innerHTML: '' };
  const context = {
    console,
    D: snapshot,
    lowPerfMode: false,
    document: { getElementById: (id) => (id === 'lowerGrid' ? lowerGrid : { innerHTML: '' }) },
    isMobileLayout: () => false,
    t: (_k, fallback) => fallback,
    cleanText: (v = '') => String(v),
    getAge: () => 'now',
    mkSparkSvg: () => '<svg class="spark"></svg>',
    buildOsintPanel: () => '',
    memory: { getLastDelta: () => null },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  context.renderLower();
  return lowerGrid.innerHTML;
}

test('renderLower shows explicit macro source states for missing macro feeds', () => {
  const out = runRender();
  assert.match(out, /Fed Funds[\s\S]*Not configured/);
  assert.match(out, /CPI MoM[\s\S]*Rate limited/);
  assert.match(out, /Unemployment[\s\S]*Rate limited/);
  assert.doesNotMatch(out, /NaN|NaNT|undefined|null/);
});

test('renderLower preserves healthy macro and market values alongside degraded states', () => {
  const out = runRender();
  assert.match(out, /GSCPI[\s\S]*0\.68[\s\S]*above average/);
  assert.match(out, /VIX[\s\S]*18\.7[\s\S]*-3\.11%/);
  assert.match(out, /Gold[\s\S]*\$4,725\.4[\s\S]*\+0\.43% today/);
});

test('renderLower uses coherent LLM status labels across analysis and ideas panels', () => {
  const out = runRender();
  assert.match(out, /Agent Analysis[\s\S]*LLM FALLBACK/);
  assert.match(out, /LLM attempted, fallback kept \(parse-failed\)/);
  assert.match(out, /Leverageable Ideas[\s\S]*LLM FALLBACK/);
  assert.doesNotMatch(out, /AI ENHANCED|LLM OFF|>PENDING</);
});
