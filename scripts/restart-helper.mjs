#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyListenerOwnership, listPortListeners, waitForHealth } from '../lib/runtime-restart.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 3117);
const healthUrl = `http://127.0.0.1:${port}/api/health`;
const repoRoot = ROOT;

function log(line) { console.log(`[Crucix restart] ${line}`); }
function fail(line) { console.error(`[Crucix restart] ${line}`); process.exit(1); }
async function sleep(ms){ await new Promise(r => setTimeout(r, ms)); }

async function killOwnedListeners() {
  let listeners = [];
  try {
    listeners = await listPortListeners(port);
  } catch (error) {
    if (String(error.message || '').includes('status 1')) return [];
    throw error;
  }
  if (!listeners.length) {
    log(`No existing listener on port ${port}.`);
    return [];
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
    if (!remaining.length) return owned;
  }
  fail(`Port ${port} still has a listener after waiting for shutdown.`);
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
  log(`Inspecting port ${port} ownership before restart.`);
  await killOwnedListeners();
  const pid = await startCrucix();
  const health = await waitForHealth({ url: healthUrl, timeoutMs: 45000, intervalMs: 1000 });
  const listeners = await listPortListeners(port).catch(() => []);
  const match = listeners.find(item => item.pid === pid) || listeners[0] || null;
  log(`Health check passed for ${healthUrl}.`);
  log(`Live listener PID ${match?.pid || pid} on port ${port}.`);
  console.log(JSON.stringify({ ok: true, port, startedPid: pid, livePid: match?.pid || null, healthStatus: health?.status || null, lastSweep: health?.lastSweep || null }, null, 2));
}

main().catch(error => fail(error?.stack || error?.message || String(error)));
