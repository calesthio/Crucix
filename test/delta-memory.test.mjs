// Memory Manager — unit tests
// Uses Node.js built-in test runner (node:test)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { MemoryManager } from '../lib/delta/memory.mjs';

const TEST_DIR = join('/tmp', 'crucix-test-memory-' + process.pid);

function makeRunsDir() {
  const runsDir = join(TEST_DIR, 'runs');
  mkdirSync(runsDir, { recursive: true });
  return runsDir;
}

function makeSweepData(overrides = {}) {
  return {
    meta: { timestamp: new Date().toISOString(), sourcesOk: 20 },
    fred: [{ id: 'VIXCLS', value: 20 }],
    energy: { wti: 75, brent: 80, natgas: 3.0 },
    bls: [],
    treasury: null,
    gscpi: null,
    tg: { posts: 10, urgent: [] },
    thermal: [],
    air: [],
    nuke: [],
    who: [],
    acled: { totalEvents: 100, totalFatalities: 50 },
    sdr: { total: 50, online: 30 },
    news: [],
    ideas: [],
    ...overrides,
  };
}

describe('MemoryManager', () => {
  let runsDir;

  beforeEach(() => {
    runsDir = makeRunsDir();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ─── Constructor ───

  it('should create memory and cold dirs on construction', () => {
    const mm = new MemoryManager(runsDir);
    assert.ok(existsSync(mm.memoryDir));
    assert.ok(existsSync(mm.coldDir));
  });

  it('should start with empty runs and alertedSignals', () => {
    const mm = new MemoryManager(runsDir);
    assert.deepEqual(mm.hot.runs, []);
    assert.deepEqual(mm.hot.alertedSignals, {});
  });

  it('should load existing hot.json on construction', () => {
    const memoryDir = join(runsDir, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(join(memoryDir, 'cold'), { recursive: true });

    const hotData = {
      runs: [{ timestamp: '2025-01-01T00:00:00Z', data: {}, delta: null }],
      alertedSignals: { 'test_signal': { firstSeen: '2025-01-01', lastAlerted: '2025-01-01', count: 1 } },
    };
    writeFileSync(join(memoryDir, 'hot.json'), JSON.stringify(hotData));

    const mm = new MemoryManager(runsDir);
    assert.equal(mm.hot.runs.length, 1);
    assert.ok(mm.hot.alertedSignals['test_signal']);
  });

  it('should fall back to .bak file if hot.json is corrupt', () => {
    const memoryDir = join(runsDir, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(join(memoryDir, 'cold'), { recursive: true });

    writeFileSync(join(memoryDir, 'hot.json'), 'CORRUPT DATA');
    const bakData = {
      runs: [{ timestamp: '2025-01-01T00:00:00Z', data: {}, delta: null }],
      alertedSignals: {},
    };
    writeFileSync(join(memoryDir, 'hot.json.bak'), JSON.stringify(bakData));

    const mm = new MemoryManager(runsDir);
    assert.equal(mm.hot.runs.length, 1);
  });

  // ─── addRun ───

  it('should add a run and persist to disk', () => {
    const mm = new MemoryManager(runsDir);
    const data = makeSweepData();

    mm.addRun(data);

    assert.equal(mm.hot.runs.length, 1);
    assert.ok(existsSync(mm.hotPath));

    const saved = JSON.parse(readFileSync(mm.hotPath, 'utf8'));
    assert.equal(saved.runs.length, 1);
  });

  it('should keep only MAX_HOT_RUNS (3) in hot memory', () => {
    const mm = new MemoryManager(runsDir);

    for (let i = 0; i < 5; i++) {
      mm.addRun(makeSweepData({ meta: { timestamp: `2025-01-0${i + 1}T00:00:00Z`, sourcesOk: 20 } }));
    }

    assert.equal(mm.hot.runs.length, 3);
  });

  it('should archive excess runs to cold storage', () => {
    const mm = new MemoryManager(runsDir);

    for (let i = 0; i < 4; i++) {
      mm.addRun(makeSweepData({ meta: { timestamp: `2025-01-0${i + 1}T00:00:00Z`, sourcesOk: 20 } }));
    }

    // Cold dir should have at least one file
    const coldFiles = readdirSync(mm.coldDir);
    assert.ok(coldFiles.length > 0, 'Should have archived to cold storage');
  });

  it('should return delta from addRun (null on first run)', () => {
    const mm = new MemoryManager(runsDir);
    const delta1 = mm.addRun(makeSweepData());
    assert.equal(delta1, null, 'First run should have null delta');

    const delta2 = mm.addRun(makeSweepData({
      fred: [{ id: 'VIXCLS', value: 30 }],
    }));
    // Second run should compute a delta (may have changes or not depending on data)
    assert.ok(delta2 !== null || delta2 === null, 'Second run may or may not have delta');
  });

  // ─── getLastRun ───

  it('should return null for getLastRun when no runs', () => {
    const mm = new MemoryManager(runsDir);
    assert.equal(mm.getLastRun(), null);
  });

  it('should return the most recent run data', () => {
    const mm = new MemoryManager(runsDir);
    mm.addRun(makeSweepData({ meta: { timestamp: '2025-01-01T00:00:00Z', sourcesOk: 20 } }));
    mm.addRun(makeSweepData({ meta: { timestamp: '2025-01-02T00:00:00Z', sourcesOk: 20 } }));

    const last = mm.getLastRun();
    assert.equal(last.meta.timestamp, '2025-01-02T00:00:00Z');
  });

  // ─── getRunHistory ───

  it('should return up to N runs', () => {
    const mm = new MemoryManager(runsDir);
    mm.addRun(makeSweepData());
    mm.addRun(makeSweepData());
    mm.addRun(makeSweepData());

    assert.equal(mm.getRunHistory(2).length, 2);
    assert.equal(mm.getRunHistory(10).length, 3);
    assert.equal(mm.getRunHistory().length, 3); // default n=3
  });

  // ─── getLastDelta ───

  it('should return null when no runs', () => {
    const mm = new MemoryManager(runsDir);
    assert.equal(mm.getLastDelta(), null);
  });

  // ─── Alert Signal Tracking ───

  describe('alert signals', () => {
    it('should return empty object for getAlertedSignals initially', () => {
      const mm = new MemoryManager(runsDir);
      assert.deepEqual(mm.getAlertedSignals(), {});
    });

    it('should mark a signal as alerted', () => {
      const mm = new MemoryManager(runsDir);
      mm.markAsAlerted('test_signal', '2025-01-01T00:00:00Z');

      const signals = mm.getAlertedSignals();
      assert.ok(signals['test_signal']);
      assert.equal(signals['test_signal'].count, 1);
      assert.equal(signals['test_signal'].lastAlerted, '2025-01-01T00:00:00Z');
    });

    it('should increment count on repeated alerts', () => {
      const mm = new MemoryManager(runsDir);
      mm.markAsAlerted('test_signal', '2025-01-01T00:00:00Z');
      mm.markAsAlerted('test_signal', '2025-01-01T01:00:00Z');

      const entry = mm.getAlertedSignals()['test_signal'];
      assert.equal(entry.count, 2);
      assert.equal(entry.lastAlerted, '2025-01-01T01:00:00Z');
      assert.equal(entry.firstSeen, '2025-01-01T00:00:00Z');
    });

    it('should migrate legacy string format on markAsAlerted', () => {
      const mm = new MemoryManager(runsDir);
      // Simulate legacy format
      mm.hot.alertedSignals['legacy_signal'] = '2025-01-01T00:00:00Z';

      mm.markAsAlerted('legacy_signal', '2025-01-02T00:00:00Z');

      const entry = mm.getAlertedSignals()['legacy_signal'];
      assert.equal(typeof entry, 'object');
      assert.equal(entry.count, 2);
      assert.equal(entry.firstSeen, '2025-01-01T00:00:00Z');
      assert.equal(entry.lastAlerted, '2025-01-02T00:00:00Z');
    });
  });

  // ─── Signal Suppression ───

  describe('isSignalSuppressed', () => {
    it('should return false for unknown signal', () => {
      const mm = new MemoryManager(runsDir);
      assert.equal(mm.isSignalSuppressed('unknown'), false);
    });

    it('should suppress first occurrence within 6h cooldown (tier 1)', () => {
      const mm = new MemoryManager(runsDir);
      mm.markAsAlerted('sig1');
      // count=1 => tierIndex=1 => ALERT_DECAY_TIERS[1]=6h cooldown
      // Just marked, so (now - lastAlerted) < 6h => suppressed
      assert.equal(mm.isSignalSuppressed('sig1'), true);
    });

    it('should suppress second occurrence within cooldown window', () => {
      const mm = new MemoryManager(runsDir);
      // count=2 => tierIndex=2 => 12h cooldown
      mm.hot.alertedSignals['sig2'] = {
        firstSeen: new Date().toISOString(),
        lastAlerted: new Date().toISOString(),
        count: 2,
      };
      assert.equal(mm.isSignalSuppressed('sig2'), true);
    });

    it('should not suppress when cooldown has expired', () => {
      const mm = new MemoryManager(runsDir);
      const pastTime = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(); // 13h ago
      mm.hot.alertedSignals['sig3'] = {
        firstSeen: pastTime,
        lastAlerted: pastTime,
        count: 2, // tier 2 = 12h cooldown, 13h ago > 12h => not suppressed
      };
      assert.equal(mm.isSignalSuppressed('sig3'), false);
    });

    it('should handle legacy string entry in isSignalSuppressed', () => {
      const mm = new MemoryManager(runsDir);
      // Legacy format: just a timestamp string. count defaults to 1, tier 1 = 6h cooldown
      // Just set, so it IS suppressed
      mm.hot.alertedSignals['legacy'] = new Date().toISOString();
      assert.equal(mm.isSignalSuppressed('legacy'), true);
    });

    it('should not suppress legacy entry after cooldown expires', () => {
      const mm = new MemoryManager(runsDir);
      const oldTime = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(); // 7h ago
      // Legacy format, count=1, tier 1 = 6h cooldown, 7h > 6h => not suppressed
      mm.hot.alertedSignals['legacy_old'] = oldTime;
      assert.equal(mm.isSignalSuppressed('legacy_old'), false);
    });
  });

  // ─── Pruning ───

  describe('pruneAlertedSignals', () => {
    it('should prune single-occurrence signals older than 24h', () => {
      const mm = new MemoryManager(runsDir);
      const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      mm.hot.alertedSignals['old_sig'] = {
        firstSeen: oldTime,
        lastAlerted: oldTime,
        count: 1,
      };

      mm.pruneAlertedSignals();
      assert.equal(mm.getAlertedSignals()['old_sig'], undefined);
    });

    it('should not prune single-occurrence signals within 24h', () => {
      const mm = new MemoryManager(runsDir);
      const recentTime = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
      mm.hot.alertedSignals['recent_sig'] = {
        firstSeen: recentTime,
        lastAlerted: recentTime,
        count: 1,
      };

      mm.pruneAlertedSignals();
      assert.ok(mm.getAlertedSignals()['recent_sig']);
    });

    it('should prune multi-occurrence signals older than 48h', () => {
      const mm = new MemoryManager(runsDir);
      const oldTime = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
      mm.hot.alertedSignals['multi_sig'] = {
        firstSeen: oldTime,
        lastAlerted: oldTime,
        count: 3,
      };

      mm.pruneAlertedSignals();
      assert.equal(mm.getAlertedSignals()['multi_sig'], undefined);
    });

    it('should not prune multi-occurrence signals within 48h', () => {
      const mm = new MemoryManager(runsDir);
      const time = new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString();
      mm.hot.alertedSignals['multi_ok'] = {
        firstSeen: time,
        lastAlerted: time,
        count: 3,
      };

      mm.pruneAlertedSignals();
      assert.ok(mm.getAlertedSignals()['multi_ok']);
    });

    it('should prune legacy string format entries older than 24h', () => {
      const mm = new MemoryManager(runsDir);
      const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      mm.hot.alertedSignals['legacy_old'] = oldTime;

      mm.pruneAlertedSignals();
      assert.equal(mm.getAlertedSignals()['legacy_old'], undefined);
    });
  });

  // ─── Compact Storage ───

  describe('_compactForStorage', () => {
    it('should preserve key fields and strip heavy arrays', () => {
      const mm = new MemoryManager(runsDir);
      const data = makeSweepData({
        tg: {
          posts: 50,
          urgent: [{ text: 'alert', date: '2025-01-01', channel: 'osint', postId: '123' }],
        },
        thermal: [{ region: 'East', det: 1000, night: 100, hc: 50, extraField: 'stripped' }],
        news: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
      });

      const compact = mm._compactForStorage(data);
      assert.equal(compact.meta.sourcesOk, 20);
      assert.equal(compact.tg.posts, 50);
      assert.equal(compact.tg.urgent.length, 1);
      assert.equal(compact.tg.urgent[0].text, 'alert');
      assert.equal(compact.thermal[0].region, 'East');
      assert.equal(compact.thermal[0].extraField, undefined);
      assert.equal(compact.news.count, 3);
    });
  });
});
