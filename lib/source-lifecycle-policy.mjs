import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hasReadinessGuard(policy, targetState, readiness) {
  const allowed = policy?.promotionReadinessGuards?.[targetState];
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  return allowed.includes(readiness);
}

export function evaluateLifecycleTransition({ candidate, scorecard = null, overlap = null, policy = null }) {
  const currentState = candidate?.lifecycle || policy?.defaultEntryState || 'candidate';
  const statePolicy = policy?.states?.[currentState] || { allowedNextStates: [], requirements: [], agentMayAdvance: false };
  const readiness = overlap?.promotionReadiness || scorecard?.promotionReadiness || candidate?.shadow?.promotionReadiness || null;
  const requirements = Array.isArray(statePolicy.requirements) ? statePolicy.requirements : [];

  const requirementChecks = {
    'candidate-recorded': Boolean(candidate?.id),
    'basic-validation-complete': currentState !== 'candidate' || Boolean(candidate?.category),
    'validation-complete': ['researched', 'graded', 'shadow', 'approved', 'active', 'degraded', 'deprecated', 'rejected'].includes(currentState),
    'evidence-captured': Boolean(scorecard || overlap),
    'grading-scorecard-complete': Boolean(scorecard?.weightedTotal != null),
    'promotion-readiness-recorded': Boolean(readiness),
    'overlap-assessment-complete': Boolean(overlap?.weightedTotal != null),
    'production-influence-blocked': Boolean(candidate?.shadow?.productionInfluenceBlocked),
    'shadow-observation-recorded': Boolean(candidate?.shadow),
    'human-approval-recorded': candidate?.review?.status === 'approved-for-promotion' || candidate?.review?.status === 'human-reviewed',
    'production-onboarding-complete': candidate?.lifecycle === 'active',
    'operator-review-recorded': Boolean(candidate?.review?.lastReviewedAt),
    'deprecation-rationale-recorded': currentState !== 'deprecated' || Boolean(candidate?.review?.notes),
    'rejection-rationale-recorded': currentState !== 'rejected' || Boolean(candidate?.review?.notes),
  };

  const unmetRequirements = requirements.filter(req => !requirementChecks[req]);
  const allowedNextStates = Array.isArray(statePolicy.allowedNextStates) ? statePolicy.allowedNextStates : [];
  const allowedByReadiness = allowedNextStates.filter(state => hasReadinessGuard(policy, state, readiness));
  const nextAllowedState = unmetRequirements.length === 0 ? (allowedByReadiness[0] || null) : null;
  const blockedReasons = [];

  if (unmetRequirements.length) blockedReasons.push(`unmet requirements: ${unmetRequirements.join(', ')}`);
  if (!allowedByReadiness.length && allowedNextStates.length) blockedReasons.push(`no allowed next state satisfied readiness guard for ${readiness || 'unknown-readiness'}`);
  if (nextAllowedState === 'approved' || nextAllowedState === 'active' || nextAllowedState === 'degraded') {
    blockedReasons.push('next state crosses human approval boundary');
  }
  if (nextAllowedState && policy?.states?.[currentState] && policy.states[currentState].agentMayAdvance === false) {
    blockedReasons.push('current state is not agent-advanceable');
  }

  const blocked = !nextAllowedState || blockedReasons.length > 0;
  const recommendedAction = blocked
    ? 'human-review'
    : nextAllowedState === 'approved'
      ? 'approve'
      : nextAllowedState === 'deprecated'
        ? 'deprecate'
        : nextAllowedState === 'rejected'
          ? 'reject'
          : nextAllowedState === 'shadow'
            ? 'shadow'
            : nextAllowedState === 'graded'
              ? 'grade'
              : nextAllowedState === 'researched'
                ? 'research'
                : 'block';

  return {
    currentState,
    promotionReadiness: readiness,
    allowedNextStates,
    agentMayAdvanceCurrentState: Boolean(statePolicy.agentMayAdvance),
    unmetRequirements,
    nextAllowedState,
    recommendedAction,
    blocked,
    blockedReasons,
  };
}

export function evaluateLifecycleBatch({ candidates = [], scorecards = [], overlaps = [], policy = null, queue = null }) {
  const scorecardsByCandidateId = new Map((Array.isArray(scorecards) ? scorecards : []).map(item => [item?.candidateId, item]));
  const overlapsByCandidateId = new Map((Array.isArray(overlaps) ? overlaps : []).map(item => [item?.candidateId, item]));
  const queueTasks = Array.isArray(queue?.tasks) ? queue.tasks : [];
  const queueCandidateIds = new Set(queueTasks.map(task => task?.candidateId || task?.targetId).filter(Boolean));
  const batchCandidates = (Array.isArray(candidates) ? candidates : []).filter(item => item && item.id && (item.lifecycle !== 'active' || queueCandidateIds.has(item.id)));
  const evaluations = batchCandidates.map(candidate => ({
    candidateId: candidate.id,
    name: candidate.name || null,
    lifecycle: candidate.lifecycle || null,
    queueReferenced: queueCandidateIds.has(candidate.id),
    evaluation: evaluateLifecycleTransition({
      candidate,
      scorecard: scorecardsByCandidateId.get(candidate.id) || null,
      overlap: overlapsByCandidateId.get(candidate.id) || null,
      policy,
    }),
  }));
  return {
    version: 'source-lifecycle-batch-v1',
    candidateCount: evaluations.length,
    queueTaskCount: queueTasks.length,
    blockedCount: evaluations.filter(item => item.evaluation?.blocked).length,
    advanceableCount: evaluations.filter(item => item.evaluation && !item.evaluation.blocked).length,
    evaluations,
  };
}

export function loadExampleLifecycleEvaluation(rootDir) {
  const policy = readJson(join(rootDir, 'source-ops', 'lifecycle-transition-policy.json'));
  const registry = readJson(join(rootDir, 'source-ops', 'source-registry.seed.json'));
  const scorecard = readJson(join(rootDir, 'source-ops', 'results', 'grading', 'example-grading-scorecard.json'));
  const overlap = readJson(join(rootDir, 'source-ops', 'results', 'overlap', 'example-overlap-maritime-001.json'));
  const candidate = (registry.sources || []).find(item => item.id === scorecard.candidateId) || null;
  return evaluateLifecycleTransition({ candidate, scorecard, overlap, policy });
}

export function loadExampleLifecycleBatch(rootDir) {
  const policy = readJson(join(rootDir, 'source-ops', 'lifecycle-transition-policy.json'));
  const registry = readJson(join(rootDir, 'source-ops', 'source-registry.seed.json'));
  const scorecards = [readJson(join(rootDir, 'source-ops', 'results', 'grading', 'example-grading-scorecard.json'))];
  const overlaps = [readJson(join(rootDir, 'source-ops', 'results', 'overlap', 'example-overlap-maritime-001.json'))];
  const pendingQueue = readJson(join(rootDir, 'source-ops', 'queue', 'pending.json'));
  return evaluateLifecycleBatch({
    candidates: registry.sources || [],
    scorecards,
    overlaps,
    policy,
    queue: pendingQueue,
  });
}
