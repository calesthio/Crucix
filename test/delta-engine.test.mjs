// Delta Engine — unit tests
// Uses Node.js built-in test runner (node:test)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDelta, DEFAULT_NUMERIC_THRESHOLDS, DEFAULT_COUNT_THRESHOLDS } from '../lib/delta/engine.mjs';

// ─── Helpers ───

function makeSweep(overrides = {}) {
  return {
    meta: { timestamp: new Date().toISOString(), sourcesOk: 20 },
    fred: [
      { id: 'VIXCLS', value: 20 },
      { id: 'BAMLH0A0HYM2', value: 4 },
      { id: 'T10Y2Y', value: 0.5 },
      { id: 'DFF', value: 5.25 },
      { id: 'DGS10', value: 4.5 },
      { id: 'DTWEXBGS', value: 105 },
      { id: 'MORTGAGE30US', value: 7.0 },
    ],
    energy: { wti: 75, brent: 80, natgas: 3.0 },
    bls: [{ id: 'LNS14000000', value: 3.8 }],
    tg: { posts: 50, urgent: [] },
    thermal: [{ region: 'East', det: 1000, night: 100, hc: 50 }],
    air: [{ region: 'EU', total: 200 }],
    who: [],
    acled: { totalEvents: 100, totalFatalities: 50 },
    sdr: { total: 50, online: 30 },
    news: [{ title: 'a' }, { title: 'b' }],
    nuke: [{ site: 'A', anom: false, cpm: 10 }],
    health: [],
    ...overrides,
  };
}

// ─── Null/Edge Cases ───

describe('computeDelta — edge cases', () => {
  it('should return null when previous is null (first run)', () => {
    const result = computeDelta(makeSweep(), null);
    assert.equal(result, null);
  });

  it('should return null when current is null', () => {
    const result = computeDelta(null, makeSweep());
    assert.equal(result, null);
  });

  it('should return null when both are null', () => {
    assert.equal(computeDelta(null, null), null);
  });
});

// ─── No Changes ───

describe('computeDelta — no changes', () => {
  it('should report zero total changes when data is identical', () => {
    const sweep = makeSweep();
    const delta = computeDelta(sweep, sweep);
    assert.equal(delta.summary.totalChanges, 0);
    assert.equal(delta.summary.criticalChanges, 0);
    assert.ok(delta.signals.unchanged.length > 0);
    assert.equal(delta.signals.new.length, 0);
    assert.equal(delta.signals.escalated.length, 0);
    assert.equal(delta.signals.deescalated.length, 0);
  });
});

// ─── Numeric Metric Changes ───

describe('computeDelta — numeric metrics', () => {
  it('should detect VIX escalation above threshold', () => {
    const prev = makeSweep();
    const curr = makeSweep({
      fred: [
        { id: 'VIXCLS', value: 22 }, // +10% > 5% threshold
        { id: 'BAMLH0A0HYM2', value: 4 },
        { id: 'T10Y2Y', value: 0.5 },
        { id: 'DFF', value: 5.25 },
        { id: 'DGS10', value: 4.5 },
        { id: 'DTWEXBGS', value: 105 },
        { id: 'MORTGAGE30US', value: 7.0 },
      ],
    });

    const delta = computeDelta(curr, prev);
    const vixSignal = delta.signals.escalated.find(s => s.key === 'vix');
    assert.ok(vixSignal, 'VIX should be in escalated');
    assert.equal(vixSignal.direction, 'up');
    assert.equal(vixSignal.from, 20);
    assert.equal(vixSignal.to, 22);
    assert.ok(vixSignal.pctChange === 10);
  });

  it('should detect deescalation when metric drops', () => {
    const prev = makeSweep();
    const curr = makeSweep({
      energy: { wti: 70, brent: 80, natgas: 3.0 }, // WTI -6.67% > 3% threshold
    });

    const delta = computeDelta(curr, prev);
    const wtiSignal = delta.signals.deescalated.find(s => s.key === 'wti');
    assert.ok(wtiSignal, 'WTI should be deescalated');
    assert.equal(wtiSignal.direction, 'down');
  });

  it('should classify severity as critical for extreme changes', () => {
    const prev = makeSweep();
    const curr = makeSweep({
      fred: [
        { id: 'VIXCLS', value: 35 }, // +75%, threshold=5, 75 > 5*3=15 => critical
        { id: 'BAMLH0A0HYM2', value: 4 },
        { id: 'T10Y2Y', value: 0.5 },
        { id: 'DFF', value: 5.25 },
        { id: 'DGS10', value: 4.5 },
        { id: 'DTWEXBGS', value: 105 },
        { id: 'MORTGAGE30US', value: 7.0 },
      ],
    });

    const delta = computeDelta(curr, prev);
    const vixSignal = delta.signals.escalated.find(s => s.key === 'vix');
    assert.equal(vixSignal.severity, 'critical');
  });

  it('should not flag changes within threshold', () => {
    const prev = makeSweep();
    const curr = makeSweep({
      fred: [
        { id: 'VIXCLS', value: 20.5 }, // +2.5% < 5% threshold
        { id: 'BAMLH0A0HYM2', value: 4 },
        { id: 'T10Y2Y', value: 0.5 },
        { id: 'DFF', value: 5.25 },
        { id: 'DGS10', value: 4.5 },
        { id: 'DTWEXBGS', value: 105 },
        { id: 'MORTGAGE30US', value: 7.0 },
      ],
    });

    const delta = computeDelta(curr, prev);
    const vixEsc = delta.signals.escalated.find(s => s.key === 'vix');
    const vixDeesc = delta.signals.deescalated.find(s => s.key === 'vix');
    assert.equal(vixEsc, undefined);
    assert.equal(vixDeesc, undefined);
    assert.ok(delta.signals.unchanged.includes('vix'));
  });
});

