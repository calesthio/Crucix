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
  assert.equal(surface.contract.lifecycleTransitionPolicyPath, 'source-ops/lifecycle-transition-policy.json');
  assert.deepEqual(surface.contract.transitionPolicy.agentMayAutoAdvanceTo, ['researched', 'graded', 'shadow']);
  assert.ok(surface.contract.allowedRoles.includes('discovery'));
  assert.equal(surface.inventory.version, 'source-registry-v1');
  assert.equal(surface.inventory.total, 30);
  assert.equal(surface.inventory.active, 29);
  assert.equal(surface.inventory.productionActive, 29);
  assert.equal(surface.inventory.preProduction, 1);
  assert.equal(surface.inventory.byLifecycle.shadow, 1);
  assert.ok(surface.inventory.byCategory.social >= 1);
  assert.ok(surface.inventory.byOperatorRole.anchor >= 1);
  assert.equal(surface.inventory.items.find(item => item.name === 'GDELT')?.runtimeBucket?.kind, 'expected-multi-publisher');
  assert.equal(surface.fusionRoles.total, 30);
  assert.ok(surface.fusionRoles.byRole.anchor >= 1);
  assert.ok(surface.fusionRoles.byRole.exploratory >= 1);
  assert.ok(surface.fusionRoles.roles.find(item => item.role === 'context')?.count >= 1);
  assert.equal(surface.performance.version, 'source-performance-workflow-v1');
  assert.equal(surface.performance.totalMeasuredSources, 30);
  assert.equal(surface.performance.targets.tippingPointCount, 0);
  assert.equal(surface.performance.measurementNotes.intendedValidationTargets.includes('review pressure'), true);
  assert.equal(Array.isArray(surface.performance.workflow.attributionHeadlines), true);
  assert.equal(Array.isArray(surface.performance.workflow.confidenceCaveats), true);
  assert.equal(Array.isArray(surface.performance.workflow.validationViews.trustOutcomes), true);
  assert.equal(surface.history.version, 'source-health-history-v1');
  assert.equal(Array.isArray(surface.history.windows), true);
  assert.equal(surface.needs.total, 2);
  assert.equal(surface.needs.highPriority, 2);
  assert.ok(surface.needs.byCategory.maritime >= 1);
  assert.equal(surface.grading.version, 'source-grading-rubric-v1');
  assert.equal(surface.grading.dimensionCount, 6);
  assert.equal(surface.grading.totalWeight, 1);
  assert.equal(surface.overlap.version, 'source-overlap-rubric-v1');
  assert.equal(surface.overlap.dimensionCount, 4);
  assert.equal(surface.overlap.totalWeight, 1);
  assert.equal(surface.pruning.version, 'source-pruning-rubric-v1');
  assert.equal(surface.pruning.dimensionCount, 5);
  assert.equal(surface.pruning.totalWeight, 1);
  assert.equal(surface.actionTaxonomy.version, 'source-action-taxonomy-v1');
  assert.ok(surface.actionTaxonomy.ids.includes('human-review'));
  assert.equal(surface.shadow.total, 1);
  assert.equal(surface.shadow.readyForHumanReview, 1);
  assert.equal(surface.shadow.blockedFromProduction, 1);
  assert.equal(surface.shadow.items[0].productionInfluenceBlocked, true);
  assert.deepEqual(surface.shadow.items[0].eligibleNextStates, ['approved', 'rejected', 'deprecated']);
  assert.equal(surface.contract.shadowPolicy.productionInfluenceBlocked, true);
  assert.equal(surface.lifecycleTransitions.version, 'source-lifecycle-transition-policy-v1');
  assert.equal(surface.lifecycleTransitions.preProductionAutoAdvanceMax, 'shadow');
  assert.equal(surface.lifecycleTransitions.activePromotionRequiresHumanApproval, true);
  assert.deepEqual(surface.lifecycleTransitions.autoAdvanceStates, ['candidate', 'researched', 'graded', 'deprecated', 'rejected']);
  assert.ok(surface.lifecycleTransitions.humanApprovalBoundaryStates.includes('shadow'));
  assert.equal(surface.exampleScorecard.version, 'source-scorecard-v1');
  assert.equal(surface.exampleScorecard.recommendation, 'shadow');
  assert.equal(surface.exampleScorecard.promotionReadiness, 'shadow-ready');
  assert.equal(surface.exampleOverlap.version, 'source-overlap-v1');
  assert.equal(surface.exampleOverlap.recommendation, 'shadow');
  assert.equal(surface.exampleOverlap.overlap.incrementalCoverage, 'high');
  assert.equal(surface.exampleOverlap.comparedSourceCount, 4);
  assert.equal(surface.examplePruning.version, 'source-pruning-v1');
  assert.equal(surface.examplePruning.recommendation, 'human-review');
  assert.equal(surface.examplePruning.recommendedAction, 'human-review');
  assert.equal(surface.examplePruning.comparedSourceCount, 3);
  assert.equal(surface.examplePruning.productionGuardrails.productionMutationProposed, false);
  assert.equal(surface.lifecycleEvaluation.recommendedAction, 'human-review');
  assert.equal(surface.examplePruning.productionGuardrails.autoRemovalAllowed, false);
  assert.equal(surface.lifecycleEvaluation.currentState, 'shadow');
  assert.equal(surface.lifecycleEvaluation.nextAllowedState, 'approved');
  assert.equal(surface.lifecycleEvaluation.blocked, true);
  assert.ok(surface.lifecycleEvaluation.blockedReasons.includes('next state crosses human approval boundary'));
  assert.equal(surface.lifecycleBatchEvaluation.version, 'source-lifecycle-batch-v1');
  assert.equal(surface.lifecycleBatchEvaluation.candidateCount, 1);
  assert.equal(surface.lifecycleBatchEvaluation.blockedCount, 1);
  assert.equal(surface.lifecycleBatchEvaluation.evaluations[0].candidateId, 'candidate-maritime-example-001');
  assert.equal(surface.lifecycleBatchEvaluation.evaluations[0].evaluation.recommendedAction, 'human-review');
  assert.equal(surface.shadow.items[0].promotionReadiness, 'shadow-ready');
  assert.equal(surface.lifecycleTransitions.stateCount, 9);
});

