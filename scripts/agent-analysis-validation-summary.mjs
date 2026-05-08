#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEST_FILE = join(ROOT, 'test/agent-analysis-validation.test.mjs');
const NODE_BIN = process.execPath;
const jsonMode = process.argv.includes('--json');

function parseSummary(text = '') {
  const lines = String(text || '').split(/\r?\n/);
  const passedTests = [];
  const failedTests = [];
  for (const line of lines) {
    const pass = line.match(/^✔\s+(.*)$/);
    if (pass) passedTests.push(pass[1].trim());
    const fail = line.match(/^✖\s+(.*)$/);
    if (fail && !/^failing tests:/i.test(fail[1])) failedTests.push(fail[1].trim());
  }
  const valueOf = (label) => {
    const match = text.match(new RegExp(`ℹ ${label} (\\d+)`));
    return match ? Number(match[1]) : 0;
  };
  const summary = {
    ok: valueOf('fail') === 0,
    command: `${NODE_BIN} --test ${TEST_FILE}`,
    file: TEST_FILE,
    tests: valueOf('tests'),
    pass: valueOf('pass'),
    fail: valueOf('fail'),
    durationMs: valueOf('duration_ms'),
    passedTests,
    failedTests,
    rawTail: lines.slice(-20).filter(Boolean),
  };
  return summary;
}

const child = spawn(NODE_BIN, ['--test', TEST_FILE], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => { stdout += chunk.toString(); });
child.stderr.on('data', chunk => { stderr += chunk.toString(); });
child.on('close', (code) => {
  const combined = `${stdout}${stderr ? `\n${stderr}` : ''}`;
  const summary = parseSummary(combined);
  summary.exitCode = code ?? 1;
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(code ?? 1);
    return;
  }
  const lines = [
    `agent-analysis validation: ${summary.ok ? 'PASS' : 'FAIL'}`,
    `tests=${summary.tests} pass=${summary.pass} fail=${summary.fail} durationMs=${summary.durationMs}`,
  ];
  if (summary.passedTests.length) lines.push(`passed: ${summary.passedTests.join(' | ')}`);
  if (summary.failedTests.length) lines.push(`failed: ${summary.failedTests.join(' | ')}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(code ?? 1);
});
