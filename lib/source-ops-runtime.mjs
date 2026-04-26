import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadExampleLifecycleEvaluation, loadExampleLifecycleBatch } from './source-lifecycle-policy.mjs';
import { summarizeSourceFusionRoles } from './source-registry.mjs';
import {
  summarizeSourceGradingRubric,
  summarizeSourceScorecard,
  summarizeSourceOverlapRubric,
  summarizeSourceOverlapAssessment,
  summarizeSourcePruningRubric,
  summarizeSourcePruningAssessment,
} from './source-scorecard.mjs';

function readJsonIfPresent(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function countBy(items = [], key) {
  return Object.fromEntries(
    Array.from(new Set(items.map(item => item?.[key] || 'unknown')))
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map(value => [value, items.filter(item => (item?.[key] || 'unknown') === value).length])
  );
}

function summarizeNeeds(needs = {}) {
  const gaps = Array.isArray(needs?.gaps) ? needs.gaps : [];
  return {
    total: gaps.length,
    highPriority: gaps.filter(gap => gap?.priority === 'high').length,
    byCategory: countBy(gaps, 'category'),
    byKind: countBy(gaps, 'kind'),
    items: gaps.map(gap => ({
      id: gap.id || null,
      kind: gap.kind || 'unknown',
      category: gap.category || 'other',
      priority: gap.priority || 'unknown',
      summary: gap.summary || null,
    })),
    runtimeSignals: needs?.runtimeSignals || null,
  };
}

function summarizeShadowCandidates(items = []) {
  const shadowItems = items.filter(item => item.lifecycle === 'shadow');
  return {
    total: shadowItems.length,
    readyForHumanReview: shadowItems.filter(item => item.shadow?.promotionReadiness === 'shadow-ready').length,
    blockedFromProduction: shadowItems.filter(item => item.shadow?.productionInfluenceBlocked).length,
    byCategory: countBy(shadowItems, 'category'),
    byOperatorRole: countBy(shadowItems, 'operatorRole'),
    items: shadowItems.map(item => ({
      id: item.id,
      name: item.name,
      category: item.category,
      operatorRole: item.operatorRole,
      trustClass: item.trustClass,
      productionInfluenceBlocked: Boolean(item.shadow?.productionInfluenceBlocked),
      observationMode: item.shadow?.observationMode || null,
      promotionReadiness: item.shadow?.promotionReadiness || null,
      eligibleNextStates: Array.isArray(item.shadow?.eligibleNextStates) ? item.shadow.eligibleNextStates : [],
      scorecardRef: item.shadow?.scorecardRef || null,
      overlapRef: item.shadow?.overlapRef || null,
      lastObservedAt: item.shadow?.lastObservedAt || null,
      review: item.review || null,
    })),
  };
}

function summarizeLifecycleTransitionPolicy(policy = null) {
  const states = policy?.states && typeof policy.states === 'object' ? policy.states : {};
  const orderedStates = Object.entries(states).map(([state, value]) => ({
    state,
    allowedNextStates: Array.isArray(value?.allowedNextStates) ? value.allowedNextStates : [],
    agentMayAdvance: Boolean(value?.agentMayAdvance),
    requirementCount: Array.isArray(value?.requirements) ? value.requirements.length : 0,
  }));
  return {
    version: policy?.version || null,
    generatedAt: policy?.generatedAt || null,
    contractMode: policy?.contractMode || null,
    defaultEntryState: policy?.defaultEntryState || null,
    preProductionAutoAdvanceMax: policy?.preProductionAutoAdvanceMax || null,
    activePromotionRequiresHumanApproval: Boolean(policy?.activePromotionRequiresHumanApproval),
    autoAdvanceStates: orderedStates.filter(item => item.agentMayAdvance).map(item => item.state),
    humanApprovalBoundaryStates: orderedStates.filter(item => !item.agentMayAdvance && item.allowedNextStates.length > 0).map(item => item.state),
    stateCount: orderedStates.length,
    states: orderedStates,
    promotionReadinessGuards: policy?.promotionReadinessGuards || null,
    operatorExpectations: policy?.operatorExpectations || null,
  };
}

function normalizeAttributionName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const EXPECTED_MULTI_PUBLISHER_RUNTIME_TOKENS = new Set(['gdelt', 'rss', 'news']);

function classifyRuntimeBucket(runtimeToken, runtimeSource, sourceNames = new Map()) {
  const names = Array.from(sourceNames.entries()).map(([name, count]) => ({
    name,
    count,
    token: normalizeAttributionName(name) || 'unknown',
  }));
  const uniqueTokens = new Set(names.map(item => item.token));
  const containsRuntimeNamedAlias = names.some(item => item.token === runtimeToken);
  const looksLikeExpectedMultiPublisher =
    EXPECTED_MULTI_PUBLISHER_RUNTIME_TOKENS.has(runtimeToken) ||
    (!containsRuntimeNamedAlias && uniqueTokens.size >= 3);

  if (looksLikeExpectedMultiPublisher) {
    return {
      kind: 'expected-multi-publisher',
      aliasLike: false,
      reason: EXPECTED_MULTI_PUBLISHER_RUNTIME_TOKENS.has(runtimeToken)
        ? 'runtime bucket is a known multi-publisher aggregator'
        : 'runtime bucket carries several distinct publisher labels without alias-style overlap',
      sourceNames: names,
    };
  }

  return {
    kind: 'alias-collision',
    aliasLike: true,
    reason: containsRuntimeNamedAlias
      ? 'runtime bucket mixes its own label with additional publisher labels'
      : 'runtime bucket shows multiple publisher labels outside expected aggregator patterns',
    sourceNames: names,
  };
}

function measurementTargets(snapshot = {}) {
  const clusters = Array.isArray(snapshot?.newsClusters) ? snapshot.newsClusters : [];
  const quality = snapshot?.newsClusterQuality || null;
  const reviewMetrics = quality?.reviewMetrics || null;
  return {
    clusterQuality: quality ? {
      high: quality.high || 0,
      medium: quality.medium || 0,
      low: quality.low || 0,
      heuristicOnly: quality.heuristicOnly || 0,
      singleSource: quality.singleSource || 0,
    } : {
      high: clusters.filter(item => item?.quality === 'high').length,
      medium: clusters.filter(item => item?.quality === 'medium').length,
      low: clusters.filter(item => item?.quality === 'low').length,
      heuristicOnly: clusters.filter(item => (item?.qualityFlags || []).includes('heuristic-only')).length,
      singleSource: clusters.filter(item => (item?.qualityFlags || []).includes('single-source')).length,
    },
    reviewPressure: reviewMetrics ? {
      lowConfidenceCount: reviewMetrics.lowConfidenceCount || 0,
      mergeCandidateCount: reviewMetrics.mergeCandidateCount || 0,
      splitCandidateCount: reviewMetrics.splitCandidateCount || 0,
      suspiciousNearDuplicateCount: reviewMetrics.suspiciousNearDuplicateCount || 0,
    } : null,
    tippingPointCount: Array.isArray(snapshot?.agentAnalysis?.tippingPoints) ? snapshot.agentAnalysis.tippingPoints.length : 0,
  };
}

function buildAttributionUncertaintyDiagnostics(items = [], snapshot = {}) {
  const clusters = Array.isArray(snapshot?.newsClusters) ? snapshot.newsClusters : [];
  const aliasSummary = new Map();
  const expectedMultiPublisherSummary = new Map();
  const normalizedSourceMappings = new Map();
  const doubleCountRisks = [];
  const uncertainClusters = [];

  for (const cluster of clusters) {
    const entries = Array.isArray(cluster?.sourceProvenance?.entries) ? cluster.sourceProvenance.entries : [];
    const runtimeGroups = new Map();
    const sourceGroups = new Map();
    let unattributedEntries = 0;

    for (const entry of entries) {
      const runtimeName = String(entry?.runtimeSource || entry?.type || 'unknown').trim() || 'unknown';
      const sourceName = String(entry?.source || entry?.runtimeSource || entry?.type || 'unknown').trim() || 'unknown';
      const runtimeToken = normalizeAttributionName(runtimeName) || 'unknown';
      const sourceToken = normalizeAttributionName(sourceName) || 'unknown';

      if (!entry?.runtimeSource) unattributedEntries += Number(entry?.count) || 1;

      if (!runtimeGroups.has(runtimeToken)) runtimeGroups.set(runtimeToken, { runtimeSource: runtimeName, sourceNames: new Map(), clusterIds: new Set() });
      runtimeGroups.get(runtimeToken).sourceNames.set(sourceName, (runtimeGroups.get(runtimeToken).sourceNames.get(sourceName) || 0) + (Number(entry?.count) || 1));
      runtimeGroups.get(runtimeToken).clusterIds.add(cluster.id || 'unknown');

      if (!sourceGroups.has(sourceToken)) sourceGroups.set(sourceToken, new Set());
      sourceGroups.get(sourceToken).add(runtimeName);

      if (!normalizedSourceMappings.has(sourceToken)) normalizedSourceMappings.set(sourceToken, { sourceName, runtimeSources: new Set(), seenInClusters: new Set() });
      normalizedSourceMappings.get(sourceToken).runtimeSources.add(runtimeName);
      normalizedSourceMappings.get(sourceToken).seenInClusters.add(cluster.id || 'unknown');
    }

    for (const [runtimeToken, info] of runtimeGroups.entries()) {
      if (info.sourceNames.size <= 1) continue;
      const classification = classifyRuntimeBucket(runtimeToken, info.runtimeSource, info.sourceNames);
      const targetMap = classification.aliasLike ? aliasSummary : expectedMultiPublisherSummary;
      if (!targetMap.has(runtimeToken)) targetMap.set(runtimeToken, {
        runtimeSource: info.runtimeSource,
        sourceNames: new Map(),
        clusterIds: new Set(),
        classification: classification.kind,
        reason: classification.reason,
      });
      const target = targetMap.get(runtimeToken);
      for (const [name, count] of info.sourceNames.entries()) target.sourceNames.set(name, (target.sourceNames.get(name) || 0) + count);
      for (const clusterId of info.clusterIds) target.clusterIds.add(clusterId);
    }

    const duplicateRuntimeSources = Array.from(runtimeGroups.entries())
      .filter(([, info]) => info.sourceNames.size > 1)
      .map(([runtimeToken, info]) => ({ runtimeToken, runtimeSource: info.runtimeSource, sourceNames: info.sourceNames }))
      .filter(item => classifyRuntimeBucket(item.runtimeToken, item.runtimeSource, item.sourceNames).aliasLike)
      .map(item => item.runtimeSource);
    const expectedMultiPublisherBuckets = Array.from(runtimeGroups.entries())
      .filter(([, info]) => info.sourceNames.size > 1)
      .map(([runtimeToken, info]) => ({ runtimeToken, runtimeSource: info.runtimeSource, sourceNames: info.sourceNames }))
      .filter(item => !classifyRuntimeBucket(item.runtimeToken, item.runtimeSource, item.sourceNames).aliasLike)
      .map(item => item.runtimeSource);
    const ambiguousSourceMappings = Array.from(sourceGroups.entries())
      .filter(([, runtimeNames]) => runtimeNames.size > 1)
      .map(([sourceToken, runtimeNames]) => ({
        sourceToken,
        runtimeSources: Array.from(runtimeNames).sort((a, b) => a.localeCompare(b)),
      }));

    const riskScore =
      (duplicateRuntimeSources.length * 2) +
      ambiguousSourceMappings.length +
      (unattributedEntries > 0 ? 1 : 0) +
      (((cluster?.qualityFlags || []).includes('heuristic-only')) ? 1 : 0) +
      (((cluster?.qualityFlags || []).includes('single-source')) ? 1 : 0);

    if (riskScore > 0) {
      doubleCountRisks.push({
        clusterId: cluster.id || null,
        headline: cluster.headline || cluster.summary || cluster.id || 'cluster',
        region: cluster.region || 'Unknown',
        riskScore,
        duplicateRuntimeSources,
        expectedMultiPublisherBuckets,
        ambiguousSourceMappings,
        unattributedEntries,
      });
      uncertainClusters.push({
        clusterId: cluster.id || null,
        headline: cluster.headline || cluster.summary || cluster.id || 'cluster',
        region: cluster.region || 'Unknown',
        quality: cluster.quality || null,
        confidenceLabel: cluster.confidenceLabel || null,
        riskScore,
        reasons: [
          duplicateRuntimeSources.length ? `${duplicateRuntimeSources.length} runtime source alias grouping${duplicateRuntimeSources.length === 1 ? '' : 's'} inside cluster provenance` : null,
          expectedMultiPublisherBuckets.length ? `${expectedMultiPublisherBuckets.length} runtime bucket${expectedMultiPublisherBuckets.length === 1 ? '' : 's'} look like expected multi-publisher aggregators` : null,
          ambiguousSourceMappings.length ? `${ambiguousSourceMappings.length} source label${ambiguousSourceMappings.length === 1 ? '' : 's'} resolve to multiple runtime-source buckets` : null,
          unattributedEntries > 0 ? `${unattributedEntries} provenance entr${unattributedEntries === 1 ? 'y lacks' : 'ies lack'} runtime-source attribution` : null,
          (cluster?.qualityFlags || []).includes('heuristic-only') ? 'cluster is still heuristic-only' : null,
          (cluster?.qualityFlags || []).includes('single-source') ? 'cluster is single-source, so attribution is fragile' : null,
        ].filter(Boolean),
      });
    }
  }

  const aliasCollisions = Array.from(aliasSummary.values())
    .map(item => ({
      runtimeSource: item.runtimeSource,
      aliasCount: item.sourceNames.size,
      clusterCount: item.clusterIds.size,
      sourceNames: Array.from(item.sourceNames.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count })),
    }))
    .sort((a, b) => b.aliasCount - a.aliasCount || b.clusterCount - a.clusterCount || a.runtimeSource.localeCompare(b.runtimeSource))
    .slice(0, 8);

  const expectedMultiPublisherBuckets = Array.from(expectedMultiPublisherSummary.values())
    .map(item => ({
      runtimeSource: item.runtimeSource,
      publisherCount: item.sourceNames.size,
      clusterCount: item.clusterIds.size,
      reason: item.reason,
      sourceNames: Array.from(item.sourceNames.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count })),
    }))
    .sort((a, b) => b.publisherCount - a.publisherCount || b.clusterCount - a.clusterCount || a.runtimeSource.localeCompare(b.runtimeSource))
    .slice(0, 8);

  const ambiguousMappings = Array.from(normalizedSourceMappings.values())
    .filter(item => item.runtimeSources.size > 1)
    .map(item => ({
      sourceName: item.sourceName,
      runtimeSourceCount: item.runtimeSources.size,
      runtimeSources: Array.from(item.runtimeSources).sort((a, b) => a.localeCompare(b)),
      clusterCount: item.seenInClusters.size,
    }))
    .sort((a, b) => b.runtimeSourceCount - a.runtimeSourceCount || b.clusterCount - a.clusterCount || a.sourceName.localeCompare(b.sourceName))
    .slice(0, 8);

  const itemCaveatCount = items.reduce((sum, item) => sum + ((item.confidenceCaveats || []).length > 0 ? 1 : 0), 0);
  const topUncertainSources = items
    .filter(item => (item.confidenceCaveats || []).length > 0 || item.trustOutcome === 'mixed' || item.trustOutcome === 'degraded')
    .sort((a, b) => ((b.confidenceCaveats || []).length - (a.confidenceCaveats || []).length) || (b.attentionScore - a.attentionScore) || a.name.localeCompare(b.name))
    .slice(0, 6)
    .map(item => ({
      name: item.name,
      trustOutcome: item.trustOutcome,
      attentionScore: item.attentionScore,
      caveats: item.confidenceCaveats || [],
    }));

  return {
    version: 'source-attribution-diagnostics-v1',
    summary: {
      aliasCollisionCount: aliasCollisions.length,
      expectedMultiPublisherBucketCount: expectedMultiPublisherBuckets.length,
      ambiguousMappingCount: ambiguousMappings.length,
      doubleCountRiskCount: doubleCountRisks.length,
      uncertainClusterCount: uncertainClusters.length,
      sourceCaveatCount: itemCaveatCount,
    },
    aliasCollisions,
    expectedMultiPublisherBuckets,
    ambiguousMappings,
    doubleCountRisks: doubleCountRisks
      .sort((a, b) => b.riskScore - a.riskScore || a.region.localeCompare(b.region) || a.headline.localeCompare(b.headline))
      .slice(0, 8),
    uncertainClusters: uncertainClusters
      .sort((a, b) => b.riskScore - a.riskScore || a.region.localeCompare(b.region) || a.headline.localeCompare(b.headline))
      .slice(0, 6),
    topUncertainSources,
  };
}