test('source ops surface attaches live source-health state when snapshot health entries exist', () => {
  const surface = buildSourceOpsSurface({
    rootDir,
    snapshot: {
      healthSummary: {
        entries: [
          { name: 'ACLED', state: 'ok', ageMinutes: 11, failure: { class: 'none' } },
          { name: 'Bluesky', state: 'failed', ageMinutes: 88, failure: { class: 'external-limit' } },
          { name: 'Telegram', state: 'ok', ageMinutes: 4, failure: { class: 'none' } },
          { name: 'GDELT', state: 'ok', ageMinutes: 7, failure: { class: 'none' } },
        ],
      },
      newsFeed: [
        { type: 'telegram', source: 'INTELSLAVA' },
        { type: 'rss', source: 'NYT' },
        { type: 'rss', source: 'France 24' },
      ],
      newsClusters: [
        {
          id: 'iran::cluster-a',
          headline: 'Iran cluster',
          region: 'Iran',
          storyCount: 3,
          sourceCount: 2,
          sourceProvenance: {
            totalItems: 3,
            uniqueSources: 3,
            entries: [
              { source: 'Telegram', type: 'telegram', runtimeSource: 'Telegram', count: 1 },
              { source: 'NYT', type: 'unknown', runtimeSource: 'GDELT', count: 1 },
              { source: 'France 24', type: 'unknown', runtimeSource: 'GDELT', count: 1 },
              { source: 'Operator Feed', type: 'unknown', runtimeSource: 'GDELT', count: 1 },
              { source: 'Operator Feed', type: 'telegram', runtimeSource: 'Telegram', count: 1 },
            ],
            topSources: [
              { source: 'NYT', type: 'unknown', runtimeSource: 'GDELT', count: 1 },
              { source: 'France 24', type: 'unknown', runtimeSource: 'GDELT', count: 1 },
              { source: 'Operator Feed', type: 'unknown', runtimeSource: 'GDELT', count: 1 },
              { source: 'Operator Feed', type: 'telegram', runtimeSource: 'Telegram', count: 1 },
              { source: 'Telegram', type: 'telegram', runtimeSource: 'Telegram', count: 1 },
            ],
          },
        },
        {
          id: 'africa::cluster-b',
          headline: 'Africa cluster',
          region: 'Africa',
          storyCount: 1,
          sourceCount: 1,
          sourceProvenance: {
            totalItems: 1,
            uniqueSources: 1,
            entries: [
              { source: 'Bluesky', type: 'social', runtimeSource: 'Bluesky', count: 1 },
            ],
            topSources: [
              { source: 'Bluesky', type: 'social', runtimeSource: 'Bluesky', count: 1 },
            ],
          },
        },
        {
          id: 'europe::cluster-c',
          headline: 'Europe cluster',
          region: 'Europe',
          storyCount: 2,
          sourceCount: 1,
          sourceProvenance: {
            totalItems: 2,
            uniqueSources: 2,
            entries: [
              { source: 'Operator Feed', type: 'unknown', runtimeSource: 'Operator Feed', count: 1 },
              { source: 'Field Desk', type: 'unknown', runtimeSource: 'Operator Feed', count: 1 },
            ],
            topSources: [
              { source: 'Operator Feed', type: 'unknown', runtimeSource: 'Operator Feed', count: 1 },
              { source: 'Field Desk', type: 'unknown', runtimeSource: 'Operator Feed', count: 1 },
            ],
          },
        },
      ],
      suspectSignals: [
        { category: 'source', signal: 'Telegram urgent cluster', evidenceSource: 'Telegram', source: 'Telegram', reason: 'Telegram shows urgent posts without corroboration' },
        { category: 'source', signal: 'Bluesky noise', evidenceSource: 'Bluesky', source: 'Bluesky', reason: 'degraded source behavior observed' },
      ],
      corroboratedSignals: [
        { signal: 'ACLED conflict confirmation', evidenceSource: 'ACLED', source: 'ACLED' },
      ],
      agentAnalysis: {
        tippingPoints: [
          { title: 'Watch ACLED', evidenceRefs: [{ id: 'acled', label: 'ACLED' }] },
        ],
      },
      newsClusterQuality: {
        high: 1,
        medium: 2,
        low: 3,
        heuristicOnly: 2,
        singleSource: 2,
        reviewMetrics: {
          lowConfidenceCount: 3,
          mergeCandidateCount: 1,
          splitCandidateCount: 2,
          suspiciousNearDuplicateCount: 1,
        },
      },
      sourcePerformanceHistory: {
        version: 'source-performance-history-v1',
        snapshotCount: 2,
        snapshots: [
          {
            timestamp: '2026-04-26T12:00:00.000Z',
            summary: { totalMeasuredSources: 30, withClusterAttribution: 4, withSignalContribution: 3, degradedOrFailing: 1, byTrustOutcome: { supportive: 1, mixed: 1, degraded: 1, none: 27 } },
            validationViews: { clusterQuality: [{ label: 'Low quality', value: 3 }], reviewPressure: [{ label: 'Low confidence', value: 3 }] },
            topImpactSources: [{ name: 'Bluesky', attentionScore: 5 }],
          },
          {
            timestamp: '2026-04-26T11:40:00.000Z',
            summary: { totalMeasuredSources: 30, withClusterAttribution: 2, withSignalContribution: 2, degradedOrFailing: 2, byTrustOutcome: { supportive: 0, mixed: 1, degraded: 2, none: 27 } },
            validationViews: { clusterQuality: [{ label: 'Low quality', value: 4 }], reviewPressure: [{ label: 'Low confidence', value: 4 }] },
            topImpactSources: [{ name: 'Bluesky', attentionScore: 3 }],
          },
        ],
        deltaViews: [
          {
            currentTimestamp: '2026-04-26T12:00:00.000Z',
            previousTimestamp: '2026-04-26T11:40:00.000Z',
            summaryDelta: { withClusterAttribution: 2, withSignalContribution: 1, degradedOrFailing: -1, byTrustOutcome: { supportive: 1, mixed: 0, degraded: -1, none: 0 }, clusterQuality: { 'Low quality': -1 }, reviewPressure: { 'Low confidence': -1 } },
            topSourceShifts: [{ name: 'Bluesky', attentionScoreDelta: 2, status: 'retained' }],
          },
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
  assert.equal(surface.inventory.liveStateSummary.ok, 3);
  assert.equal(surface.inventory.liveStateSummary.failed, 1);
  const acledPerf = surface.performance.items.find(item => item.name === 'ACLED');
  const telegramPerf = surface.performance.items.find(item => item.name === 'Telegram');
  const gdeltPerf = surface.performance.items.find(item => item.name === 'GDELT');
  const blueskyPerf = surface.performance.items.find(item => item.name === 'Bluesky');
  assert.equal(acledPerf.contribution.corroboratedSignals, 1);
  assert.equal(acledPerf.contribution.citedByTippingPoints, 1);
  assert.equal(telegramPerf.contribution.feedItems, 1);
  assert.equal(telegramPerf.contribution.clusteredItems, 2);
  assert.equal(telegramPerf.contribution.clusteredStories, 1);
  assert.equal(telegramPerf.contribution.suspectSignals, 1);
  assert.equal(gdeltPerf.contribution.feedItems, 2);
  assert.equal(gdeltPerf.contribution.clusteredItems, 3);
  assert.equal(gdeltPerf.contribution.clusteredStories, 1);
  assert.equal(blueskyPerf.contribution.clusteredItems, 1);
  assert.equal(blueskyPerf.trustOutcome, 'degraded');
  assert.equal(surface.performance.measurementNotes.directClusterAttribution.includes('available'), true);
  assert.equal(surface.performance.withClusterAttribution >= 3, true);
  assert.equal(surface.performance.targets.reviewPressure.lowConfidenceCount, 3);
  assert.equal(surface.performance.withSignalContribution >= 3, true);
  assert.equal(surface.performance.attributionCoverage.clusterAttributedRatio > 0, true);
  assert.equal(surface.performance.workflow.validationViews.clusterQuality.find(item => item.label === 'Low quality')?.value, 3);
  assert.equal(surface.performance.workflow.validationViews.trustOutcomes.find(item => item.label === 'degraded')?.value >= 1, true);
  assert.ok(surface.performance.workflow.confidenceCaveats.some(item => /heuristic-only cluster/i.test(item)));
  assert.equal(surface.performance.workflow.attributionDiagnostics.version, 'source-attribution-diagnostics-v1');
  assert.equal(surface.performance.workflow.attributionDiagnostics.summary.aliasCollisionCount >= 1, true);
  assert.equal(surface.performance.workflow.attributionDiagnostics.summary.expectedMultiPublisherBucketCount >= 1, true);
  assert.equal(surface.performance.workflow.attributionDiagnostics.summary.ambiguousMappingCount >= 1, true);
  assert.equal(surface.performance.workflow.attributionDiagnostics.summary.doubleCountRiskCount >= 1, true);
  assert.ok(surface.performance.workflow.attributionDiagnostics.aliasCollisions.some(item => item.runtimeSource === 'Operator Feed'));
  const gdeltBucket = surface.performance.workflow.attributionDiagnostics.expectedMultiPublisherBuckets.find(item => item.runtimeSource === 'GDELT');
  assert.ok(gdeltBucket);
  assert.match(gdeltBucket.reason, /source registry|aggregates many upstream publishers/i);
  assert.ok(surface.performance.workflow.attributionDiagnostics.ambiguousMappings.some(item => item.sourceName === 'Operator Feed'));
  assert.equal(surface.performance.workflow.attributionDiagnostics.runtimeBucketDrift.version, 'source-runtime-bucket-drift-v1');
  assert.equal(surface.performance.workflow.attributionDiagnostics.summary.runtimeBucketDriftCount, 2);
  assert.equal(surface.performance.workflow.attributionDiagnostics.summary.singlePublisherMismatchCount, 1);
  assert.equal(surface.performance.workflow.attributionDiagnostics.summary.missingAggregatorAliasCount, 1);
  const telegramDrift = surface.performance.workflow.attributionDiagnostics.runtimeBucketDrift.items.find(item => item.runtimeSource === 'Telegram');
  assert.ok(telegramDrift);
  assert.equal(telegramDrift.driftKind, 'single-publisher-mismatch');
  assert.match(telegramDrift.summary, /declared single-publisher/i);
  const gdeltDrift = surface.performance.workflow.attributionDiagnostics.runtimeBucketDrift.items.find(item => item.runtimeSource === 'GDELT');
  assert.ok(gdeltDrift);
  assert.equal(gdeltDrift.driftKind, 'missing-aggregator-alias');
  assert.ok(gdeltDrift.unexpectedObservedAliases.some(item => item.name === 'Operator Feed'));
  const iranRisk = surface.performance.workflow.attributionDiagnostics.doubleCountRisks.find(item => item.clusterId === 'iran::cluster-a');
  assert.ok(iranRisk);
  assert.ok(iranRisk.duplicateRuntimeSources.includes('Telegram'));
  assert.ok(!iranRisk.duplicateRuntimeSources.includes('GDELT'));
  assert.ok(iranRisk.expectedMultiPublisherBuckets.includes('GDELT'));
  assert.ok(Array.isArray(telegramPerf.attributionExplanation));
  assert.ok(telegramPerf.attributionExplanation.some(item => /clustered item/i.test(item)));
  assert.ok(Array.isArray(blueskyPerf.confidenceCaveats));
  assert.ok(blueskyPerf.confidenceCaveats.some(item => /failed|degradation/i.test(item)));
  assert.equal(surface.history.current.failingNow, 1);
  assert.equal(surface.history.current.failureCounts['external-limit'], 1);
  assert.equal(surface.performanceHistory.version, 'source-performance-history-v1');
  assert.equal(surface.performanceHistory.snapshotCount, 2);
  assert.equal(surface.performanceHistory.snapshots[0].summary.withClusterAttribution, 4);
  assert.equal(surface.performanceHistory.deltaViews[0].summaryDelta.withClusterAttribution, 2);
  assert.equal(surface.performanceHistory.deltaViews[0].topSourceShifts[0].name, 'Bluesky');
});
