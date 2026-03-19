// Delta Engine — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDelta, DEFAULT_NUMERIC_THRESHOLDS, DEFAULT_COUNT_THRESHOLDS } from '../lib/delta/engine.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal synthesized data object with sensible defaults.
 * Callers can spread-override any field.
 */
function makeData(overrides = {}) {
  return {
    fred: [],
    energy: {},
    bls: [],
    tg: { urgent: [], top: [] },
    nuke: [],
    health: [],
    ...overrides,
  };
}

/**
 * Build a FRED series entry (the shape the extractor functions expect).
 */
function fredEntry(id, value) {
  return { id, value };
}

// ─── computeDelta — null-guard tests ─────────────────────────────────────────

describe('computeDelta', () => {
  it('returns null when previous is null', () => {
    const result = computeDelta(makeData(), null);
    assert.equal(result, null);
  });

  it('returns null when previous is undefined', () => {
    const result = computeDelta(makeData(), undefined);
    assert.equal(result, null);
  });

  it('returns null when current is null', () => {
    const result = computeDelta(null, makeData());
    assert.equal(result, null);
  });

  it('returns null when current is undefined', () => {
    const result = computeDelta(undefined, makeData());
    assert.equal(result, null);
  });

  // ─── Return-shape tests ───────────────────────────────────────────────────

  it('returns an object with signals and summary fields', () => {
    const result = computeDelta(makeData(), makeData());
    assert.ok(result !== null, 'expected a result object');
    assert.ok(typeof result === 'object');
    assert.ok('signals' in result, 'missing signals field');
    assert.ok('summary' in result, 'missing summary field');
    // signals sub-keys
    assert.ok(Array.isArray(result.signals.new));
    assert.ok(Array.isArray(result.signals.escalated));
    assert.ok(Array.isArray(result.signals.deescalated));
    assert.ok(Array.isArray(result.signals.unchanged));
  });

  it('summary has totalChanges, criticalChanges, and direction fields', () => {
    const result = computeDelta(makeData(), makeData());
    const { summary } = result;
    assert.ok('totalChanges' in summary, 'missing summary.totalChanges');
    assert.ok('criticalChanges' in summary, 'missing summary.criticalChanges');
    assert.ok('direction' in summary, 'missing summary.direction');
  });

  // ─── Numeric metric tests ─────────────────────────────────────────────────

  it('numeric escalation: metric jump above threshold appears in signals.escalated', () => {
    // VIX threshold is 5 %. Go from 20 → 22.1 (= 10.5 % jump)
    const prev = makeData({ fred: [fredEntry('VIXCLS', 20)] });
    const curr = makeData({ fred: [fredEntry('VIXCLS', 22.1)] });

    const result = computeDelta(curr, prev);
    const hit = result.signals.escalated.find(s => s.key === 'vix');
    assert.ok(hit, 'vix should appear in escalated');
    assert.equal(hit.direction, 'up');
    assert.ok(hit.pctChange > 5);
  });

  it('numeric de-escalation: metric drop above threshold appears in signals.deescalated', () => {
    // VIX threshold is 5 %. Go from 20 → 17.5 (= -12.5 % drop)
    const prev = makeData({ fred: [fredEntry('VIXCLS', 20)] });
    const curr = makeData({ fred: [fredEntry('VIXCLS', 17.5)] });

    const result = computeDelta(curr, prev);
    const hit = result.signals.deescalated.find(s => s.key === 'vix');
    assert.ok(hit, 'vix should appear in deescalated');
    assert.equal(hit.direction, 'down');
    assert.ok(hit.pctChange < 0);
  });

  it('below-threshold change: metric change within threshold appears in signals.unchanged', () => {
    // VIX threshold is 5 %. Go from 20 → 20.5 (= 2.5 % — below 5 %)
    const prev = makeData({ fred: [fredEntry('VIXCLS', 20)] });
    const curr = makeData({ fred: [fredEntry('VIXCLS', 20.5)] });

    const result = computeDelta(curr, prev);
    assert.ok(result.signals.unchanged.includes('vix'), 'vix should be in unchanged');
    const notEscalated = !result.signals.escalated.find(s => s.key === 'vix');
    assert.ok(notEscalated, 'vix should NOT be in escalated');
  });

  it('threshold override: custom lower threshold triggers change that default would not catch', () => {
    // Default VIX threshold is 5 %. Override to 1 %. Go from 20 → 20.5 (2.5 %)
    const prev = makeData({ fred: [fredEntry('VIXCLS', 20)] });
    const curr = makeData({ fred: [fredEntry('VIXCLS', 20.5)] });

    // Without override — should be unchanged
    const without = computeDelta(curr, prev);
    assert.ok(without.signals.unchanged.includes('vix'), 'vix should be unchanged without override');

    // With override — 2.5 % > 1 % threshold, so should escalate
    const with_ = computeDelta(curr, prev, { numeric: { vix: 1 } });
    const hit = with_.signals.escalated.find(s => s.key === 'vix');
    assert.ok(hit, 'vix should escalate with lowered threshold');
  });

  // ─── Count metric tests ───────────────────────────────────────────────────

  it('count metric increase above threshold appears in signals.escalated', () => {
    // thermal_total threshold is 500. Go from 1000 → 2000 (diff = +1000 >= 500)
    const prev = makeData({ thermal: [{ region: 'A', det: 1000, night: 0, hc: 0 }] });
    const curr = makeData({ thermal: [{ region: 'A', det: 2000, night: 0, hc: 0 }] });

    const result = computeDelta(curr, prev);
    const hit = result.signals.escalated.find(s => s.key === 'thermal_total');
    assert.ok(hit, 'thermal_total should appear in escalated');
    assert.equal(hit.direction, 'up');
    assert.equal(hit.change, 1000);
  });

  it('count metric change below threshold appears in signals.unchanged', () => {
    // thermal_total threshold is 500. Go from 1000 → 1200 (diff = +200 < 500)
    const prev = makeData({ thermal: [{ region: 'A', det: 1000, night: 0, hc: 0 }] });
    const curr = makeData({ thermal: [{ region: 'A', det: 1200, night: 0, hc: 0 }] });

    const result = computeDelta(curr, prev);
    assert.ok(result.signals.unchanged.includes('thermal_total'), 'thermal_total should be unchanged');
  });

  // ─── Telegram dedup tests ─────────────────────────────────────────────────

  it('telegram dedup: new unique urgent post is detected as a new signal', () => {
    const prev = makeData({ tg: { urgent: [], top: [] } });
    const curr = makeData({
      tg: {
        urgent: [{ text: 'BREAKING: missiles launched at 14:32 over Ukraine' }],
        top: [],
      },
    });

    const result = computeDelta(curr, prev);
    const tgSignals = result.signals.new.filter(s => s.key.startsWith('tg_urgent:'));
    assert.equal(tgSignals.length, 1, 'expected exactly one new TG signal');
    assert.ok(tgSignals[0].text.includes('missiles'));
  });

  it('telegram dedup: identical post text is NOT flagged again', () => {
    const sharedText = 'BREAKING: missiles launched at 14:32 over Ukraine';
    const posts = [{ text: sharedText }];
    // Both current and previous have the same post
    const prev = makeData({ tg: { urgent: posts, top: [] } });
    const curr = makeData({ tg: { urgent: posts, top: [] } });

    const result = computeDelta(curr, prev);
    const tgSignals = result.signals.new.filter(s => s.key.startsWith('tg_urgent:'));
    assert.equal(tgSignals.length, 0, 'identical post should not produce new signal');
  });

  it('telegram dedup: semantically similar posts (same text, different time) are deduplicated', () => {
    // The contentHash normalizes timestamps, so "14:32" vs "15:01" hash the same
    const prev = makeData({
      tg: { urgent: [{ text: 'BREAKING: 5 missiles at 14:32 over Ukraine' }], top: [] },
    });
    const curr = makeData({
      tg: { urgent: [{ text: 'Breaking: 7 missiles at 15:01 over Ukraine' }], top: [] },
    });

    const result = computeDelta(curr, prev);
    // Semantically the same: numbers normalized to N, time stripped → same hash
    const tgSignals = result.signals.new.filter(s => s.key.startsWith('tg_urgent:'));
    assert.equal(tgSignals.length, 0, 'semantically similar post should not be re-flagged');
  });

  // ─── Overall direction tests ──────────────────────────────────────────────

  it('overall direction is risk-off when multiple risk-key metrics escalate', () => {
    // Escalate VIX (risk key) and HY spread (risk key) — need riskUp > riskDown + 1
    const prev = makeData({
      fred: [
        fredEntry('VIXCLS', 20),
        fredEntry('BAMLH0A0HYM2', 300),
        fredEntry('DFF', 5.25),
      ],
    });
    const curr = makeData({
      fred: [
        fredEntry('VIXCLS', 30),    // +50 % — way above 5 % threshold
        fredEntry('BAMLH0A0HYM2', 400),  // +33 % — above 5 % threshold
        fredEntry('DFF', 5.25),
      ],
    });

    const result = computeDelta(curr, prev);
    assert.equal(result.summary.direction, 'risk-off', 'should be risk-off when risk metrics spike');
  });

  it('overall direction is risk-on when multiple risk-key metrics de-escalate', () => {
    // De-escalate VIX and HY spread — need riskDown > riskUp + 1
    const prev = makeData({
      fred: [
        fredEntry('VIXCLS', 30),
        fredEntry('BAMLH0A0HYM2', 400),
        fredEntry('DFF', 5.25),
      ],
    });
    const curr = makeData({
      fred: [
        fredEntry('VIXCLS', 20),    // -33 % — well above 5 % threshold (downward)
        fredEntry('BAMLH0A0HYM2', 280), // -30 % — well above 5 % threshold (downward)
        fredEntry('DFF', 5.25),
      ],
    });

    const result = computeDelta(curr, prev);
    assert.equal(result.summary.direction, 'risk-on', 'should be risk-on when risk metrics fall');
  });

  it('overall direction is mixed when risk signals are balanced', () => {
    // VIX goes up (risk-off), HY spread goes down (risk-on) — balanced
    const prev = makeData({
      fred: [
        fredEntry('VIXCLS', 20),
        fredEntry('BAMLH0A0HYM2', 400),
      ],
    });
    const curr = makeData({
      fred: [
        fredEntry('VIXCLS', 22.5),   // +12.5 % up — escalated (risk-off)
        fredEntry('BAMLH0A0HYM2', 350), // -12.5 % down — deescalated (risk-on)
      ],
    });

    const result = computeDelta(curr, prev);
    assert.equal(result.summary.direction, 'mixed');
  });

  // ─── Empty / minimal data ─────────────────────────────────────────────────

  it('empty/minimal data ({}) does not crash', () => {
    assert.doesNotThrow(() => computeDelta({}, {}));
    const result = computeDelta({}, {});
    assert.ok(result !== null);
    assert.ok(Array.isArray(result.signals.escalated));
  });

  it('summary totalChanges reflects sum of new + escalated + deescalated', () => {
    const prev = makeData({ fred: [fredEntry('VIXCLS', 20)] });
    const curr = makeData({ fred: [fredEntry('VIXCLS', 30)] }); // +50 % — escalated

    const result = computeDelta(curr, prev);
    const expected =
      result.signals.new.length +
      result.signals.escalated.length +
      result.signals.deescalated.length;
    assert.equal(result.summary.totalChanges, expected);
  });

  // ─── Exported constants ───────────────────────────────────────────────────

  it('DEFAULT_NUMERIC_THRESHOLDS exports an object with vix key', () => {
    assert.ok(typeof DEFAULT_NUMERIC_THRESHOLDS === 'object');
    assert.ok('vix' in DEFAULT_NUMERIC_THRESHOLDS);
    assert.equal(DEFAULT_NUMERIC_THRESHOLDS.vix, 5);
  });

  it('DEFAULT_COUNT_THRESHOLDS exports an object with thermal_total key', () => {
    assert.ok(typeof DEFAULT_COUNT_THRESHOLDS === 'object');
    assert.ok('thermal_total' in DEFAULT_COUNT_THRESHOLDS);
    assert.equal(DEFAULT_COUNT_THRESHOLDS.thermal_total, 500);
  });
});
