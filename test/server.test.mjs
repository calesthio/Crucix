// server.test.mjs — Integration tests for server.mjs HTTP endpoints
// Spawns the server as a child process to avoid module-level side effects.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

let serverProcess;
// Use a 4-digit port — server.mjs banner formatting breaks with 5-digit ports
// (String.repeat(4 - port.length) goes negative for ports >= 10000)
const PORT = 3118; // different port to avoid conflicts with default 3117

before(async () => {
  serverProcess = spawn('node', ['server.mjs'], {
    cwd: '/Users/cspenn/Documents/github/Crucix',
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe',
  });

  // Wait for server to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearTimeout(timeout);
      resolve(); // resolve anyway — server may just not print the expected string
    }, 5000);

    function checkData(data) {
      const str = data.toString();
      if (
        str.includes('listening') ||
        str.includes(String(PORT)) ||
        str.includes('Server running')
      ) {
        clearTimeout(timeout);
        resolve();
      }
    }

    serverProcess.stdout.on('data', checkData);
    serverProcess.stderr.on('data', checkData);

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });

  // Give the server a little more time to bind after printing
  await new Promise(r => setTimeout(r, 500));
});

after(() => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
});

describe('server HTTP endpoints', () => {
  it('GET /api/health returns 200 with JSON', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    // Health endpoint returns status, uptime, lastSweep, etc.
    assert.ok(
      'uptime' in body || 'status' in body || 'sweepInProgress' in body,
      'Expected health response to have uptime, status, or sweepInProgress'
    );
  });

  it('GET /api/health returns status:"ok"', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/health`);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });

  it('GET /api/health contains uptime as a number', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/health`);
    const body = await res.json();
    assert.ok(typeof body.uptime === 'number');
    assert.ok(body.uptime >= 0);
  });

  it('GET /api/locales returns 200 with locale info', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/locales`);
    assert.equal(res.status, 200);
    const body = await res.json();
    // Should have current language and supported locales
    assert.ok(
      'current' in body || 'supported' in body,
      'Expected locales response to have current or supported fields'
    );
  });

  it('GET /api/locales returns supported array', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/locales`);
    const body = await res.json();
    assert.ok(Array.isArray(body.supported));
    assert.ok(body.supported.length > 0);
  });

  it('GET /api/data returns 200 or 503', async () => {
    // /api/data returns 503 if no sweep has completed yet, 200 if data is ready
    const res = await fetch(`http://localhost:${PORT}/api/data`);
    assert.ok(res.status === 200 || res.status === 503);
  });

  it('GET / returns 200 HTML', async () => {
    const res = await fetch(`http://localhost:${PORT}/`);
    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type') || '';
    assert.ok(ct.includes('html'), `Expected content-type to include "html", got: ${ct}`);
  });
});
