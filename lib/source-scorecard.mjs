import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadSourceGradingRubric(rootDir) {
  return JSON.parse(readFileSync(join(rootDir, 'source-ops', 'grading-rubric.json'), 'utf8'));
}

export function loadSourceScorecardSchema(rootDir) {
  return JSON.parse(readFileSync(join(rootDir, 'source-ops', 'schemas', 'scorecard.schema.json'), 'utf8'));
}

export function loadSourceOverlapSchema(rootDir) {
  return JSON.parse(readFileSync(join(rootDir, 'source-ops', 'schemas', 'overlap-assessment.schema.json'), 'utf8'));
}

export function loadSourceOverlapRubric(rootDir) {
  return JSON.parse(readFileSync(join(rootDir, 'source-ops', 'overlap-rubric.json'), 'utf8'));
}

export function loadSourcePruningSchema(rootDir) {
  return JSON.parse(readFileSync(join(rootDir, 'source-ops', 'schemas', 'pruning-assessment.schema.json'), 'utf8'));
}

export function loadSourcePruningRubric(rootDir) {
  return JSON.parse(readFileSync(join(rootDir, 'source-ops', 'pruning-rubric.json'), 'utf8'));
}

export function summarizeSourceGradingRubric(rubric) {
  const dimensions = Array.isArray(rubric?.dimensions) ? rubric.dimensions : [];
  return {
    version: rubric?.version || null,
    generatedAt: rubric?.generatedAt || null,
    scoreScale: rubric?.scoreScale || null,
    dimensionCount: dimensions.length,
    dimensions: dimensions.map(dimension => ({
      id: dimension.id,
      label: dimension.label,
      weight: dimension.weight,
      prompt: dimension.prompt,
    })),
    totalWeight: Number(dimensions.reduce((sum, dimension) => sum + Number(dimension.weight || 0), 0).toFixed(4)),
    recommendationThresholds: rubric?.recommendationThresholds || null,
    promotionReadiness: rubric?.promotionReadiness || null,
    operatorExpectations: rubric?.operatorExpectations || null,
  };
}

export function summarizeSourceScorecard(scorecard) {
  const dimensionScores = Array.isArray(scorecard?.dimensionScores) ? scorecard.dimensionScores : [];
  return {
    version: scorecard?.version || null,
    candidateId: scorecard?.candidateId || null,
    generatedAt: scorecard?.generatedAt || null,
    weightedTotal: scorecard?.weightedTotal ?? null,
    recommendation: scorecard?.recommendation || null,
    promotionReadiness: scorecard?.promotionReadiness || null,
    confidence: scorecard?.confidence || null,
    blockingIssueCount: Array.isArray(scorecard?.blockingIssues) ? scorecard.blockingIssues.length : 0,
    dimensionCount: dimensionScores.length,
    dimensions: dimensionScores.map(item => ({
      dimension: item.dimension,
      score: item.score,
      weightedScore: item.weightedScore,
    })),
  };
}

export function summarizeSourceOverlapRubric(rubric) {
  const dimensions = Array.isArray(rubric?.dimensions) ? rubric.dimensions : [];
  return {
    version: rubric?.version || null,
    generatedAt: rubric?.generatedAt || null,
    dimensionCount: dimensions.length,
    dimensions: dimensions.map(dimension => ({
      id: dimension.id,
      label: dimension.label,
      question: dimension.question,
      weight: dimension.weight,
    })),
    totalWeight: Number(dimensions.reduce((sum, dimension) => sum + Number(dimension.weight || 0), 0).toFixed(4)),
    interpretation: rubric?.interpretation || null,
    operatorExpectations: rubric?.operatorExpectations || null,
  };
}

export function summarizeSourceOverlapAssessment(assessment) {
  const dimensionScores = Array.isArray(assessment?.dimensionScores) ? assessment.dimensionScores : [];
  const comparedAgainst = Array.isArray(assessment?.comparedAgainst) ? assessment.comparedAgainst : [];
  return {
    version: assessment?.version || null,
    candidateId: assessment?.candidateId || null,
    generatedAt: assessment?.generatedAt || null,
    weightedTotal: assessment?.weightedTotal ?? null,
    recommendation: assessment?.recommendation || null,
    promotionReadiness: assessment?.promotionReadiness || null,
    confidence: assessment?.confidence || null,
    comparedSourceCount: comparedAgainst.length,
    comparedAgainst: comparedAgainst.map(item => ({
      name: item.name,
      category: item.category || null,
      operatorRole: item.operatorRole || null,
    })),
    overlap: assessment?.overlap || null,
    blockingIssueCount: Array.isArray(assessment?.blockingIssues) ? assessment.blockingIssues.length : 0,
    dimensionCount: dimensionScores.length,
    dimensions: dimensionScores.map(item => ({
      dimension: item.dimension,
      score: item.score,
      weightedScore: item.weightedScore,
    })),
  };
}

export function summarizeSourcePruningRubric(rubric) {
  const dimensions = Array.isArray(rubric?.dimensions) ? rubric.dimensions : [];
  return {
    version: rubric?.version || null,
    generatedAt: rubric?.generatedAt || null,
    dimensionCount: dimensions.length,
    dimensions: dimensions.map(dimension => ({
      id: dimension.id,
      label: dimension.label,
      question: dimension.question,
      weight: dimension.weight,
    })),
    totalWeight: Number(dimensions.reduce((sum, dimension) => sum + Number(dimension.weight || 0), 0).toFixed(4)),
    recommendationThresholds: rubric?.recommendationThresholds || null,
    operatorExpectations: rubric?.operatorExpectations || null,
  };
}

export function summarizeSourcePruningAssessment(assessment) {
  const dimensionScores = Array.isArray(assessment?.dimensionScores) ? assessment.dimensionScores : [];
  const comparedAgainst = Array.isArray(assessment?.cohort?.comparedAgainst) ? assessment.cohort.comparedAgainst : [];
  return {
    version: assessment?.version || null,
    targetId: assessment?.targetId || null,
    generatedAt: assessment?.generatedAt || null,
    weightedTotal: assessment?.weightedTotal ?? null,
    recommendation: assessment?.recommendation || null,
    recommendedAction: assessment?.recommendedAction || null,
    confidence: assessment?.confidence || null,
    category: assessment?.cohort?.category || null,
    comparedSourceCount: comparedAgainst.length,
    comparedAgainst: comparedAgainst.map(item => ({
      name: item.name,
      operatorRole: item.operatorRole || null,
      trustClass: item.trustClass || null,
    })),
    productionGuardrails: assessment?.productionGuardrails || null,
    blockingIssueCount: Array.isArray(assessment?.blockingIssues) ? assessment.blockingIssues.length : 0,
    dimensionCount: dimensionScores.length,
    dimensions: dimensionScores.map(item => ({
      dimension: item.dimension,
      score: item.score,
      weightedScore: item.weightedScore,
    })),
  };
}
