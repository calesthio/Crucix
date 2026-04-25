# Crucix local fork backlog

This file tracks worthwhile follow-on work that is not yet scheduled into the active roadmap.

## Candidate backlog items

- Centralize a normalized operator-facing LLM state enum and explanation block in API payloads, so dashboard and briefing surfaces consume one status contract instead of re-deriving `applied`, `fallback`, `pending`, and `unavailable` labels independently.
- Separate per-surface LLM supportability from participation, so a configured runtime can distinguish `static by design`, `not invoked this cycle`, and `truly unavailable` instead of overloading all three into the same operator-facing bucket.
- Add a booted-server validation matrix for dashboard and API operator-state combinations, so live render/API regressions are caught under controlled runtime scenarios instead of only against the currently running local process.
