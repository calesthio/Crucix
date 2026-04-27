import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyListenerOwnership, evaluateRestartTransition, parseLsofLines } from '../lib/runtime-restart.mjs';

test('parseLsofLines extracts listener rows', () => {
  const rows = parseLsofLines(`COMMAND   PID      USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\nnode    94748 rightclaw   12u  IPv6 0x1      0t0  TCP *:3117 (LISTEN)\n`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].command, 'node');
  assert.equal(rows[0].pid, 94748);
  assert.match(rows[0].name, /3117/);
});

test('classifyListenerOwnership only claims clearly owned Crucix listeners', () => {
  const owned = classifyListenerOwnership({ command: 'node', name: 'TCP *:3117 (LISTEN)', commandLine: '/opt/homebrew/bin/node /Users/rightclaw/services/crucix/server.mjs', raw: 'node 123' }, { repoRoot: '/Users/rightclaw/services/crucix' });
  const foreignNode = classifyListenerOwnership({ command: 'node', name: 'TCP *:3117 (LISTEN)', commandLine: '/opt/homebrew/bin/node /tmp/other-service/index.mjs', raw: 'node 999' }, { repoRoot: '/Users/rightclaw/services/crucix' });
  const foreignNonNode = classifyListenerOwnership({ command: 'python', name: 'TCP *:3117 (LISTEN)', commandLine: 'python app.py', raw: 'python 111' }, { repoRoot: '/Users/rightclaw/services/crucix' });
  assert.equal(owned.owned, true);
  assert.equal(foreignNode.owned, false);
  assert.equal(foreignNonNode.owned, false);
});

test('evaluateRestartTransition recognizes cleared, replacement, waiting, and foreign listener states', () => {
  const previous = [
    { command: 'node', pid: 101, name: 'TCP *:3117 (LISTEN)', commandLine: '/opt/homebrew/bin/node /Users/rightclaw/services/crucix/server.mjs' },
  ];
  const replacement = [
    { command: 'node', pid: 202, name: 'TCP *:3117 (LISTEN)', commandLine: '/opt/homebrew/bin/node /Users/rightclaw/services/crucix/server.mjs' },
  ];
  const waiting = [
    { command: 'node', pid: 101, name: 'TCP *:3117 (LISTEN)', commandLine: '/opt/homebrew/bin/node /Users/rightclaw/services/crucix/server.mjs' },
  ];
  const foreign = [
    { command: 'python', pid: 303, name: 'TCP *:3117 (LISTEN)', commandLine: 'python /tmp/other/app.py' },
  ];
  const options = { repoRoot: '/Users/rightclaw/services/crucix' };

  assert.equal(evaluateRestartTransition(previous, [], options).status, 'cleared');
  assert.equal(evaluateRestartTransition(previous, replacement, options).status, 'replacement-detected');
  assert.equal(evaluateRestartTransition(previous, waiting, options).status, 'waiting');
  assert.equal(evaluateRestartTransition(previous, foreign, options).status, 'foreign-listener');
});
