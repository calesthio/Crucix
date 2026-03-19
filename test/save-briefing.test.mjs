// save-briefing.test.mjs — Minimal tests for apis/save-briefing.mjs
// The script executes API calls on import, so we only verify syntax.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

describe('save-briefing', () => {
  it('module syntax is valid (no parse errors)', () => {
    // Check the file can be parsed without syntax errors
    execSync('node --check apis/save-briefing.mjs', { cwd: '/Users/cspenn/Documents/github/Crucix' });
    assert.ok(true);
  });
});
