// clean.test.mjs — Tests for scripts/clean.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

describe('clean script', () => {
  it('script syntax is valid', () => {
    execSync('node --check scripts/clean.mjs', {
      cwd: '/Users/cspenn/Documents/github/Crucix',
    });
    assert.ok(true);
  });
});
