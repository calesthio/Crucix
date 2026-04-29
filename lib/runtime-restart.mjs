import { execFile as execFileCb } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const COMMON_LSOF_PATHS = ['/usr/sbin/lsof', '/usr/bin/lsof', '/bin/lsof', '/opt/homebrew/bin/lsof'];

export function runtimeRestartAuditDefaults() {
  return {
    version: 'runtime-restart-audit-v1',
    updatedAt: null,
    history: [],
  };
}

export function loadRuntimeRestartAudit(path) {
  try {
    if (!path || !existsSync(path)) return runtimeRestartAuditDefaults();
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return {
      version: 'runtime-restart-audit-v1',
      updatedAt: parsed?.updatedAt || null,
      history: Array.isArray(parsed?.history) ? parsed.history : [],
    };
  } catch {
    return runtimeRestartAuditDefaults();
  }
}

export function appendRuntimeRestartAudit(path, entry = {}, maxEntries = 20) {
  const current = loadRuntimeRestartAudit(path);
  const nowIso = entry?.recordedAt || new Date().toISOString();
  const next = {
    version: 'runtime-restart-audit-v1',
    updatedAt: nowIso,
    history: [{ ...entry, recordedAt: nowIso }, ...(current.history || [])].slice(0, maxEntries),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function parseLsofLines(stdout = '') {
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  return lines.slice(1).map(line => {
    const parts = line.trim().split(/\s+/);
    const tcpIndex = parts.findIndex(part => part === 'TCP' || part === 'UDP');
    return {
      command: parts[0] || null,
      pid: Number(parts[1]) || null,
      user: parts[2] || null,
      name: tcpIndex >= 0 ? parts.slice(tcpIndex).join(' ') : (parts[parts.length - 1] || null),
      raw: line,
    };
  }).filter(item => item.pid);
}

export function classifyListenerOwnership(listener = {}, { repoRoot = '', entryHint = 'server.mjs' } = {}) {
  const command = String(listener.command || '').toLowerCase();
  const name = String(listener.name || '').toLowerCase();
  const repo = String(repoRoot || '').toLowerCase();
  const commandLine = String(listener.commandLine || listener.raw || '').toLowerCase();
  const matchesNode = command === 'node';
  const matchesEntry = name.includes(String(entryHint).toLowerCase()) || commandLine.includes(String(entryHint).toLowerCase());
  const matchesRepo = repo ? commandLine.includes(repo) : false;
  const owned = Boolean(matchesNode && (matchesEntry || matchesRepo));
  return {
    owned,
    reason: owned ? 'matched-node-and-entry' : matchesNode ? 'node-without-matching-entry' : 'non-node-listener',
  };
}

async function getCommandLine(pid) {
  if (!pid) return null;
  if (process.platform === 'win32') return null;
  try {
    const { stdout } = await execFile('ps', ['-p', String(pid), '-o', 'command=']);
    return String(stdout || '').trim() || null;
  } catch {
    return null;
  }
}

export async function resolveLsofPath() {
  for (const candidate of COMMON_LSOF_PATHS) {
    if (existsSync(candidate)) return candidate;
  }
  try {
    const { stdout } = await execFile('which', ['lsof']);
    const candidate = String(stdout || '').trim();
    if (candidate) return candidate;
  } catch {}
  return null;
}

export async function listCrucixProcesses({ repoRoot = '', entryHint = 'server.mjs' } = {}) {
  if (process.platform === 'win32') return [];
  const { stdout } = await execFile('ps', ['-ax', '-o', 'pid=,comm=,command=']);
  const lines = String(stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.map(line => {
    const match = line.match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) return null;
    const pid = Number(match[1]);
    const command = match[2] || null;
    const commandLine = match[3] || null;
    return {
      pid,
      command,
      commandLine,
      name: 'process-fallback',
      raw: line,
      lookup: 'ps-fallback',
    };
  }).filter(item => item && classifyListenerOwnership(item, { repoRoot, entryHint }).owned);
}

export async function listPortListeners(port, { repoRoot = '', entryHint = 'server.mjs' } = {}) {
  const lsofPath = await resolveLsofPath();
  if (!lsofPath) {
    return await listCrucixProcesses({ repoRoot, entryHint });
  }
  const { stdout } = await execFile(lsofPath, ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']);
  const listeners = parseLsofLines(stdout);
  const enriched = await Promise.all(listeners.map(async item => ({
    ...item,
    commandLine: await getCommandLine(item.pid),
    lookup: 'lsof',
  })));
  return enriched;
}

export function evaluateRestartTransition(previousListeners = [], nextListeners = [], { repoRoot = '', entryHint = 'server.mjs' } = {}) {
  const previousPids = new Set((Array.isArray(previousListeners) ? previousListeners : []).map(item => Number(item?.pid)).filter(Boolean));
  const remaining = Array.isArray(nextListeners) ? nextListeners : [];
  if (!remaining.length) {
    return { status: 'cleared', previousPids: [...previousPids], livePids: [] };
  }
  const owned = remaining.filter(item => classifyListenerOwnership(item, { repoRoot, entryHint }).owned);
  const foreign = remaining.filter(item => !classifyListenerOwnership(item, { repoRoot, entryHint }).owned);
  if (foreign.length) {
    return {
      status: 'foreign-listener',
      previousPids: [...previousPids],
      livePids: remaining.map(item => item.pid).filter(Boolean),
      foreign,
      owned,
    };
  }
  const livePids = owned.map(item => Number(item.pid)).filter(Boolean);
  const retainedPids = livePids.filter(pid => previousPids.has(pid));
  if (!retainedPids.length && livePids.length) {
    return {
      status: 'replacement-detected',
      previousPids: [...previousPids],
      livePids,
      owned,
    };
  }
  return {
    status: 'waiting',
    previousPids: [...previousPids],
    livePids,
    retainedPids,
    owned,
  };
}

export async function waitForHealth({ url, timeoutMs = 30000, intervalMs = 1000 }) {
  const started = Date.now();
  let lastError = null;
  while ((Date.now() - started) < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ''}`);
}
