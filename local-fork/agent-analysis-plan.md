# Agent Analysis: Outlook and Tipping Points

## Intent

Add an operator-facing dashboard section called `Agent Analysis` that produces a structured `Outlook and tipping points` assessment from the current sweep plus Crucix runtime trend memory, and a concise 5-line iMessage-friendly summary of the same assessment.

This feature should answer:

- where conditions appear to be heading
- what risks matter most right now
- what concrete developments would materially change macro, economic, or general risk
- what evidence supports that assessment
- how confident the system is, and what could invalidate the view

## Product shape

This should be a new dashboard panel, similar in operator prominence to the current LLM-driven ideas surface, but analytically distinct from trade ideas.

Suggested panel sections:

1. `Outlook`
   - 2 to 4 concise bullets describing directional assessment
   - horizons should eventually support at least short-term and medium-term framing
2. `Key risks`
   - 3 to 5 risks with severity and confidence labels
3. `Tipping points`
   - default to only high-probability active tipping points in the main dashboard and iMessage surface
   - each tipping point must be time-bound, explicit, and testable
   - each should state likely direction of change if triggered
4. `Why the agent thinks this`
   - short evidence/trend summary tying the assessment to deltas, trend memory, and current corroborated/suspect signals
5. `Caveats`
   - freshness, source-health, stale-trend, or single-source warnings

## Design constraints

- Do not present OSINT chatter as confirmed fact.
- Keep the section operator-facing and confidence-aware.
- Prefer structured JSON generation plus validation over freeform text blobs.
- Analysis should degrade safely when LLM is unavailable or trend memory is too thin.
- Current-sweep evidence and longer-horizon trend evidence must remain distinguishable.
- Tipping points should be explicit conditions, not vague warnings.
- Main operator surfaces should default to HIGH-probability tipping points only.
- MEDIUM-probability items, if kept at all, belong in review/debug surfaces, not the main operator view.
- LOW-probability items should be omitted by default.
- Tipping points must support lifecycle tracking: active, hit, cleared, expired, or superseded.

## Proposed implementation sequence

### Effort 7.1 — Trend-memory foundation for multi-day and multi-week operator analysis

Goal:
Store compact rolling trend features that are useful for later analysis, not just sweep-to-sweep delta.

Scope:
- extend runtime memory so it preserves selected multi-run trend summaries
- include compact historical features for:
  - urgent OSINT tempo
  - corroborated vs suspect signal counts
  - key market regime moves
  - energy and metals drift
  - air / thermal / nuclear anomaly persistence
  - source-health degradation persistence
  - major topic recurrence from news clusters
- expose a normalized trend summary for the latest window, for example 24h, 72h, 7d if available

Acceptance:
- runtime can reconstruct compact trend context after restart
- analysis code can consume trend context without re-reading large raw histories

### Effort 7.2 — Structured agent-analysis schema for outlook, risks, and tipping points

Goal:
Define the payload shape before generation/UI work.

Proposed schema:
- `agentAnalysis`
  - `status`: `ready|thin-history|llm-unavailable|degraded`
  - `generatedAt`
  - `freshness`
  - `horizons`
  - `outlook[]`
  - `risks[]`
  - `tippingPoints[]`
  - `evidenceSummary[]`
  - `caveats[]`
  - `confidenceLabel`
  - `trendWindowSummary`

Each tipping point should include:
- `title`
- `windowStart`
- `windowEnd` or `validFor`
- `probability` (`HIGH` on main surfaces, optional `MEDIUM` only in debug/review if enabled)
- `condition`
- `expectedImpact`
- `whyItMatters`
- `evidenceRefs[]`
- `status` (`active|hit|cleared|expired|superseded`)
- `resolutionNote`
- `invalidationOrClearSignal`

Acceptance:
- schema is generated deterministically when LLM is off
- schema validator trims or rejects malformed model output
- schema supports explicit lifecycle accountability for tipping points across sweeps

### Effort 7.3 — LLM and rule-assisted agent analysis generation with confidence and caveat controls

Goal:
Generate the analysis using both current sweep and trend memory.

Scope:
- build a compact analysis prompt distinct from trade-idea prompting
- include current evidence, multi-run trend summary, delta, six-hour baseline, and source-health state
- force structured JSON output
- add repair/retry handling similar to cluster work where appropriate
- add deterministic fallback analysis when LLM is unavailable
- add confidence downgrades when evidence is thin, stale, or noisy
- add publication gating so main surfaces only emit active HIGH-probability tipping points by default

Acceptance:
- analysis is available even when LLM fails, though more limited
- generated bullets cite concrete signals or trend features, not just vibes
- caveats reflect stale or degraded evidence automatically

### Effort 7.4 — Dashboard agent-analysis panel and operator-facing review surface

Goal:
Render the analysis cleanly in the dashboard and expose API access.

Scope:
- add a dashboard panel named `Agent Analysis`
- render outlook, key risks, tipping points, and caveats
- add a concise 5-line iMessage summary format derived from the same analysis payload
- visually separate current-picture assessment from trend-derived judgment
- add API endpoint(s), for example:
  - `GET /api/analysis`
  - optional debug/review endpoint for evidence anchors or generation metadata
- include fallback states for thin history, pending generation, and LLM unavailable

Acceptance:
- panel is readable with and without LLM
- operator can inspect why the panel says what it says

### Effort 7.5 — Validation harness for outlook drift, stale-trend handling, and materially changed tipping points

Goal:
Keep the feature honest.

Scope:
- add fixtures or validation helpers for:
  - thin-history startup
  - stale current snapshot but rich trend memory
  - degraded source-health windows
  - materially changed risk regime
  - tipping point hit/cleared/expired/superseded cases
  - main-surface filtering so only active HIGH-probability tipping points are shown
- verify analysis does not overstate confidence when evidence weakens
- verify old tipping points do not silently persist after invalidation

Acceptance:
- representative validation proves safe degradation and obvious scenario handling

## Recommended order relative to current work

Current roadmap focus remains Epic 6. The clean sequencing is:

1. Finish Epic 6 effort 6.2 and 6.3, because they strengthen persistent review/trend diagnostics.
2. Start Epic 7 with effort 7.1, since the requested feature depends on better multi-run memory.
3. Follow with 7.2 and 7.3 before UI work, so the panel is driven by a stable schema instead of ad hoc strings.
4. Finish with 7.4 and 7.5.

## Open assumptions captured for now

- This is an additional panel, not a replacement for trade ideas.
- `Agent Analysis` is the panel title, and `Outlook and tipping points` is a named section within it.
- The same analysis payload should support both a full dashboard view and a concise iMessage-native 5-line rendering.
- The feature is operator-facing and should not default to push alerts by itself.
- Longer-horizon trend memory should be compact and derived, not full raw-history replay.
- The system must always show confidence/caveat language, especially around geopolitics and single-source OSINT.
