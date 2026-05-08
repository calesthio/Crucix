# Social Leads to Verified OSINT - Epic Backlog

## Objective
Add a disciplined social-lead ingestion and verification workflow to Crucix so high-value social posts can improve situational awareness without allowing rumor volume, prompt injection, or dramatic framing to contaminate top-line analysis.

## Scope principles
- Treat social content as lead intelligence, not truth intelligence.
- Preserve the zero-extra-dependency posture unless a dependency is clearly justified.
- Keep every surfaced claim explainable, reviewable, and reversible.
- Default to bounded automation with operator review for risky actions or uncertain claims.

## Epic 72 - X acquisition strategy, intake, and normalization
Status: pending

### Story 72.1 - Direct X lead intake contract
- Add a bounded `socialLead` envelope for X URL drop-ins, pasted post text, quoted threads, screenshots with operator-supplied context, and referenced posts.
- Treat X as a first-class lead type, not just one platform among many.
- Acceptance:
  - An X lead can be stored without immediate verification.
  - Provenance includes source platform, author handle if known, capture method, capture time, post URL if present, and cited links.

### Story 72.2 - X acquisition ladder and graceful degradation
- Implement a clear retrieval ladder for X content:
  1. direct operator-pasted text or URL
  2. bounded public retrieval where the post is accessible without login
  3. bounded logged-in browser retrieval through the local Chrome profile when user-directed and necessary
  4. formal API or account-backed integration if later justified
- Acceptance:
  - Every X lead records which acquisition tier was used.
  - Retrieval failures preserve a manual lead record with explicit gaps.
  - Adapter or browser failures do not break the sweep.

### Story 72.3 - X provider-guardrail policy
- Add an explicit provider-respect policy for X collection.
- Acceptance:
  - The first implementation forbids broad crawling, follower-graph walking, infinite-scroll harvesting, and unattended browser scraping.
  - Allowed behavior is bounded retrieval of specific URLs, watchlist handles, or operator-requested queries.
  - Rate limiting, dedupe, and backoff behavior are documented and enforced.

### Story 72.4 - Canonical lead normalization
- Normalize X and other social payloads into one stable internal shape.
- Acceptance:
  - All lead types emit the same required fields and lifecycle state.
  - Raw text, normalized text, cited URLs, thread context, media references, and acquisition metadata are stored separately.

### Story 72.5 - X account and API decision gates
- Define when Crucix should stay with browser or manual retrieval versus when to adopt formal X accounts or paid API access.
- Acceptance:
  - Decision triggers include retrieval reliability, operator effort, evidence completeness, rate constraints, and policy risk.
  - The roadmap makes it explicit that formal X access is allowed later if it is the cleanest path to durable signal quality.

## Epic 73 - Claim extraction, rhetoric stripping, and provenance scoring
Status: pending

### Story 73.1 - Atomic claim decomposition
- Split a dramatic post into discrete factual claims.
- Acceptance:
  - The system separates each checkable claim from commentary or rhetorical framing.
  - Each claim has a type, actor, target, place, time window, and evidence anchor back to source text.

### Story 73.2 - Citation resolution and derivation tracking
- Resolve cited sources like NBC, Reuters, official statements, or repost chains.
- Acceptance:
  - Claims record whether they are firsthand, cited, derivative, or unattributed.
  - Provenance chain remains inspectable.

### Story 73.3 - Initial source reputation scoring
- Add bounded heuristics for source history, originality, repost distance, and prior corrections.
- Acceptance:
  - Reputation affects triage priority and caveats, not truth by itself.
  - Score inputs are explainable and operator-adjustable.

## Epic 74 - Verification fanout and evidence fusion
Status: pending

### Story 74.1 - Cross-source corroboration engine
- Fan out each atomic claim against existing Crucix sources and derived signals.
- Acceptance:
  - Outcomes include corroborated, partially supported, contradicted, unverified, and stale-evidence-limited.
  - Corroboration stores concrete evidence references, not just a score.

