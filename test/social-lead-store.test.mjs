import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSocialLead, createSocialLeadStore, normalizeSocialLeadInput } from '../lib/social-leads/store.mjs';

test('normalizeSocialLeadInput validates minimal X lead intake and trims fields', () => {
  const normalized = normalizeSocialLeadInput({
    platform: 'x',
    postUrl: ' https://x.com/example/status/123 ',
    authorHandle: '@signalwatch',
    rawText: '  Test post text  ',
    quotedThreadText: [' first thread line ', 'second thread line'],
    operatorContext: '  from operator  ',
  });

  assert.equal(normalized.platform, 'x');
  assert.equal(normalized.postUrl, 'https://x.com/example/status/123');
  assert.equal(normalized.authorHandle, 'signalwatch');
  assert.equal(normalized.rawText, 'Test post text');
  assert.deepEqual(normalized.quotedThreadText, ['first thread line', 'second thread line']);
  assert.equal(normalized.operatorContext, 'from operator');
  assert.equal(normalized.captureMethod, 'operator-url-drop');
  assert.equal(normalized.acquisitionTier, 'manual-url');
});

test('createSocialLead preserves immutable raw evidence alongside normalized content', () => {
  const lead = createSocialLead({
    platform: 'x',
    rawText: 'US struck Bandar Abbas',
    quotedThreadText: ['Source says vessels were hit'],
    authorHandle: 'marionawfal',
    citedUrls: ['https://www.nbcnews.com/example'],
  }, { capturedAt: '2026-05-08T16:00:00Z', leadId: 'lead-test-001' });

  assert.equal(lead.version, 'social-lead-v1');
  assert.equal(lead.leadId, 'lead-test-001');
  assert.equal(lead.source.platform, 'x');
  assert.equal(lead.source.capturedAt, '2026-05-08T16:00:00Z');
  assert.equal(lead.source.acquisitionTier, 'manual-text');
  assert.equal(lead.rawEvidence.rawText, 'US struck Bandar Abbas');
  assert.deepEqual(lead.rawEvidence.quotedThreadText, ['Source says vessels were hit']);
  assert.match(lead.content.normalizedText, /US struck Bandar Abbas/);
  assert.match(lead.content.normalizedText, /Source says vessels were hit/);
});

test('social lead store persists leads and returns bounded contract summaries', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'crucix-social-leads-'));
  const store = createSocialLeadStore({ rootDir, maxLeads: 5 });

  store.intake({
    platform: 'x',
    postUrl: 'https://x.com/example/status/1',
    rawText: 'First lead',
    authorHandle: 'alpha',
  });
  store.intake({
    platform: 'x',
    rawText: 'Second lead',
    authorHandle: 'beta',
  });

  const leads = store.list({ limit: 10 });
  assert.equal(leads.length, 2);
  assert.equal(leads[0].source.authorHandle, 'beta');
  assert.equal(leads[1].source.authorHandle, 'alpha');

  const contract = store.buildContract();
  assert.equal(contract.version, 'social-leads-contract-v1');
  assert.equal(contract.totalLeads, 2);
  assert.equal(contract.endpoint, '/api/social-leads');
  assert.equal(contract.intakeEndpoint, '/api/social-leads/intake');
  assert.deepEqual(contract.capabilities.firstClassPlatforms, ['x']);
});
