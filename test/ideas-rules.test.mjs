// Tests for the deterministic signal-based idea engine and the LLM/rules
// fallback resolver in dashboard/inject.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateIdeas, resolveIdeas } from '../dashboard/inject.mjs';

/** Minimal synthesized-sweep shape, matching what synthesize() produces. */
function makeSweep(overrides = {}) {
  return {
    fred: [],
    bls: [],
    thermal: [],
    tg: { urgent: [] },
    energy: { wtiRecent: [] },
    treasury: { totalDebt: '0' },
    acled: { totalEvents: 0, totalFatalities: 0 },
    gscpi: null,
    ...overrides,
  };
}

const fred = (id, value) => ({ id, label: id, value });
const urgentPosts = n => Array.from({ length: n }, (_, i) => ({ text: `urgent ${i}` }));
const titles = ideas => ideas.map(i => i.title);

describe('generateIdeas — degraded and empty sweeps', () => {
  test('returns an empty array for a sweep with no signals', () => {
    assert.deepEqual(generateIdeas(makeSweep()), []);
  });

  test('returns an empty array rather than throwing on null input', () => {
    assert.deepEqual(generateIdeas(null), []);
    assert.deepEqual(generateIdeas(undefined), []);
  });

  test('tolerates a sweep where every source failed (missing keys)', () => {
    // A sweep in which FRED/EIA/BLS/Telegram all errored leaves these undefined.
    assert.deepEqual(generateIdeas({}), []);
  });

  test('tolerates null-valued metrics without emitting bogus ideas', () => {
    const sweep = makeSweep({
      fred: [fred('VIXCLS', null), fred('T10Y2Y', undefined), fred('BAMLH0A0HYM2', null)],
      bls: [{ id: 'UNRATE', value: null }],
    });
    assert.deepEqual(generateIdeas(sweep), []);
  });
});

describe('generateIdeas — individual signal rules', () => {
  test('flags an elevated volatility regime above VIX 20', () => {
    const ideas = generateIdeas(makeSweep({ fred: [fred('VIXCLS', 22)] }));
    const vol = ideas.find(i => i.title === 'Elevated Volatility Regime');
    assert.ok(vol, 'expected an Elevated Volatility Regime idea');
    assert.equal(vol.type, 'hedge');
    assert.equal(vol.confidence, 'Medium');
  });

  test('raises confidence to High above VIX 25', () => {
    const ideas = generateIdeas(makeSweep({ fred: [fred('VIXCLS', 30)] }));
    assert.equal(ideas.find(i => i.title === 'Elevated Volatility Regime').confidence, 'High');
  });

  test('does not flag volatility at or below the VIX 20 threshold', () => {
    const ideas = generateIdeas(makeSweep({ fred: [fred('VIXCLS', 20)] }));
    assert.equal(ideas.find(i => i.title === 'Elevated Volatility Regime'), undefined);
  });

  test('flags safe-haven demand when VIX and HY spreads are both elevated', () => {
    const ideas = generateIdeas(makeSweep({
      fred: [fred('VIXCLS', 26), fred('BAMLH0A0HYM2', 4)],
    }));
    assert.ok(titles(ideas).includes('Safe Haven Demand Rising'));
  });

  test('flags the conflict-energy nexus on urgent OSINT plus firm crude', () => {
    const ideas = generateIdeas(makeSweep({
      tg: { urgent: urgentPosts(4) },
      energy: { wti: 80, wtiRecent: [] },
    }));
    const nexus = ideas.find(i => i.title === 'Conflict-Energy Nexus Active');
    assert.ok(nexus);
    assert.equal(nexus.type, 'long');
    assert.match(nexus.text, /4 urgent conflict signals/);
  });

  test('reads oil momentum from the WTI history', () => {
    const up = generateIdeas(makeSweep({ energy: { wti: 90, wtiRecent: [90, 85, 80] } }));
    assert.ok(titles(up).includes('Oil Momentum Building'));

    const down = generateIdeas(makeSweep({ energy: { wti: 70, wtiRecent: [70, 75, 80] } }));
    assert.ok(titles(down).includes('Oil Under Pressure'));
  });

  test('ignores WTI history when the oldest price is zero', () => {
    // Previously divided by zero and produced an Infinity% move.
    const ideas = generateIdeas(makeSweep({ energy: { wti: 80, wtiRecent: [80, 0] } }));
    assert.equal(ideas.find(i => /^Oil /.test(i.title)), undefined);
  });

  test('reports yield curve state in both directions', () => {
    const inverted = generateIdeas(makeSweep({ fred: [fred('T10Y2Y', -0.5)] }));
    assert.ok(titles(inverted).includes('Yield Curve Inverted'));

    const normal = generateIdeas(makeSweep({ fred: [fred('T10Y2Y', 0.5)] }));
    assert.ok(titles(normal).includes('Yield Curve Normalizing'));
  });

  test('flags the fiscal trajectory above $35T of debt', () => {
    const ideas = generateIdeas(makeSweep({ treasury: { totalDebt: '36000000000000' } }));
    const fiscal = ideas.find(i => i.title === 'Fiscal Trajectory Supports Hard Assets');
    assert.ok(fiscal);
    assert.equal(fiscal.confidence, 'High');
  });

  test('flags credit stress that equity volatility is ignoring', () => {
    const ideas = generateIdeas(makeSweep({
      fred: [fred('VIXCLS', 15), fred('BAMLH0A0HYM2', 4)],
    }));
    assert.ok(titles(ideas).includes('Credit Stress Ignored by Equity Vol'));
  });

  test('flags satellite confirmation of conflict intensity', () => {
    const ideas = generateIdeas(makeSweep({
      thermal: [{ det: 20000 }, { det: 15000 }],
      tg: { urgent: urgentPosts(3) },
    }));
    assert.ok(titles(ideas).includes('Satellite Confirms Conflict Intensity'));
  });

  test('caps output at 8 ideas', () => {
    // Trip as many rules simultaneously as possible.
    const ideas = generateIdeas(makeSweep({
      fred: [fred('VIXCLS', 30), fred('BAMLH0A0HYM2', 4), fred('T10Y2Y', 0.5)],
      bls: [
        { id: 'UNRATE', value: 5 },
        { id: 'PAYEMS', value: 1, momChange: -100 },
        { id: 'CPIAUCSL', value: 300 },
        { id: 'WPUFD49104', value: 250, momChangePct: 1 },
      ],
      thermal: [{ det: 40000 }],
      tg: { urgent: urgentPosts(6) },
      energy: { wti: 90, wtiRecent: [90, 80] },
      treasury: { totalDebt: '36000000000000' },
      acled: { totalEvents: 100, totalFatalities: 900 },
      gscpi: { value: 1.2, interpretation: 'elevated' },
    }));
    assert.equal(ideas.length, 8);
  });
});

