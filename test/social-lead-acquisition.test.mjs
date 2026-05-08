import test from 'node:test';
import assert from 'node:assert/strict';
import { getSocialLeadAcquisitionCapabilities, planSocialLeadAcquisition } from '../lib/social-leads/acquisition.mjs';

test('acquisition capabilities default to manual-only X retrieval tiers', () => {
  const capabilities = getSocialLeadAcquisitionCapabilities({});
  assert.deepEqual(capabilities, {
    publicFetch: false,
    browserAssisted: false,
    formalApi: false,
  });
});

test('public-fetch request degrades to manual gap when URL-only evidence cannot be retrieved', () => {
  const plan = planSocialLeadAcquisition({
    platform: 'x',
    postUrl: 'https://x.com/example/status/1',
    acquisitionTier: 'public-fetch',
  }, {
    publicFetch: false,
    browserAssisted: false,
    formalApi: false,
  });

  assert.equal(plan.requestedTier, 'public-fetch');
  assert.equal(plan.resolvedTier, 'manual-url');
  assert.equal(plan.retrievalStatus, 'manual-evidence-required');
  assert.equal(plan.allowUrlOnlyPlaceholder, true);
  assert.equal(plan.needsManualEvidence, true);
  assert.equal(plan.degradation.reason, 'public-fetch-not-enabled');
  assert.match(plan.nextAction, /Provide pasted post text/);
});

test('browser-assisted request preserves operator evidence when text is already supplied', () => {
  const plan = planSocialLeadAcquisition({
    platform: 'x',
    postUrl: 'https://x.com/example/status/2',
    rawText: 'Operator pasted the post body',
    acquisitionTier: 'browser-assisted',
  }, {
    publicFetch: false,
    browserAssisted: false,
    formalApi: false,
  });

  assert.equal(plan.requestedTier, 'browser-assisted');
  assert.equal(plan.resolvedTier, 'manual-url');
  assert.equal(plan.retrievalStatus, 'degraded-to-operator-evidence');
  assert.equal(plan.allowUrlOnlyPlaceholder, false);
  assert.equal(plan.needsManualEvidence, false);
  assert.equal(plan.degradation.reason, 'browser-assisted-not-enabled');
});