// ─── Count Metric Changes ───

describe('computeDelta — count metrics', () => {
  it('should detect conflict event escalation', () => {
    const prev = makeSweep();
    const curr = makeSweep({ acled: { totalEvents: 110, totalFatalities: 50 } }); // +10 >= 5 threshold

    const delta = computeDelta(curr, prev);
    const conflictSignal = delta.signals.escalated.find(s => s.key === 'conflict_events');
    assert.ok(conflictSignal);
    assert.equal(conflictSignal.change, 10);
    assert.equal(conflictSignal.direction, 'up');
  });

  it('should not flag count changes below threshold', () => {
    const prev = makeSweep();
    const curr = makeSweep({ acled: { totalEvents: 103, totalFatalities: 50 } }); // +3 < 5 threshold

    const delta = computeDelta(curr, prev);
    const sig = delta.signals.escalated.find(s => s.key === 'conflict_events');
    assert.equal(sig, undefined);
  });
});

// ─── Telegram Urgent Post Dedup ───

describe('computeDelta — TG urgent dedup', () => {
  it('should detect new urgent posts', () => {
    const prev = makeSweep({ tg: { posts: 10, urgent: [] } });
    const curr = makeSweep({
      tg: {
        posts: 12,
        urgent: [{ text: 'Breaking: missile launch detected', date: '2025-01-01', postId: '123', channel: 'osint' }],
      },
    });

    const delta = computeDelta(curr, prev);
    const newPost = delta.signals.new.find(s => s.key.startsWith('tg_urgent:'));
    assert.ok(newPost, 'Should detect new urgent post');
    assert.match(newPost.text, /missile/);
  });

  it('should not flag duplicate posts (same postId)', () => {
    const post = { text: 'Breaking news', date: '2025-01-01', postId: '123', channel: 'osint' };
    const prev = makeSweep({ tg: { posts: 10, urgent: [post] } });
    const curr = makeSweep({ tg: { posts: 10, urgent: [post] } });

    const delta = computeDelta(curr, prev);
    const newPosts = delta.signals.new.filter(s => s.key.startsWith('tg_urgent:'));
    assert.equal(newPosts.length, 0);
  });

  it('should dedup across priorRuns', () => {
    const post = { text: 'Alert post', date: '2025-01-01', postId: '456', channel: 'intel' };
    const prev = makeSweep({ tg: { posts: 10, urgent: [] } });
    const priorRuns = [makeSweep({ tg: { posts: 10, urgent: [post] } })];
    const curr = makeSweep({ tg: { posts: 11, urgent: [post] } });

    const delta = computeDelta(curr, prev, {}, priorRuns);
    const newPosts = delta.signals.new.filter(s => s.key.startsWith('tg_urgent:'));
    assert.equal(newPosts.length, 0, 'Should dedup against priorRuns');
  });
});

// ─── Nuclear Anomaly ───

describe('computeDelta — nuclear anomaly', () => {
  it('should detect new nuclear anomaly', () => {
    const prev = makeSweep({ nuke: [{ site: 'A', anom: false, cpm: 10 }] });
    const curr = makeSweep({ nuke: [{ site: 'A', anom: true, cpm: 50 }] });

    const delta = computeDelta(curr, prev);
    const nukeSignal = delta.signals.new.find(s => s.key === 'nuke_anomaly');
    assert.ok(nukeSignal);
    assert.equal(nukeSignal.severity, 'critical');
  });

  it('should detect nuclear anomaly resolution', () => {
    const prev = makeSweep({ nuke: [{ site: 'A', anom: true, cpm: 50 }] });
    const curr = makeSweep({ nuke: [{ site: 'A', anom: false, cpm: 10 }] });

    const delta = computeDelta(curr, prev);
    const resolved = delta.signals.deescalated.find(s => s.key === 'nuke_anomaly');
    assert.ok(resolved);
    assert.equal(resolved.direction, 'resolved');
  });

  it('should not flag when no anomaly state change', () => {
    const prev = makeSweep({ nuke: [{ site: 'A', anom: false, cpm: 10 }] });
    const curr = makeSweep({ nuke: [{ site: 'A', anom: false, cpm: 12 }] });

    const delta = computeDelta(curr, prev);
    const nukeNew = delta.signals.new.find(s => s.key === 'nuke_anomaly');
    const nukeDeesc = delta.signals.deescalated.find(s => s.key === 'nuke_anomaly');
    assert.equal(nukeNew, undefined);
    assert.equal(nukeDeesc, undefined);
  });
});

