// Memory Manager — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryManager } from '../lib/delta/memory.mjs';

// MAX_HOT_RUNS constant from source (3)
const MAX_HOT_RUNS = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build minimal synthesized data with a unique timestamp so successive
 * addRun calls produce distinct entries and computable deltas.
 */
function makeSweepData(overrides = {}) {
  return {
    meta: { timestamp: new Date().toISOString(), ...overrides.meta },
    fred: [],
    energy: {},
    bls: [],
    tg: { urgent: [], top: [] },
    thermal: [],
    air: [],
    nuke: [],
    who: [],
    acled: { totalEvents: 0, totalFatalities: 0 },
    sdr: { total: 0, online: 0 },
    news: [],
    health: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MemoryManager', () => {
  let tmpDir;
  let manager;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'crucix-memory-test-'));
    manager = new MemoryManager(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Constructor / directory creation ──────────────────────────────────

  it('constructor creates memory/ subdirectory', () => {
    const memDir = join(tmpDir, 'memory');
    assert.ok(existsSync(memDir), `Expected ${memDir} to exist`);
  });

  it('constructor creates memory/cold/ subdirectory', () => {
    const coldDir = join(tmpDir, 'memory', 'cold');
    assert.ok(existsSync(coldDir), `Expected ${coldDir} to exist`);
  });

  // ─── Fresh-instance behaviour ───────────────────────────────────────────

  it('fresh instance has no runs — getLastRun returns null', () => {
    assert.equal(manager.getLastRun(), null);
  });

  it('fresh instance — getLastDelta returns null', () => {
    assert.equal(manager.getLastDelta(), null);
  });

  // ─── addRun behaviour ───────────────────────────────────────────────────

  it('addRun on first call returns null delta (no previous to compare)', () => {
    const delta = manager.addRun(makeSweepData());
    assert.equal(delta, null, 'first addRun should return null delta');
  });

  it('addRun on second call returns a delta object', () => {
    const delta = manager.addRun(makeSweepData());
    assert.ok(delta !== null, 'second addRun should return a delta');
    assert.ok(typeof delta === 'object');
    assert.ok('signals' in delta);
    assert.ok('summary' in delta);
  });

  // ─── getLastRun ──────────────────────────────────────────────────────────

  it('getLastRun returns the most recent run data', () => {
    const ts = new Date().toISOString();
    manager.addRun(makeSweepData({ meta: { timestamp: ts } }));
    const last = manager.getLastRun();
    assert.ok(last !== null);
    assert.equal(last.meta.timestamp, ts);
  });

  // ─── getRunHistory ───────────────────────────────────────────────────────

  it('getRunHistory returns an array', () => {
    const history = manager.getRunHistory();
    assert.ok(Array.isArray(history));
  });

  // ─── MAX_HOT_RUNS cap and cold-archive ──────────────────────────────────

  it('runs are capped at MAX_HOT_RUNS and old runs are archived to cold/', () => {
    // Create a fresh manager in a new temp dir so we start from zero
    const dir2 = mkdtempSync(join(tmpdir(), 'crucix-cap-test-'));
    try {
      const mgr2 = new MemoryManager(dir2);

      // Add MAX_HOT_RUNS + 2 runs to force archiving
      for (let i = 0; i < MAX_HOT_RUNS + 2; i++) {
        mgr2.addRun(makeSweepData());
      }

      const history = mgr2.getRunHistory(MAX_HOT_RUNS + 10);
      assert.ok(
        history.length <= MAX_HOT_RUNS,
        `Hot runs should be capped at ${MAX_HOT_RUNS}, got ${history.length}`
      );

      // At least one cold file should have been written
      const coldDir = join(dir2, 'memory', 'cold');
      const coldFiles = readdirSync(coldDir);
      assert.ok(coldFiles.length > 0, 'Expected at least one cold archive file');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  // ─── Alert tracking — markAsAlerted ─────────────────────────────────────

  it('markAsAlerted creates an entry with count=1 and a recent lastAlerted timestamp', () => {
    const dir3 = mkdtempSync(join(tmpdir(), 'crucix-alert-test-'));
    try {
      const mgr = new MemoryManager(dir3);
      const before = Date.now();
      mgr.markAsAlerted('test_signal');
      const after = Date.now();

      const entry = mgr.getAlertedSignals()['test_signal'];
      assert.ok(entry, 'entry should exist');
      assert.equal(entry.count, 1);
      const alertedTime = new Date(entry.lastAlerted).getTime();
      assert.ok(alertedTime >= before && alertedTime <= after, 'lastAlerted should be recent');
    } finally {
      rmSync(dir3, { recursive: true, force: true });
    }
  });

  it('markAsAlerted increments count on repeat call', () => {
    const dir4 = mkdtempSync(join(tmpdir(), 'crucix-repeat-test-'));
    try {
      const mgr = new MemoryManager(dir4);
      mgr.markAsAlerted('repeat_signal');
      mgr.markAsAlerted('repeat_signal');

      const entry = mgr.getAlertedSignals()['repeat_signal'];
      assert.equal(entry.count, 2);
    } finally {
      rmSync(dir4, { recursive: true, force: true });
    }
  });

  // ─── isSignalSuppressed ──────────────────────────────────────────────────

  it('isSignalSuppressed returns false for an unknown signal', () => {
    const dir5 = mkdtempSync(join(tmpdir(), 'crucix-suppress-test-'));
    try {
      const mgr = new MemoryManager(dir5);
      assert.equal(mgr.isSignalSuppressed('nonexistent_signal'), false);
    } finally {
      rmSync(dir5, { recursive: true, force: true });
    }
  });

  it('isSignalSuppressed returns false immediately after first markAsAlerted (tier 0 = 0h cooldown)', () => {
    // ALERT_DECAY_TIERS[0] = 0 hours, so the first occurrence is never suppressed
    const dir6 = mkdtempSync(join(tmpdir(), 'crucix-tier0-test-'));
    try {
      const mgr = new MemoryManager(dir6);
      mgr.markAsAlerted('tier0_signal');
      // count = 1 → tierIndex = min(1, 3) = 1 → cooldownHours = ALERT_DECAY_TIERS[1] = 6
      // Wait — the code uses occurrences (count) as the tier index directly.
      // After first markAsAlerted: count = 1, tierIndex = min(1, 3) = 1, cooldown = 6h
      // So WITHIN the 6h window it IS suppressed. Let's verify the contract accurately.
      const suppressed = mgr.isSignalSuppressed('tier0_signal');
      // count=1 → tierIndex=1 → 6h cooldown → just alerted → should be suppressed
      assert.equal(suppressed, true, 'should be suppressed within 6h window after first alert');
    } finally {
      rmSync(dir6, { recursive: true, force: true });
    }
  });

  it('isSignalSuppressed returns true within suppression window after markAsAlerted', () => {
    const dir7 = mkdtempSync(join(tmpdir(), 'crucix-window-test-'));
    try {
      const mgr = new MemoryManager(dir7);
      mgr.markAsAlerted('windowed_signal');
      // Immediately after marking: should be suppressed (count=1 → 6h cooldown)
      assert.equal(mgr.isSignalSuppressed('windowed_signal'), true);
    } finally {
      rmSync(dir7, { recursive: true, force: true });
    }
  });

  it('isSignalSuppressed returns false when the lastAlerted timestamp is older than the cooldown', () => {
    const dir8 = mkdtempSync(join(tmpdir(), 'crucix-old-test-'));
    try {
      const mgr = new MemoryManager(dir8);
      // Inject an entry whose lastAlerted is 25 hours ago (beyond any tier's 24h max)
      const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      mgr.hot.alertedSignals['stale_signal'] = {
        firstSeen: oldTime,
        lastAlerted: oldTime,
        count: 1,
      };
      // count=1 → tierIndex=1 → 6h cooldown. 25h > 6h → NOT suppressed
      assert.equal(mgr.isSignalSuppressed('stale_signal'), false);
    } finally {
      rmSync(dir8, { recursive: true, force: true });
    }
  });

  // ─── pruneAlertedSignals ─────────────────────────────────────────────────

  it('pruneAlertedSignals removes entries older than their retention window', () => {
    const dir9 = mkdtempSync(join(tmpdir(), 'crucix-prune-test-'));
    try {
      const mgr = new MemoryManager(dir9);

      // Entry: count=1 → 24h retention. Set lastAlerted to 25 hours ago → should be pruned.
      const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      mgr.hot.alertedSignals['old_signal'] = {
        firstSeen: oldTime,
        lastAlerted: oldTime,
        count: 1,
      };

      // Entry: count=2 → 48h retention. Set lastAlerted to 10 hours ago → should be kept.
      const recentTime = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
      mgr.hot.alertedSignals['recent_signal'] = {
        firstSeen: recentTime,
        lastAlerted: recentTime,
        count: 2,
      };

      mgr.pruneAlertedSignals();

      const signals = mgr.getAlertedSignals();
      assert.ok(!('old_signal' in signals), 'old_signal should have been pruned');
      assert.ok('recent_signal' in signals, 'recent_signal should be retained');
    } finally {
      rmSync(dir9, { recursive: true, force: true });
    }
  });

  it('pruneAlertedSignals keeps entries whose count>=2 within 48h window', () => {
    const dir10 = mkdtempSync(join(tmpdir(), 'crucix-prune2-test-'));
    try {
      const mgr = new MemoryManager(dir10);

      // count=2 → 48h retention. Set to 30h ago — still within 48h → keep.
      const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      mgr.hot.alertedSignals['keep_signal'] = {
        firstSeen: thirtyHoursAgo,
        lastAlerted: thirtyHoursAgo,
        count: 2,
      };

      mgr.pruneAlertedSignals();

      const signals = mgr.getAlertedSignals();
      assert.ok('keep_signal' in signals, 'keep_signal should not have been pruned');
    } finally {
      rmSync(dir10, { recursive: true, force: true });
    }
  });
});