describe('generateIdeas — output contract', () => {
  test('every idea carries the fields the dashboard renders', () => {
    const ideas = generateIdeas(makeSweep({
      fred: [fred('VIXCLS', 30), fred('BAMLH0A0HYM2', 4), fred('T10Y2Y', 0.5)],
      treasury: { totalDebt: '36000000000000' },
    }));
    assert.ok(ideas.length > 0);
    for (const idea of ideas) {
      assert.equal(typeof idea.title, 'string', 'title must be a string');
      assert.ok(idea.title.length > 0);
      assert.equal(typeof idea.text, 'string', 'text must be a string');
      assert.ok(['long', 'hedge', 'watch'].includes(idea.type), `unexpected type: ${idea.type}`);
      assert.ok(['Low', 'Medium', 'High'].includes(idea.confidence), `unexpected confidence: ${idea.confidence}`);
      assert.ok(['tactical', 'swing', 'strategic'].includes(idea.horizon), `unexpected horizon: ${idea.horizon}`);
      // No NaN/Infinity leaking into user-facing copy.
      assert.doesNotMatch(idea.text, /NaN|Infinity|undefined/);
    }
  });
});

describe('resolveIdeas — LLM with rule-based fallback', () => {
  const sweep = makeSweep({ fred: [fred('VIXCLS', 30)] });

  test('falls back to signal rules when no provider is configured', async () => {
    const result = await resolveIdeas(null, sweep);
    assert.equal(result.ideasSource, 'rules');
    assert.ok(result.ideas.length > 0);
  });

  test('falls back to signal rules when the provider is unconfigured', async () => {
    const result = await resolveIdeas({ isConfigured: false }, sweep);
    assert.equal(result.ideasSource, 'rules');
    assert.ok(result.ideas.length > 0);
  });

  test('falls back to signal rules when the LLM throws', async () => {
    const provider = {
      isConfigured: true,
      name: 'boom',
      complete: async () => { throw new Error('upstream 503'); },
    };
    const result = await resolveIdeas(provider, sweep);
    assert.equal(result.ideasSource, 'rules');
    assert.ok(result.ideas.length > 0, 'a provider outage must not blank the panel');
  });

  test('falls back to signal rules when the LLM returns unusable output', async () => {
    const provider = {
      isConfigured: true,
      name: 'garbage',
      complete: async () => ({ text: 'not json at all' }),
    };
    const result = await resolveIdeas(provider, sweep);
    assert.equal(result.ideasSource, 'rules');
    assert.ok(result.ideas.length > 0);
  });

  test('prefers LLM ideas when the provider returns them', async () => {
    const provider = {
      isConfigured: true,
      name: 'good',
      complete: async () => ({
        text: JSON.stringify([{
          title: 'LLM Idea',
          rationale: 'because',
          type: 'long',
          confidence: 'High',
          horizon: 'swing',
        }]),
      }),
    };
    const result = await resolveIdeas(provider, sweep);
    assert.equal(result.ideasSource, 'llm');
    assert.equal(result.ideas[0].title, 'LLM Idea');
  });
});
