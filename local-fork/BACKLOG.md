# Crucix local fork backlog

This file tracks worthwhile follow-on work that is not yet scheduled into the active roadmap.

## Candidate backlog items

All current backlog items were integrated into `local-fork/plan.json` on 2026-04-24.

New items can be added here when they do not yet belong in the active roadmap.

The operator settings, layout overhaul, runtime reliability, source-ops console, LLM or agent operations, review workflow, deployment hardening, and contract-expansion recommendations from 2026-04-25 were integrated into `local-fork/plan.json` as Epics 27 through 34.

- Add schema-level validation helpers for source-ops artifacts so example task packets, scorecards, overlap assessments, and result envelopes are checked against their JSON schemas instead of only spot-checking key fields in tests. Promoted into `local-fork/plan.json` as Epic 34, effort 34.1 on 2026-04-25.
- Add a dev-safe Crucix restart helper or port-ownership sanity check so local validation cycles stop hitting ambiguous `3117` listener handoff failures during restart. Promoted into `local-fork/plan.json` as Epic 29, effort 29.1 on 2026-04-25.
- Endpoint-level contract coverage for reasoning metadata on `/api/analysis` and `/api/brief/news` was promoted into `local-fork/plan.json` as Epic 26, effort 26.4 on 2026-04-25.
- Direct per-cluster source provenance or cluster-to-runtime-source attribution was promoted into `local-fork/plan.json` as Epic 26, effort 26.5 on 2026-04-25 and completed in cycle 086.
- Add a revision or ETag-style concurrency token to the operator settings store and write API so the settings UI can detect stale listeners, conflicting saves, and restore drift instead of blindly last-write-wins. Added to backlog on 2026-04-25 after cycle 089.
- Add an explicit local admin nonce or CSRF-style confirmation token for `/api/settings/operator` and `/api/settings/import` so browser-originated local writes are not relying on network locality alone. Added to backlog on 2026-04-25 after cycle 090.
