import { execFile as execFileCb } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

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

export async function listPortListeners(port) {
  const { stdout } = await execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']);
  const listeners = parseLsofLines(stdout);
  const enriched = await Promise.all(listeners.map(async item => ({
    ...item,
    commandLine: await getCommandLine(item.pid),
  })));
  return enriched;
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