function summarizeSourcePerformance(items = [], snapshot = {}) {
  const sourceNames = new Map(items.map(item => [normalizeAttributionName(item.name), item.name]));
  const aliases = new Map([
    ['adsb', 'ADS-B'],
    ['opensky', 'OpenSky'],
    ['opensanctions', 'OpenSanctions'],
    ['cloudflareradar', 'Cloudflare-Radar'],
    ['cisakev', 'CISA-KEV'],
    ['kiwisdr', 'KiwiSDR'],
    ['gdelt', 'GDELT'],
    ['rss', 'GDELT'],
    ['news', 'GDELT'],
    ['telegram', 'Telegram'],
    ['reddit', 'Reddit'],
    ['bluesky', 'Bluesky'],
    ['yfinance', 'YFinance'],
  ]);
  const counters = new Map(items.map(item => [item.name, {
    feedItems: 0,
    clusteredItems: 0,
    clusteredStories: 0,
    suspectSignals: 0,
    corroboratedSignals: 0,
    degradationSignals: 0,
    citedByTippingPoints: 0,
  }]));

  const resolveNames = (...values) => {
    const resolved = new Set();
    for (const value of values) {
      const normalized = normalizeAttributionName(value);
      if (!normalized || normalized === 'mixed') continue;
      if (sourceNames.has(normalized)) resolved.add(sourceNames.get(normalized));
      if (aliases.has(normalized)) resolved.add(aliases.get(normalized));
    }
    return Array.from(resolved).filter(name => counters.has(name));
  };

  for (const item of Array.isArray(snapshot?.newsFeed) ? snapshot.newsFeed : []) {
    for (const name of resolveNames(item?.type, item?.evidenceSource, item?.source)) {
      counters.get(name).feedItems += 1;
    }
  }

  for (const cluster of Array.isArray(snapshot?.newsClusters) ? snapshot.newsClusters : []) {
    const entries = Array.isArray(cluster?.sourceProvenance?.entries) ? cluster.sourceProvenance.entries : [];
    const storyNames = new Set();
    for (const entry of entries) {
      for (const name of resolveNames(entry?.runtimeSource, entry?.source, entry?.type)) {
        counters.get(name).clusteredItems += Number(entry?.count) || 0;
        storyNames.add(name);
      }
    }
    for (const name of storyNames) {
      counters.get(name).clusteredStories += 1;
    }
  }

  for (const signal of Array.isArray(snapshot?.suspectSignals) ? snapshot.suspectSignals : []) {
    for (const name of resolveNames(signal?.evidenceSource, signal?.source)) {
      counters.get(name).suspectSignals += 1;
      if (signal?.category === 'source' || /degrad/i.test(String(signal?.reason || ''))) counters.get(name).degradationSignals += 1;
    }
  }

  for (const signal of Array.isArray(snapshot?.corroboratedSignals) ? snapshot.corroboratedSignals : []) {
    for (const name of resolveNames(signal?.evidenceSource, signal?.source)) {
      counters.get(name).corroboratedSignals += 1;
    }
  }

  for (const point of Array.isArray(snapshot?.agentAnalysis?.tippingPoints) ? snapshot.agentAnalysis.tippingPoints : []) {
    for (const ref of Array.isArray(point?.evidenceRefs) ? point.evidenceRefs : []) {
      for (const name of resolveNames(ref?.label, ref?.id)) {
        counters.get(name).citedByTippingPoints += 1;
      }
    }
  }

  const targets = measurementTargets(snapshot);
  const byTrustOutcome = { supportive: 0, mixed: 0, degraded: 0, none: 0 };
  const measuredItems = items.map(item => {
    const counts = counters.get(item.name) || { feedItems: 0, clusteredItems: 0, clusteredStories: 0, suspectSignals: 0, corroboratedSignals: 0, degradationSignals: 0, citedByTippingPoints: 0 };
    const livePenalty = item.liveState === 'failed' ? 2 : item.liveState === 'degraded' ? 1 : item.liveState === 'stale' ? 1 : 0;
    const signalCount = counts.suspectSignals + counts.corroboratedSignals + counts.degradationSignals;
    const attentionScore = counts.corroboratedSignals * 3 + counts.suspectSignals * 2 + counts.degradationSignals * 2 + counts.citedByTippingPoints * 2 + Math.min(counts.clusteredItems, 3) + Math.min(counts.clusteredStories, 2) + livePenalty;
    const noiseScore = counts.suspectSignals + counts.degradationSignals + (item.operatorRole === 'exploratory' ? 1 : 0) + (item.trustClass === 'low' ? 1 : 0);
    const trustOutcome = counts.corroboratedSignals > counts.suspectSignals && counts.corroboratedSignals > 0
      ? 'supportive'
      : counts.degradationSignals > 0 || item.liveState === 'failed'
        ? 'degraded'
        : signalCount > 0
          ? 'mixed'
          : 'none';
    const attributionExplanation = [
      counts.clusteredItems > 0 ? `${counts.clusteredItems} clustered item${counts.clusteredItems === 1 ? '' : 's'} across ${counts.clusteredStories} stor${counts.clusteredStories === 1 ? 'y' : 'ies'}` : null,
      counts.feedItems > 0 ? `${counts.feedItems} feed item${counts.feedItems === 1 ? '' : 's'} observed` : null,
      counts.corroboratedSignals > 0 ? `${counts.corroboratedSignals} corroborated signal${counts.corroboratedSignals === 1 ? '' : 's'}` : null,
      counts.suspectSignals > 0 ? `${counts.suspectSignals} suspect signal${counts.suspectSignals === 1 ? '' : 's'}` : null,
      counts.degradationSignals > 0 ? `${counts.degradationSignals} degradation signal${counts.degradationSignals === 1 ? '' : 's'}` : null,
      counts.citedByTippingPoints > 0 ? `${counts.citedByTippingPoints} tipping-point citation${counts.citedByTippingPoints === 1 ? '' : 's'}` : null,
      item.liveState && item.liveState !== 'ok' ? `live state ${item.liveState}` : null,
    ].filter(Boolean);
    const confidenceCaveats = [
      counts.clusteredItems === 0 ? 'no direct cluster attribution in current snapshot' : null,
      counts.corroboratedSignals === 0 && signalCount > 0 ? 'signal mix lacks corroborated support' : null,
      counts.suspectSignals > counts.corroboratedSignals ? 'suspect signals outweigh corroborated signals' : null,
      counts.degradationSignals > 0 ? 'source degradation is affecting interpretation' : null,
      item.liveState === 'failed' ? 'source currently failed' : item.liveState === 'stale' ? 'source currently stale' : null,
      signalCount === 0 && counts.feedItems === 0 && counts.clusteredItems === 0 ? 'no measured impact in current snapshot' : null,
    ].filter(Boolean);
    byTrustOutcome[trustOutcome] += 1;
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      trustClass: item.trustClass,
      operatorRole: item.operatorRole,
      liveState: item.liveState,
      contribution: {
        feedItems: counts.feedItems,
        clusteredItems: counts.clusteredItems,
        clusteredStories: counts.clusteredStories,
        suspectSignals: counts.suspectSignals,
        corroboratedSignals: counts.corroboratedSignals,
        degradationSignals: counts.degradationSignals,
        citedByTippingPoints: counts.citedByTippingPoints,
        totalSignals: signalCount,
      },
      noiseScore,
      attentionScore,
      trustOutcome,
      impactLabel: attentionScore >= 6 ? 'high' : attentionScore >= 3 ? 'medium' : attentionScore >= 1 ? 'low' : 'none',
      attributionExplanation,
      confidenceCaveats,
      measurementBasis: {
        feedCoverage: true,
        signalCoverage: true,
        tippingPointCoverage: true,
        directClusterAttribution: true,
      },
    };
  }).sort((a, b) => b.attentionScore - a.attentionScore || a.name.localeCompare(b.name));

  const clusterQualityTotals = targets.clusterQuality || {};
  const reviewPressure = targets.reviewPressure || {};
  const confidenceCaveats = [
    clusterQualityTotals.low > clusterQualityTotals.high ? `low-quality clusters exceed high-quality clusters (${clusterQualityTotals.low} > ${clusterQualityTotals.high})` : null,
    (clusterQualityTotals.heuristicOnly || 0) > 0 ? `${clusterQualityTotals.heuristicOnly} heuristic-only cluster${clusterQualityTotals.heuristicOnly === 1 ? '' : 's'} reduce attribution certainty` : null,
    (clusterQualityTotals.singleSource || 0) > 0 ? `${clusterQualityTotals.singleSource} single-source cluster${clusterQualityTotals.singleSource === 1 ? '' : 's'} limit corroboration` : null,
    (reviewPressure.lowConfidenceCount || 0) > 0 ? `${reviewPressure.lowConfidenceCount} low-confidence cluster${reviewPressure.lowConfidenceCount === 1 ? '' : 's'} still need review` : null,
    (reviewPressure.suspiciousNearDuplicateCount || 0) > 0 ? `${reviewPressure.suspiciousNearDuplicateCount} suspicious near-duplicate cluster${reviewPressure.suspiciousNearDuplicateCount === 1 ? '' : 's'} may distort attribution` : null,
  ].filter(Boolean);
  const attributionDiagnostics = buildAttributionUncertaintyDiagnostics(measuredItems, snapshot);
  const validationViews = {
    clusterQuality: [
      { label: 'High quality', value: clusterQualityTotals.high || 0 },
      { label: 'Medium quality', value: clusterQualityTotals.medium || 0 },
      { label: 'Low quality', value: clusterQualityTotals.low || 0 },
      { label: 'Heuristic only', value: clusterQualityTotals.heuristicOnly || 0 },
      { label: 'Single source', value: clusterQualityTotals.singleSource || 0 },
    ],
    reviewPressure: [
      { label: 'Low confidence', value: reviewPressure.lowConfidenceCount || 0 },
      { label: 'Merge candidates', value: reviewPressure.mergeCandidateCount || 0 },
      { label: 'Split candidates', value: reviewPressure.splitCandidateCount || 0 },
      { label: 'Near duplicates', value: reviewPressure.suspiciousNearDuplicateCount || 0 },
    ],
    trustOutcomes: Object.entries(byTrustOutcome).map(([label, value]) => ({ label, value })),
  };

  return {
    version: 'source-performance-workflow-v1',
    totalMeasuredSources: measuredItems.length,
    withFeedContribution: measuredItems.filter(item => item.contribution.feedItems > 0).length,
    withClusterAttribution: measuredItems.filter(item => item.contribution.clusteredItems > 0).length,
    withSignalContribution: measuredItems.filter(item => item.contribution.totalSignals > 0).length,
    withTippingPointCitation: measuredItems.filter(item => item.contribution.citedByTippingPoints > 0).length,
    degradedOrFailing: measuredItems.filter(item => ['failed', 'degraded', 'stale'].includes(item.liveState)).length,
    byTrustOutcome,
    targets,
    attributionCoverage: {
      clusterAttributedRatio: measuredItems.length ? Number((measuredItems.filter(item => item.contribution.clusteredItems > 0).length / measuredItems.length).toFixed(2)) : 0,
      signalCoverageRatio: measuredItems.length ? Number((measuredItems.filter(item => item.contribution.totalSignals > 0).length / measuredItems.length).toFixed(2)) : 0,
      tippingPointCoverageRatio: measuredItems.length ? Number((measuredItems.filter(item => item.contribution.citedByTippingPoints > 0).length / measuredItems.length).toFixed(2)) : 0,
    },
    topImpactSources: measuredItems.filter(item => item.attentionScore > 0).slice(0, 8).map(item => ({
      name: item.name,
      attentionScore: item.attentionScore,
      impactLabel: item.impactLabel,
      trustOutcome: item.trustOutcome,
      contribution: item.contribution,
      attributionExplanation: item.attributionExplanation,
      confidenceCaveats: item.confidenceCaveats,
    })),
    items: measuredItems,
    workflow: {
      version: 'source-performance-workflow-v1',
      attributionDiagnostics,
      attributionHeadlines: measuredItems.filter(item => item.attentionScore > 0).slice(0, 5).map(item => ({
        id: item.id,
        name: item.name,
        impactLabel: item.impactLabel,
        trustOutcome: item.trustOutcome,
        attentionScore: item.attentionScore,
        explanation: item.attributionExplanation,
        caveats: item.confidenceCaveats,
      })),
      confidenceCaveats,
      validationViews,
    },
    measurementNotes: {
      directClusterAttribution: 'available from per-cluster source provenance summaries derived from clustered item sources and types',
      intendedValidationTargets: ['cluster quality', 'review pressure', 'tipping-point quality', 'trust outcomes'],
    },
  };
}

