import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const HEALTH_PORT = 3217;
const HEALTH_URL = `http://127.0.0.1:${HEALTH_PORT}/api/health`;

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function waitForHealth(url, predicate, timeoutMs = 90000) {
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
  throw new Error(`Timed out waiting for health payload${lastError ? `: ${lastError.message}` : ''}`);
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

test('api health reflects custom freshness override env vars after boot', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(HEALTH_PORT),
      DEFAULT_FRESHNESS_MINUTES: '77',
      OPENSKY_FRESHNESS_MINUTES: '12',
      YFINANCE_FRESHNESS_MINUTES: '9',
      AIR_FRESHNESS_WARN_MINUTES: '14',
      MARKETS_FRESHNESS_WARN_MINUTES: '11',
      TELEGRAM_FRESHNESS_WARN_MINUTES: '13',
      NEWS_FRESHNESS_WARN_MINUTES: '44',
      LLM_PROVIDER: '',
      LLM_MODEL: '',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const configured = await waitForHealth(HEALTH_URL, json => Boolean(json?.freshnessPolicy?.configured), 30000);
    assert.equal(configured.freshnessPolicy.configured.defaultFreshnessMinutes, 77);
    assert.equal(configured.freshnessPolicy.configured.sources.OpenSky.freshnessTargetMinutes, 12);
    assert.equal(configured.freshnessPolicy.configured.sources.YFinance.freshnessTargetMinutes, 9);
    assert.equal(configured.freshnessPolicy.configured.areas.air.freshnessWarnMinutes, 14);
    assert.equal(configured.freshnessPolicy.configured.areas.markets.freshnessWarnMinutes, 11);
    assert.equal(configured.freshnessPolicy.configured.areas.telegram.freshnessWarnMinutes, 13);
    assert.equal(configured.freshnessPolicy.configured.areas.news.freshnessWarnMinutes, 44);

    const active = await waitForHealth(
      HEALTH_URL,
      json => Boolean(json?.freshnessPolicy?.activeSourceHealthPolicy && json?.freshnessPolicy?.activeEvidencePolicy),
      90000,
    );

    assert.equal(active.freshnessPolicy.activeSourceHealthPolicy.defaultFreshnessMinutes, 77);
    assert.equal(active.freshnessPolicy.activeSourceHealthPolicy.sources.OpenSky.freshnessTargetMinutes, 12);
    assert.equal(active.freshnessPolicy.activeSourceHealthPolicy.sources.YFinance.freshnessTargetMinutes, 9);
    assert.equal(active.freshnessPolicy.activeEvidencePolicy.air.freshnessWarnMinutes, 14);
    assert.equal(active.freshnessPolicy.activeEvidencePolicy.markets.freshnessWarnMinutes, 11);
    assert.equal(active.freshnessPolicy.activeEvidencePolicy.telegram.freshnessWarnMinutes, 13);
    assert.equal(active.freshnessPolicy.activeEvidencePolicy.news.freshnessWarnMinutes, 44);
  } finally {
    await stopChild(child);
  }
});
