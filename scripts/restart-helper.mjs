#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { appendRuntimeRestartAudit, classifyListenerOwnership, evaluateRestartTransition, listPortListeners, waitForHealth } from '../lib/runtime-restart.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 3117);
const healthUrl = `http://127.0.0.1:${port}/api/health`;
const repoRoot = ROOT;
const runtimeRestartAuditPath = join(ROOT, 'runs', 'runtime-restart-audit.json');

function log(line) { console.log(`[Crucix restart] ${line}`); }
function fail(line) { throw new Error(String(line || 'restart-helper-failed')); }
async function sleep(ms){ await new Promise(r => setTimeout(r, ms)); }

async function killOwnedListeners() {
  let listeners = [];
  try {
    listeners = await listPortListeners(port);
  } catch (error) {
    if (String(error.message || '').includes('status 1')) return { previousListeners: [], transition: { status: 'cleared', previousPids: [], livePids: [] } };
    throw error;
  }
  if (!listeners.length) {
    log(`No existing listener on port ${port}.`);
    return { previousListeners: [], transition: { status: 'cleared', previousPids: [], livePids: [] } };
  }
  const owned = listeners.filter(item => classifyListenerOwnership(item, { repoRoot }).owned);
  const foreign = listeners.filter(item => !classifyListenerOwnership(item, { repoRoot }).owned);
  if (foreign.length) {
    fail(`Refusing to kill listener(s) on port ${port} that are not clearly owned by this Crucix repo: ${foreign.map(item => `${item.command}:${item.pid}`).join(', ')}`);
  }
  for (const item of owned) {
    log(`Stopping existing Crucix listener PID ${item.pid} on port ${port}.`);
    try { process.kill(item.pid, 'SIGTERM'); } catch (error) { fail(`Failed to SIGTERM PID ${item.pid}: ${error.message}`); }
  }
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await sleep(500);
    const remaining = await listPortListeners(port).catch(() => []);
    const transition = evaluateRestartTransition(owned, remaining, { repoRoot });
    if (transition.status === 'cleared') return { previousListeners: owned, transition };
    if (transition.status === 'replacement-detected') {
      log(`Detected replacement listener PID ${transition.livePids.join(', ')} while original PID(s) were shutting down.`);
      return { previousListeners: owned, transition };
    }
    if (transition.status === 'foreign-listener') {
      fail(`Port ${port} became owned by a non-Crucix listener during restart: ${transition.foreign.map(item => `${item.command}:${item.pid}`).join(', ')}`);
    }
  }
  const remaining = await listPortListeners(port).catch(() => []);
  const transition = evaluateRestartTransition(owned, remaining, { repoRoot });
  fail(`Port ${port} still has original listener PID(s) after waiting for shutdown: ${(transition.retainedPids || []).join(', ') || 'unknown'}.`);
}

async function startCrucix() {
  log(`Starting Crucix on port ${port}.`);
  const child = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

async function main() {
  const startedAt = new Date().toISOString();
  log(`Inspecting port ${port} ownership before restart.`);
  const restartState = await killOwnedListeners();
  let pid = null;
  let replacementMode = restartState.transition.status;
  if (restartState.transition.status === 'replacement-detected') {
    log('A new Crucix listener took ownership during shutdown, so no extra spawn was needed.');
  } else {
    pid = await startCrucix();
    replacementMode = 'helper-started';
  }
  const health = await waitForHealth({ url: healthUrl, timeoutMs: 45000, intervalMs: 1000 });
  const listeners = await listPortListeners(port).catch(() => []);
  const previousPids = new Set((restartState.previousListeners || []).map(item => Number(item.pid)).filter(Boolean));
  const match = pid ? (listeners.find(item => item.pid === pid) || listeners[0] || null) : (listeners[0] || null);
  const livePid = Number(match?.pid) || null;
  const rotationProved = livePid ? !previousPids.has(livePid) : previousPids.size === 0;
  if (!rotationProved) fail(`Health check passed but PID rotation was not proved. Previous PID(s): ${[...previousPids].join(', ') || 'none'}, live PID: ${livePid || 'unknown'}.`);
  log(`Health check passed for ${healthUrl}.`);
  log(`Live listener PID ${livePid || pid} on port ${port}.`);
  const result = { ok: true, port, startedPid: pid, livePid, replacementMode, rotationProved, healthStatus: health?.status || null, lastSweep: health?.lastSweep || null };
  appendRuntimeRestartAudit(runtimeRestartAuditPath, {
    action: 'restart-safe',
    phase: 'completed',
    status: 'ok',
    port,
    requestedByPid: process.ppid || null,
    helperPid: process.pid,
    startedAt,
    completedAt: new Date().toISOString(),
    previousPids: [...previousPids],
    startedPid: pid,
    livePid,
    replacementMode,
    rotationProved,
    healthStatus: health?.status || null,
    lastSweep: health?.lastSweep || null,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  appendRuntimeRestartAudit(runtimeRestartAuditPath, {
    action: 'restart-safe',
    phase: 'failed',
    status: 'failed',
    port,
    helperPid: process.pid,
    completedAt: new Date().toISOString(),
    error: error?.message || String(error),
  });
  fail(error?.stack || error?.message || String(error));
});