function summarizeSourceHistory(items = [], snapshot = {}) {
  const trendWindows = Array.isArray(snapshot?.trendSummary?.windows) ? snapshot.trendSummary.windows : [];
  const currentEntries = Array.isArray(snapshot?.healthSummary?.entries) ? snapshot.healthSummary.entries : [];
  const degradedNow = currentEntries.filter(entry => ['degraded', 'stale', 'failed'].includes(entry?.state)).length;
  const failureCounts = countBy(currentEntries.filter(entry => entry?.failure?.class && entry.failure.class !== 'none').map(entry => ({ failureClass: entry.failure.class })), 'failureClass');
  const noisySources = items
    .filter(item => ['failed', 'degraded', 'stale'].includes(item.liveState) || item.liveFailureClass)
    .sort((a, b) => (['failed', 'degraded', 'stale'].includes(b.liveState) ? 1 : 0) - (['failed', 'degraded', 'stale'].includes(a.liveState) ? 1 : 0) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 8)
    .map(item => ({
      id: item.id,
      name: item.name,
      liveState: item.liveState,
      liveFailureClass: item.liveFailureClass,
      freshnessTargetMinutes: item.freshnessTargetMinutes ?? null,
      liveAgeMinutes: item.liveAgeMinutes ?? null,
    }));
  return {
    version: 'source-health-history-v1',
    generatedAt: new Date().toISOString(),
    current: {
      total: currentEntries.length,
      degradedNow,
      failingNow: currentEntries.filter(entry => entry?.state === 'failed').length,
      staleNow: currentEntries.filter(entry => entry?.state === 'stale').length,
      failureCounts,
    },
    windows: trendWindows.map(window => ({
      hours: window?.hours || null,
      status: window?.status || 'empty',
      runCount: window?.runCount || 0,
      degradedRuns: window?.sourceHealth?.degradedRuns || 0,
      staleRuns: window?.sourceHealth?.staleRuns || 0,
      failedRuns: window?.sourceHealth?.failedRuns || 0,
      currentFailed: window?.sourceHealth?.currentFailed ?? null,
      maxFailed: window?.sourceHealth?.maxFailed ?? null,
    })),
    noisySources,
  };
}