// ─── Source Degradation ───

describe('computeDelta — source degradation', () => {
  it('should detect when multiple new sources fail', () => {
    const prev = makeSweep({ health: [{ src: 'a', err: null }] });
    const curr = makeSweep({
      health: [
        { src: 'a', err: 'timeout' },
        { src: 'b', err: 'timeout' },
        { src: 'c', err: 'timeout' },
        { src: 'd', err: 'timeout' },
      ],
    });

    const delta = computeDelta(curr, prev);
    const degradation = delta.signals.new.find(s => s.key === 'source_degradation');
    assert.ok(degradation, 'Should detect source degradation');
    assert.match(degradation.reason, /additional sources failing/);
  });

  it('should not flag if only 1-2 more sources fail', () => {
    const prev = makeSweep({ health: [] });
    const curr = makeSweep({ health: [{ src: 'a', err: 'timeout' }, { src: 'b', err: 'timeout' }] });

    const delta = computeDelta(curr, prev);
    const degradation = delta.signals.new.find(s => s.key === 'source_degradation');
    assert.equal(degradation, undefined);
  });
});

// ─── Overall Direction ───

describe('computeDelta — direction', () => {
  it('should report risk-off when multiple risk keys escalate', () => {
    const prev = makeSweep();
    const curr = makeSweep({
      fred: [
        { id: 'VIXCLS', value: 30 },        // +50% escalation (risk key)
        { id: 'BAMLH0A0HYM2', value: 6 },   // +50% escalation (risk key)
        { id: 'T10Y2Y', value: 0.5 },
        { id: 'DFF', value: 5.25 },
        { id: 'DGS10', value: 4.5 },
        { id: 'DTWEXBGS', value: 105 },
        { id: 'MORTGAGE30US', value: 7.0 },
      ],
      acled: { totalEvents: 200, totalFatalities: 50 }, // escalation (risk key)
    });

    const delta = computeDelta(curr, prev);
    assert.equal(delta.summary.direction, 'risk-off');
  });

  it('should include timestamp and previous timestamp', () => {
    const prev = makeSweep();
    prev.meta.timestamp = '2025-01-01T00:00:00Z';
    const curr = makeSweep();
    curr.meta.timestamp = '2025-01-01T06:00:00Z';

    const delta = computeDelta(curr, prev);
    assert.equal(delta.timestamp, '2025-01-01T06:00:00Z');
    assert.equal(delta.previous, '2025-01-01T00:00:00Z');
  });
});

// ─── Threshold Overrides ───

describe('computeDelta — threshold overrides', () => {
  it('should respect custom numeric thresholds', () => {
    const prev = makeSweep();
    const curr = makeSweep({
      fred: [
        { id: 'VIXCLS', value: 21 }, // +5%, exactly at default threshold
        { id: 'BAMLH0A0HYM2', value: 4 },
        { id: 'T10Y2Y', value: 0.5 },
        { id: 'DFF', value: 5.25 },
        { id: 'DGS10', value: 4.5 },
        { id: 'DTWEXBGS', value: 105 },
        { id: 'MORTGAGE30US', value: 7.0 },
      ],
    });

    // With lower threshold, it should flag
    const delta = computeDelta(curr, prev, { numeric: { vix: 1 } });
    const vixSignal = delta.signals.escalated.find(s => s.key === 'vix');
    assert.ok(vixSignal, 'Should flag with lower threshold');
  });

  it('should respect custom count thresholds', () => {
    const prev = makeSweep();
    const curr = makeSweep({ acled: { totalEvents: 101, totalFatalities: 50 } }); // +1

    // Default threshold is 5, so +1 should not flag
    const delta1 = computeDelta(curr, prev);
    assert.equal(delta1.signals.escalated.find(s => s.key === 'conflict_events'), undefined);

    // With threshold=1, it should flag
    const delta2 = computeDelta(curr, prev, { count: { conflict_events: 1 } });
    assert.ok(delta2.signals.escalated.find(s => s.key === 'conflict_events'));
  });
});

// ─── Exported Thresholds ───

describe('exported thresholds', () => {
  it('should export DEFAULT_NUMERIC_THRESHOLDS with expected keys', () => {
    assert.ok(typeof DEFAULT_NUMERIC_THRESHOLDS === 'object');
    assert.ok('vix' in DEFAULT_NUMERIC_THRESHOLDS);
    assert.ok('wti' in DEFAULT_NUMERIC_THRESHOLDS);
    assert.ok('gold' in DEFAULT_NUMERIC_THRESHOLDS);
  });

  it('should export DEFAULT_COUNT_THRESHOLDS with expected keys', () => {
    assert.ok(typeof DEFAULT_COUNT_THRESHOLDS === 'object');
    assert.ok('urgent_posts' in DEFAULT_COUNT_THRESHOLDS);
    assert.ok('conflict_events' in DEFAULT_COUNT_THRESHOLDS);
  });
});
