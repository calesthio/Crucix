import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceOpsSurface } from '../lib/source-ops-runtime.mjs';

const rootDir = new URL('..', import.meta.url).pathname;

test('source ops surface summarizes contract, inventory, and needs from workspace files', () => {
  const surface = buildSourceOpsSurface({ rootDir });
  assert.equal(surface.contract.version, 'source-ops-profile-v1');
  assert.equal(surface.contract.contractMode, 'file-first');
  assert.equal(surface.contract.preProductionAutoAdvanceMax, 'shadow');
  assert.equal(surface.contract.activePromotionRequiresHumanApproval, true);
  assert.ok(surface.contract.allowedRoles.includes('discovery'));
  assert.equal(surface.inventory.version, 'source-registry-v1');
  assert.equal(surface.inventory.total, 29);
  assert.equal(surface.inventory.active, 29);
  assert.ok(surface.inventory.byCategory.social >= 1);
  assert.ok(surface.inventory.byOperatorRole.anchor >= 1);
  assert.equal(surface.needs.total, 2);
  assert.equal(surface.needs.highPriority, 2);
  assert.ok(surface.needs.byCategory.maritime >= 1);
  assert.equal(surface.grading.version, 'source-grading-rubric-v1');
  assert.equal(surface.grading.dimensionCount, 6);
  assert.equal(surface.grading.totalWeight, 1);
  assert.equal(surface.overlap.version, 'source-overlap-rubric-v1');
  assert.equal(surface.overlap.dimensionCount, 4);
  assert.equal(surface.overlap.totalWeight, 1);
  assert.equal(surface.exampleScorecard.version, 'source-scorecard-v1');
  assert.equal(surface.exampleScorecard.recommendation, 'shadow');
  assert.equal(surface.exampleScorecard.promotionReadiness, 'shadow-ready');
  assert.equal(surface.exampleOverlap.version, 'source-overlap-v1');
  assert.equal(surface.exampleOverlap.recommendation, 'shadow');
  assert.equal(surface.exampleOverlap.overlap.incrementalCoverage, 'high');
  assert.equal(surface.exampleOverlap.comparedSourceCount, 4);
});

test('source ops surface attaches live source-health state when snapshot health entries exist', () => {
  const surface = buildSourceOpsSurface({
    rootDir,
    snapshot: {
      healthSummary: {
        entries: [
          { name: 'ACLED', state: 'ok', ageMinutes: 11, failure: { class: 'none' } },
          { name: 'Bluesky', state: 'failed', ageMinutes: 88, failure: { class: 'external-limit' } },
        ],
      },
    },
  });
  const acled = surface.inventory.items.find(item => item.name === 'ACLED');
  const bluesky = surface.inventory.items.find(item => item.name === 'Bluesky');
  assert.equal(acled.liveState, 'ok');
  assert.equal(acled.liveAgeMinutes, 11);
  assert.equal(bluesky.liveState, 'failed');
  assert.equal(bluesky.liveFailureClass, 'external-limit');
  assert.equal(surface.inventory.liveStateSummary.ok, 1);
  assert.equal(surface.inventory.liveStateSummary.failed, 1);
});