function summarizeSourcePerformanceHistory(snapshot = {}) {
  const history = snapshot?.sourcePerformanceHistory;
  if (!history || typeof history !== 'object') return null;
  const snapshots = Array.isArray(history.snapshots) ? history.snapshots : [];
  const deltaViews = Array.isArray(history.deltaViews) ? history.deltaViews : [];
  return {
    version: history.version || 'source-performance-history-v1',
    generatedAt: history.generatedAt || null,
    snapshotCount: history.snapshotCount || snapshots.length,
    snapshots: snapshots.slice(0, 8).map(item => ({
      timestamp: item.timestamp || null,
      summary: item.summary || null,
      validationViews: item.validationViews || null,
      attributionHeadlines: Array.isArray(item.attributionHeadlines) ? item.attributionHeadlines : [],
      topImpactSources: Array.isArray(item.topImpactSources) ? item.topImpactSources : [],
    })),
    deltaViews: deltaViews.slice(0, 6).map(item => ({
      currentTimestamp: item.currentTimestamp || null,
      previousTimestamp: item.previousTimestamp || null,
      summaryDelta: item.summaryDelta || null,
      topSourceShifts: Array.isArray(item.topSourceShifts) ? item.topSourceShifts : [],
    })),
  };
}

export function loadSourceOpsWorkspace(rootDir) {
  const profile = readJsonIfPresent(join(rootDir, 'source-ops', 'profile.json'), null);
  const registry = readJsonIfPresent(join(rootDir, 'source-ops', 'source-registry.seed.json'), { version: null, sources: [] });
  const needs = readJsonIfPresent(join(rootDir, 'source-ops', 'runtime-needs.json'), { version: null, gaps: [] });
  const rubric = readJsonIfPresent(join(rootDir, 'source-ops', 'grading-rubric.json'), null);
  const overlapRubric = readJsonIfPresent(join(rootDir, 'source-ops', 'overlap-rubric.json'), null);
  const pruningRubric = readJsonIfPresent(join(rootDir, 'source-ops', 'pruning-rubric.json'), null);
  const actionTaxonomy = readJsonIfPresent(join(rootDir, 'source-ops', 'action-taxonomy.json'), null);
  const lifecycleTransitionPolicy = readJsonIfPresent(join(rootDir, 'source-ops', 'lifecycle-transition-policy.json'), null);
  const exampleScorecard = readJsonIfPresent(join(rootDir, 'source-ops', 'results', 'grading', 'example-grading-scorecard.json'), null);
  const exampleOverlap = readJsonIfPresent(join(rootDir, 'source-ops', 'results', 'overlap', 'example-overlap-maritime-001.json'), null);
  const examplePruning = readJsonIfPresent(join(rootDir, 'source-ops', 'results', 'pruning', 'example-pruning-social-001.json'), null);
  const exampleLifecycleEvaluation = readJsonIfPresent(join(rootDir, 'source-ops', 'results', 'onboarding-prep', 'example-lifecycle-evaluation-maritime-001.json'), null);
  const exampleLifecycleBatch = readJsonIfPresent(join(rootDir, 'source-ops', 'results', 'onboarding-prep', 'example-lifecycle-batch.json'), null);
  return { profile, registry, needs, rubric, overlapRubric, pruningRubric, actionTaxonomy, lifecycleTransitionPolicy, exampleScorecard, exampleOverlap, examplePruning, exampleLifecycleEvaluation, exampleLifecycleBatch };
}

