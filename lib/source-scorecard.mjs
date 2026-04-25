import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadSourceGradingRubric(rootDir) {
  return JSON.parse(readFileSync(join(rootDir, 'source-ops', 'grading-rubric.json'), 'utf8'));
}

export function loadSourceScorecardSchema(rootDir) {
  return JSON.parse(readFileSync(join(rootDir, 'source-ops', 'schemas', 'scorecard.schema.json'), 'utf8'));
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
