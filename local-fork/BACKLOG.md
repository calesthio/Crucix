# Crucix local fork backlog

This file tracks worthwhile follow-on work that is not yet scheduled into the active roadmap.

## Candidate backlog items

- Add timeout, cancellation, and completion telemetry for deferred agent-analysis LLM jobs so deterministic fallback does not mask silently hung background refinement attempts.
- Deduplicate published agent-analysis outlook entries by horizon so operator surfaces do not show multiple short-horizon summaries from mixed deterministic/cluster synthesis.
- Add a compact CLI or API summary surface for the agent-analysis validation harness so CI/operator checks can consume scenario pass/fail state without reading raw `node --test` output.