export function buildSourceOpsSurface({ rootDir, snapshot = null } = {}) {
  const { profile, registry, needs, rubric, overlapRubric, pruningRubric, actionTaxonomy, lifecycleTransitionPolicy, exampleScorecard, exampleOverlap, examplePruning, exampleLifecycleEvaluation, exampleLifecycleBatch } = loadSourceOpsWorkspace(rootDir);
  const sources = Array.isArray(registry?.sources) ? registry.sources : [];
  const sourceHealthEntries = Array.isArray(snapshot?.healthSummary?.entries) ? snapshot.healthSummary.entries : [];
  const healthByName = new Map(sourceHealthEntries.map(entry => [entry.name, entry]));
  const inventoryItems = sources.map(source => {
    const live = healthByName.get(source.name) || null;
    return {
      id: source.id,
      name: source.name,
      module: source.module,
      category: source.category,
      trustClass: source.trustClass,
      evidenceMode: source.evidenceMode,
      lifecycle: source.lifecycle,
      operatorRole: source.operatorRole,
      enabledByDefault: Boolean(source.enabledByDefault),
      freshnessTargetMinutes: source.freshnessTargetMinutes,
      review: source.review || null,
      shadow: source.shadow || null,
      liveState: live?.state || null,
      liveAgeMinutes: live?.ageMinutes ?? null,
      liveFailureClass: live?.failure?.class || null,
    };
  });
  const fusionRoles = summarizeSourceFusionRoles(inventoryItems);
  const inventory = {
    version: registry?.version || null,
    generatedAt: registry?.generatedAt || null,
    total: inventoryItems.length,
    active: inventoryItems.filter(item => item.lifecycle === 'active').length,
    productionActive: inventoryItems.filter(item => item.lifecycle === 'active' && item.enabledByDefault).length,
    preProduction: inventoryItems.filter(item => ['candidate', 'researched', 'graded', 'shadow', 'approved'].includes(item.lifecycle)).length,
    byLifecycle: countBy(inventoryItems, 'lifecycle'),
    byCategory: countBy(inventoryItems, 'category'),
    byTrustClass: countBy(inventoryItems, 'trustClass'),
    byOperatorRole: countBy(inventoryItems, 'operatorRole'),
    liveStateSummary: countBy(inventoryItems.filter(item => item.liveState), 'liveState'),
    items: inventoryItems,
  };
  const performance = summarizeSourcePerformance(inventoryItems, snapshot || {});
  const history = summarizeSourceHistory(inventoryItems, snapshot || {});
  const performanceHistory = summarizeSourcePerformanceHistory(snapshot || {});
  return {
    contract: profile ? {
      version: profile.version || null,
      generatedAt: profile.generatedAt || null,
      contractMode: profile?.approvalPolicy?.contractMode || null,
      preProductionAutoAdvanceMax: profile?.approvalPolicy?.preProductionAutoAdvanceMax || null,
      activePromotionRequiresHumanApproval: Boolean(profile?.approvalPolicy?.activePromotionRequiresHumanApproval),
      allowedRoles: Array.isArray(profile?.allowedRoles) ? profile.allowedRoles : [],
      workspace: profile?.workspace || null,
      overlapSchemaPath: profile?.overlapSchemaPath || null,
      overlapRubricPath: profile?.overlapRubricPath || null,
      pruningSchemaPath: profile?.pruningSchemaPath || null,
      pruningRubricPath: profile?.pruningRubricPath || null,
      actionTaxonomyPath: profile?.actionTaxonomyPath || null,
      lifecycleTransitionPolicyPath: profile?.lifecycleTransitionPolicyPath || null,
      shadowPolicy: profile?.shadowPolicy || null,
      transitionPolicy: profile?.transitionPolicy || null,
    } : null,
    inventory,
    fusionRoles,
    performance,
    performanceHistory,
    history,
    shadow: summarizeShadowCandidates(inventoryItems),
    lifecycleTransitions: summarizeLifecycleTransitionPolicy(lifecycleTransitionPolicy),
    needs: summarizeNeeds(needs),
    grading: rubric ? summarizeSourceGradingRubric(rubric) : null,
    overlap: overlapRubric ? summarizeSourceOverlapRubric(overlapRubric) : null,
    pruning: pruningRubric ? summarizeSourcePruningRubric(pruningRubric) : null,
    actionTaxonomy: actionTaxonomy ? {
      version: actionTaxonomy.version || null,
      actionCount: Array.isArray(actionTaxonomy.actions) ? actionTaxonomy.actions.length : 0,
      ids: Array.isArray(actionTaxonomy.actions) ? actionTaxonomy.actions.map(item => item.id) : [],
    } : null,
    exampleScorecard: exampleScorecard ? summarizeSourceScorecard(exampleScorecard) : null,
    exampleOverlap: exampleOverlap ? summarizeSourceOverlapAssessment(exampleOverlap) : null,
    examplePruning: examplePruning ? summarizeSourcePruningAssessment(examplePruning) : null,
    lifecycleEvaluation: lifecycleTransitionPolicy ? loadExampleLifecycleEvaluation(rootDir) : (exampleLifecycleEvaluation || null),
    lifecycleBatchEvaluation: lifecycleTransitionPolicy ? loadExampleLifecycleBatch(rootDir) : (exampleLifecycleBatch || null),
  };
}
