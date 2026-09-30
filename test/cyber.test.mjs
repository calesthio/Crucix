import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeCyber } from '../lib/cyber.mjs';
import { computeDelta } from '../lib/delta/engine.mjs';
import { MemoryManager } from '../lib/delta/memory.mjs';
import { synthesize } from '../dashboard/inject.mjs';
import { generateLLMIdeas } from '../lib/llm/ideas.mjs';

const entry = { cveID: 'CVE-2026-12345', vendorProject: 'Vendor', product: 'Gateway', knownRansomwareCampaignUse: 'Known' };
const baseline = () => ({ cyber: { available: true, vulnerabilities: [] }, internet: { outagesAvailable: true, activeEvents: [] }, health: [] });

test('cyber synthesis preserves unknowns and partial outage coverage', () => {
  const empty = summarizeCyber();
  assert.equal(empty.cyber.total, null);
  assert.equal(empty.internet.active, null);
  const result = summarizeCyber({
    'CISA-KEV': { summary: { totalInCatalog: 10, recentAdditions: 2 }, vulnerabilities: [entry] },
    'Cloudflare-Radar': { outages: { active: 0, activeEvents: [] }, anomalies: { error: 'HTTP 503' } },
  });
  assert.equal(result.cyber.total, 10);
  assert.equal(result.internet.active, 0);
  assert.equal(result.internet.anomalies, null);
  assert.equal(result.internet.status, 'degraded');
  assert.equal(result.internet.outagesAvailable, true);
});

test('new KEV entries are deduplicated and missing data is not a fresh incident', () => {
  const previous = baseline();
  const current = baseline();
  current.cyber.vulnerabilities = [entry, entry];
  const delta = computeDelta(current, previous);
  assert.equal(delta.signals.new.filter(signal => signal.key.startsWith('kev:')).length, 1);
  assert.equal(delta.signals.new[0].severity, 'high');
  assert.equal(computeDelta(current, current).signals.new.length, 0);
  previous.cyber.available = false;
  assert.equal(computeDelta(current, previous).signals.new.length, 0);
  assert.equal(computeDelta(current, baseline(), {}, [current]).signals.new.length, 0);
});

test('outages need explicit resolution and unavailable feeds do not imply recovery', () => {
  const previous = baseline();
  previous.internet.activeEvents = [{ id: 'outage-1' }];
  const current = baseline();
  assert.equal(computeDelta(current, previous).signals.deescalated.length, 0);
  current.internet.recentResolved = [{ id: 'outage-1' }];
  assert.equal(computeDelta(current, previous).signals.deescalated[0].direction, 'resolved');
  current.internet.outagesAvailable = false;
  assert.equal(computeDelta(current, previous).signals.deescalated.length, 0);
  current.internet.outagesAvailable = true;
  current.internet.activeEvents = [{ id: 'outage-2' }];
  assert.ok(computeDelta(current, previous).signals.new.some(signal => signal.key === 'outage:outage-2'));
});

test('stored runs retain cyber identities, outage identities and health for subsequent deltas', () => {
  const directory = mkdtempSync(join(tmpdir(), 'crucix-cyber-'));
  try {
    const memory = new MemoryManager(directory);
    memory.addRun(baseline());
    const current = baseline();
    current.cyber.vulnerabilities = [entry];
    current.internet.activeEvents = [{ id: 'outage-1' }];
    current.health = [{ n: 'Radar', status: 'healthy', err: false }];
    assert.equal(memory.addRun(current).signals.new.length, 2);
    const reloaded = new MemoryManager(directory);
    assert.equal(reloaded.addRun(current).signals.new.length, 0);
    assert.deepEqual(reloaded.getLastRun().health, current.health);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('cyber panels escape source text and never link an invalid CVE', () => {
  const html = readFileSync(new URL('../dashboard/public/jarvis.html', import.meta.url), 'utf8');
  const renderer = html.match(/function buildCyberPanels\(\)\{[\s\S]*?\n\}/)[0];
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const data = {
    cyber: { available: true, vulnerabilities: [{ ...entry, cveID: '<script>attack</script>', vendorProject: '<img src=x onerror=attack()>' }] },
    internet: { outagesAvailable: true, activeEvents: [{ description: '<script>attack</script>', locations: ['<img>'] }] },
  };
  const render = new Function('D', 't', 'escAttr', 'sigAttrs', `${renderer}; return buildCyberPanels;`)(data, key => key, escape, () => '');
  const result = render();
  assert.ok(!result.includes('<script>'));
  assert.ok(!result.includes('<img'));
  assert.ok(!result.includes('href='));
  assert.ok(result.includes('&lt;script&gt;'));
});

test('dashboard synthesis carries cyber data and corrects legacy source counts without network calls', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<rss><channel></channel></rss>');
    const result = await synthesize({
      crucix: { sourcesOk: 3, sourcesQueried: 4 },
      sources: {
        'CISA-KEV': { summary: { totalInCatalog: 10 }, vulnerabilities: [entry] },
        'Cloudflare-Radar': { status: 'no_credentials' },
        Partial: { rwError: 'HTTP 406' },
      },
      errors: [{ name: 'Timeout', error: 'Source timed out' }],
    });
    assert.equal(result.meta.sourcesOk, 1);
    assert.equal(result.meta.sourcesUnconfigured, 1);
    assert.equal(result.meta.sourcesDegraded, 1);
    assert.equal(result.meta.sourcesFailed, 1);
    assert.equal(result.health.length, 4);
    assert.equal(result.cyber.vulnerabilities[0].cveID, entry.cveID);
    assert.equal(result.internet.active, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('LLM context receives cyber and outage data with interpretation limits', async () => {
  let context;
  const provider = { isConfigured: true, complete: async (system, user) => {
    context = user;
    return { text: JSON.stringify([{ title: 'Watch', type: 'watch', confidence: 'LOW', text: 'Monitor developments' }]) };
  } };
  await generateLLMIdeas(provider, {
    cyber: { available: true, recentAdditions: 2, vulnerabilities: [entry] },
    internet: { outagesAvailable: true, active: 1, activeEvents: [{ locations: ['IR'], description: 'Network disruption' }] },
  }, null);
  assert.match(context, /CYBER: 2 KEV/);
  assert.match(context, /not incident counts/);
  assert.match(context, /INTERNET: 1 active/);
  assert.match(context, /do not establish cyberattack/);
});
