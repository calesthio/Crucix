# Crucix local fork backlog

This file tracks worthwhile follow-on work that is not yet scheduled into the active roadmap.

## Candidate backlog items

- Add operator-facing evidence provenance labels to iMessage briefings so chat reports distinguish fresh, cached, degraded, and carried-forward signals without requiring dashboard inspection.
- Add per-source freshness thresholds and policy tuning to config instead of hardcoding them in source-health helpers.
- Add source-level counters for parse-fallback rate, LLM fallback rate, and empty-result rate so weak sources can be identified over time.
- Add a runtime maintenance pass that prunes stale OpenSky cache/state artifacts and records cache-hit rate.
- Add explicit map precision classes for geocoded news items so inferred coordinates are visually distinct from source-native coordinates.
- Split operator-facing source failures into categories like credential-missing, quota-limited, transport-failed, and degraded-live so briefings can distinguish setup debt from active outages.
- Add a follow-up iMessage interaction layer for `why`, `sources`, and `expand` actions so compact chat briefs can drill into one signal without dumping the whole report.
- Add stable signal IDs in compact/drill-down responses so chat clients can reference exact items without relying on list order like “top suspect” or “item 2”.
- Add short-lived conversational selection memory so chat references like `that one` can bind to the user’s last resolved signal across turns instead of only within one request.
- Add optional persisted conversation state for selected signals if the iMessage layer needs continuity across runtime restarts, not just in-memory follow-up handling.
- Add selection-memory size limits and opportunistic pruning so context-state helpers do not accumulate unbounded stale entries under high chat volume.
- Add per-context last-access timestamps and optional LRU-style eviction if chat traffic shows repeated churn beyond a simple max-entry cap.
- Add lightweight counters for selection-memory evictions and prune causes so operator health views can distinguish TTL expiry from capacity pressure.
- Add resettable/debug-only selection-memory telemetry controls so long-lived operator sessions can zero counters after investigations without restarting the runtime.
- Add optional guardrails for debug endpoints, such as local-only enablement or a config flag, if the runtime is ever exposed beyond loopback.
- Add cluster-quality review metrics, such as cluster merge/split anomalies and low-confidence cluster counts, so Epic 3 tuning can be measured instead of eyeballed.
- Add operator review helpers for suspicious near-duplicate single-source clusters so analysts can inspect likely split-story failures without scanning raw news lists.
- Add per-region LLM cluster retry/backoff counters so operators can separate transient model failures from chronically weak candidate sets.
- Capture sampled raw cluster-repair failures with truncation and hashes so prompt regressions can be compared across runs without keeping full model output.
- Persist rolling per-region cluster prompt stats across restarts if operators need to distinguish one bad sweep from chronic regional failure patterns.
- Add a bounded operator ack/dismiss layer for known noisy cluster-failure regions so review surfaces can stay actionable during prolonged model regressions.