### Story 74.2 - Geo and chrono normalization
- Normalize named places and event times into bounded geo/time entities.
- Acceptance:
  - Claims can be checked against region-aware sources and relevant time windows.
  - Ambiguous locations are preserved as ambiguous instead of guessed.

### Story 74.3 - Evidence fusion confidence model
- Produce a claim-level confidence result and a narrative-level confidence result.
- Acceptance:
  - A many-bullet social post cannot inflate confidence without independent supporting evidence.
  - Contradictory evidence lowers confidence explicitly.

## Epic 75 - LLM-assisted analysis with prompt-injection hardening
Status: pending

### Story 75.1 - Bounded LLM roles and structured outputs
- Use the LLM only for narrow tasks such as claim extraction, rhetoric stripping, contradiction summarization, and evidence synopsis.
- Acceptance:
  - All LLM calls use strict JSON contracts with validation and repair or fallback.
  - No LLM output is trusted without schema validation and deterministic post-checks.

### Story 75.2 - Prompt-injection containment layer
- Add a content firewall between untrusted social text and the system prompt.
- Acceptance:
  - Untrusted content is passed as inert data, never instructions.
  - Injection or tool-use attempts in source text are labeled and logged.
  - Operator-tunable policy controls can harden or relax the filter.

### Story 75.3 - Reviewable LLM policy and configuration controls
- Add config surfaces for model enablement, task-specific thresholds, allowed fields, and escalation rules.
- Acceptance:
  - Operators can tune thresholds without code edits.
  - Policy changes are audited.

## Epic 76 - Operator workflow, UI surfacing, and brief integration
Status: pending

### Story 76.1 - Social review queue
- Add a queue for leads requiring operator review.
- Acceptance:
  - Queue items show claim summary, verification state, source reputation, and recommended next action.
  - Operators can suppress, watch, escalate, or mark corroborated.

### Story 76.2 - Brief and alert integration
- Add a bounded social-leads section to Crucix brief surfaces.
- Acceptance:
  - Social-only claims do not enter top-line briefs without caveat.
  - Corroborated or materially decision-relevant leads can surface in operator briefs with evidence refs.

### Story 76.3 - Audit and feedback loop
- Persist analyst overrides, suppression actions, and post-hoc truth outcomes.
- Acceptance:
  - Future scoring can use review history without silently mutating raw evidence.
  - All overrides are reversible and visible in audit history.

## Epic 77 - Validation harness and rollout safety
Status: pending

### Story 77.1 - Schema and contract coverage
- Add test fixtures for dramatic, ambiguous, false, and partially true social posts.
- Acceptance:
  - Each stage contract is covered by node tests.
  - Bad outputs fail closed.

### Story 77.2 - Security and abuse regression suite
- Add prompt-injection, jailbreak, oversized content, Unicode spoofing, and malformed citation fixtures.
- Acceptance:
  - Dangerous content is quarantined or safely reduced to inert text.
  - No fixture can cause tool-use or policy override behavior in the LLM pipeline.

### Story 77.3 - Phased rollout and operator readiness
- Gate rollout behind config flags and shadow-mode reporting first.
- Acceptance:
  - Initial deployment can run with observe-only mode.
  - Operators can compare pipeline recommendations against current Crucix output before promotion.

## Recommended dev-cycle order
1. Epic 72.1
2. Epic 72.2
3. Epic 72.3
4. Epic 72.4
5. Epic 73.1
6. Epic 74.1
7. Epic 75.1
8. Epic 75.2
9. Epic 76.1
10. Epic 76.2
11. Epic 77.1

## First production-meaningful slice
Implement X URL and pasted-text intake, an acquisition-tier record, canonical lead storage, atomic claim extraction, deterministic verification fanout against current Crucix evidence, and a read-only operator review surface. That is the smallest useful slice that improves situational awareness without turning Crucix into a rumor amplifier or an unattended X scraper.
