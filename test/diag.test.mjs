// diag.test.mjs — Tests for diag.mjs diagnostic script

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// diag.mjs exits with code 1 when express (or other deps) are missing,
// but it still prints Node/Platform info to stdout before failing.
// We use spawnSync so we can inspect stdout even on non-zero exit.
function runDiag() {
  return spawnSync('node', ['diag.mjs'], {
    cwd: '/Users/cspenn/Documents/github/Crucix',
    timeout: 15000,
    encoding: 'utf8',
  });
}

describe('diag', () => {
  it('outputs diagnostics to stdout', () => {
    const result = runDiag();
    const output = result.stdout || '';
    assert.ok(output.length > 0, 'Expected non-empty stdout from diag.mjs');
  });

  it('outputs Node version info', () => {
    const result = runDiag();
    const output = result.stdout || '';
    assert.ok(
      output.includes('Node version:'),
      `Expected "Node version:" in output, got: ${output.substring(0, 200)}`
    );
  });

  it('outputs platform info', () => {
    const result = runDiag();
    const output = result.stdout || '';
    assert.ok(
      output.includes('Platform:'),
      `Expected "Platform:" in output, got: ${output.substring(0, 200)}`
    );
  });

  it('outputs CRUCIX DIAGNOSTICS header', () => {
    const result = runDiag();
    const output = result.stdout || '';
    assert.ok(
      output.includes('CRUCIX DIAGNOSTICS'),
      `Expected "CRUCIX DIAGNOSTICS" in output, got: ${output.substring(0, 200)}`
    );
  });
});
