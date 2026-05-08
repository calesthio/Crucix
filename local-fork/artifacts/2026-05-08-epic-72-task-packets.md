# Epic 72 Task Packets - X Acquisition Strategy, Intake, and Normalization

## Purpose
Turn Epic 72 into executable dev-cycle slices that fit the Crucix local-fork workflow.

## Packet 72.1 - First-class X lead intake contract
Roadmap effort: `epic-72 / effort-72.1`

### Goal
Add the first production-meaningful X social lead contract with immutable raw-evidence capture.

### Scope
- Add a file-backed social-leads store.
- Add a canonical `social-lead-v1` envelope for X leads.
- Support intake fields for:
  - `postUrl`
  - `rawText`
  - `authorHandle`
  - `authorDisplayName`
  - `quotedThreadText`
  - `operatorContext`
  - `attachments` metadata only
- Add write path that preserves raw evidence and capture metadata.
- Add read endpoints for recent leads and lead detail.
- Add write endpoint for intake behind the existing local admin write boundary.
- Expose a small read-only social-leads summary in operator data surfaces.

### Explicit non-goals
- automated public retrieval
- browser-assisted retrieval
- claim extraction
- verification fanout
- media processing beyond metadata capture

### Acceptance
- Crucix can store a manually submitted X lead as `social-lead-v1`.
- Raw evidence is preserved separately from normalized fields.
- Every stored lead has `captureMethod`, `acquisitionTier`, and timestamps.
- Intake failures fail closed with explicit errors.
- The write path requires the local admin write token.

### Suggested validation
- node test for lead-store normalization and persistence
- endpoint contract test for intake plus read-back
- local runtime check via `curl` against the new endpoint

## Packet 72.2 - X acquisition ladder and graceful degradation
Roadmap effort: `epic-72 / effort-72.2`

### Goal
Implement bounded X retrieval tiers without making Crucix an unattended scraper.

### Scope
- Add acquisition-tier routing:
  - `manual-url`
  - `manual-text`
  - `public-fetch`
  - `browser-assisted`
- Record acquisition detail flags on every lead.
- Add graceful degradation when retrieval fails.
- Add retrieval-budget and backoff scaffolding.

### Acceptance
- Leads record which X acquisition tier was used.
- Failed retrieval falls back to explicit manual-gap capture.
- No tier failure breaks the sweep or other endpoints.

## Packet 72.3 - X provider-guardrail policy
Roadmap effort: `epic-72 / effort-72.3`

### Goal
Codify what Crucix may and may not do when collecting from X.

### Scope
- Add a policy document or contract surface for allowed and disallowed collection behavior.
- Add enforceable request-budget and dedupe settings.
- Add audit visibility for policy-driven suppression or fallback behavior.

### Acceptance
- Broad crawling and unattended browser scraping are explicitly blocked in policy.
- Allowed behavior is limited to URL, handle-watch, query-watch, and bounded thread-context retrieval.
- Policy can be reviewed and tuned later.

## Packet 72.4 - Canonical lead normalization
Roadmap effort: `epic-72 / effort-72.4`

### Goal
Normalize X and other social inputs into one envelope without losing source-specific detail.

### Scope
- Add thread-context storage.
- Normalize citations, mentions, hashtags, and attachments.
- Preserve source-specific acquisition metadata while keeping a common lead contract.

### Acceptance
- All supported social inputs serialize into one stable schema.
- Raw and normalized forms remain distinct.

## Packet 72.5 - X account and API decision gates
Roadmap effort: `epic-72 / effort-72.5`

### Goal
Make it explicit when browser/manual retrieval stops being good enough.

### Scope
- Define thresholds for:
  - retrieval reliability
  - operator effort
  - evidence completeness
  - thread-context loss
  - rate-limit friction
  - provider-policy risk
- Document the point at which formal X accounts or paid API access become the cleaner option.

### Acceptance
- Decision gates are documented in a reviewable operator-facing artifact.
- Later API adoption can happen without reworking the lead schema.

## Recommended execution order
1. Packet 72.1
2. Packet 72.2
3. Packet 72.3
4. Packet 72.4
5. Packet 72.5

## Notes for the next dev cycle
The next standard dev cycle should execute Packet 72.1. It is the smallest production-meaningful slice and creates the contract future X retrieval and LLM analysis will depend on.
