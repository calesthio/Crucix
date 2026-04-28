import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE_PORT = 3241;

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function waitFor(url, predicate, timeoutMs = 90000) {
  const started = Date.now();
  let lastError = null;
  while ((Date.now() - started) < timeoutMs) {
    try {
      const json = await fetchJson(url);
      if (!predicate || predicate(json)) return json;
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(5000).then(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }),
  ]);
}

async function withBootedServer({ port, env }, fn) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      OPERATOR_SETTINGS_PATH: join(mkdtempSync(join(tmpdir(), 'crucix-settings-')), 'operator-settings.json'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const healthUrl = `http://127.0.0.1:${port}/api/health`;
    await waitFor(healthUrl, payload => payload?.lifecycle?.phase === 'serving' && payload?.lifecycle?.dataReady === true && payload?.sourceOps?.inventory?.total >= 1, 90000);
    return await fn({
      baseUrl: `http://127.0.0.1:${port}`,
      healthUrl,
    });
  } finally {
    await stopChild(child);
  }
}

function extractInjectedJson(html, symbol) {
  const regex = new RegExp(`window\\.${symbol}\\s*=\\s*([^;]+);`);
  const match = html.match(regex);
  assert.ok(match, `expected ${symbol} bootstrap to be injected`);
  return JSON.parse(match[1]);
}

test('booted server serves runtime-backed dashboard and operator pages with injected live bootstrap state', async () => {
  await withBootedServer({
    port: BASE_PORT,
    env: {
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      DEBUG_ENDPOINT_EXPOSURE: 'local-only',
      REFRESH_INTERVAL_MINUTES: '17',
    },
  }, async ({ baseUrl, healthUrl }) => {
    const health = await waitFor(healthUrl, payload => payload?.runtimeIdentity?.pid && payload?.lifecycle?.phase === 'serving', 30000);
    const routes = [
      { path: '/', activeSurface: null, title: /Sensor Grid|Crucix/i },
      { path: '/settings', activeSurface: 'settings', title: /read-only operator view/i },
      { path: '/source-ops', activeSurface: 'source-ops', title: /Operator source console/i },
      { path: '/llm-ops', activeSurface: 'llm-ops', title: /Provider health and fallback operations/i },
      { path: '/diagnostics', activeSurface: 'diagnostics', title: /Runtime and review diagnostics/i },
      { path: '/admin/settings', activeSurface: 'admin-settings', title: /Local control plane/i },
    ];

    for (const route of routes) {
      const html = await fetchText(`${baseUrl}${route.path}`);
      assert.match(html, route.title);
      assert.match(html, /window\.__CRUCIX_RUNTIME__/i);
      assert.match(html, /window\.__CRUCIX_LOCALE__/i);
      const runtime = extractInjectedJson(html, '__CRUCIX_RUNTIME__');
      const locale = extractInjectedJson(html, '__CRUCIX_LOCALE__');
      assert.equal(runtime.refreshIntervalMinutes, 17);
      assert.equal(runtime.settingsUrl, '/settings');
      assert.equal(runtime.diagnosticsUrl, '/diagnostics');
      assert.equal(runtime.adminSettingsUrl, '/admin/settings');
      assert.equal(typeof runtime.operatorSettings, 'object');
      assert.equal(typeof locale, 'object');
      assert.equal(Object.keys(locale).length > 0, true);
      if (route.activeSurface) {
        assert.match(html, new RegExp(`activeSurface: '${route.activeSurface}'`, 'i'));
        assert.match(html, /ops-shell\.js/i);
        assert.match(html, /ops-shell\.css/i);
      }
    }

    const dashboardHtml = await fetchText(`${baseUrl}/`);
    const dashboardRuntime = extractInjectedJson(dashboardHtml, '__CRUCIX_RUNTIME__');
    assert.deepEqual(Object.keys(dashboardRuntime).sort(), ['adminSettingsUrl', 'diagnosticsUrl', 'operatorSettings', 'refreshIntervalMinutes', 'settingsUrl'].sort());
    assert.equal(['auto', 'off', 'on'].includes(dashboardRuntime.operatorSettings.layout.performance.wallboardVirtualization), true);
    assert.match(dashboardHtml, /fetch\('\/api\/data'/i);
    assert.match(dashboardHtml, /panelRenderBudgetTelemetry/i);
    assert.match(dashboardHtml, /Wallboard virtualization active/i);
    assert.equal(health.runtimeIdentity.port, BASE_PORT);
  });
});
