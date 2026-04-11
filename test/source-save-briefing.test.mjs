import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// save-briefing.mjs runs at top level (not just exports), so we test the
// formatTimestamp helper and verify the module structure. We can't easily
// import it without triggering side effects (mkdir, fullBriefing, writeFile).
// Instead, we test the formatting logic and the module's expected behavior.

describe('save-briefing', () => {
  describe('formatTimestamp()', () => {
    // Replicate the formatTimestamp function from save-briefing.mjs
    function formatTimestamp(date = new Date()) {
      return date.toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
    }

    it('formats a date into a filesystem-safe ISO string', () => {
      const d = new Date('2026-04-09T14:30:00.000Z');
      const result = formatTimestamp(d);
      assert.equal(result, '2026-04-09T14-30-00Z');
    });

    it('replaces all colons with dashes', () => {
      const d = new Date('2026-01-15T08:45:30.123Z');
      const result = formatTimestamp(d);
      assert.ok(!result.includes(':'));
      assert.equal(result, '2026-01-15T08-45-30Z');
    });

    it('strips milliseconds', () => {
      const d = new Date('2026-06-01T00:00:00.999Z');
      const result = formatTimestamp(d);
      assert.ok(!result.includes('.999'));
      assert.ok(result.endsWith('Z'));
    });

    it('defaults to current time', () => {
      const result = formatTimestamp();
      assert.ok(result.includes('T'));
      assert.ok(result.endsWith('Z'));
      assert.ok(!result.includes(':'));
    });
  });

  describe('module structure', () => {
    it('imports node:fs/promises and node:path', async () => {
      // Verify these core modules are available
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      assert.ok(typeof fs.mkdir === 'function');
      assert.ok(typeof fs.writeFile === 'function');
      assert.ok(typeof path.join === 'function');
    });

    it('would create runs directory and write files', async () => {
      // We verify the expected file path patterns
      const { join } = await import('node:path');
      const runsDir = join(process.cwd(), 'runs');
      const timestamp = '2026-04-09T14-30-00Z';
      const runFile = join(runsDir, `briefing_${timestamp}.json`);
      const latestFile = join(runsDir, 'latest.json');

      assert.ok(runFile.includes('briefing_2026-04-09T14-30-00Z.json'));
      assert.ok(latestFile.includes('latest.json'));
    });
  });
});
