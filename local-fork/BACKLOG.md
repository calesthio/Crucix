# Crucix local fork backlog

This file tracks worthwhile follow-on work that is not yet scheduled into the active roadmap.

## Candidate backlog items

All current backlog items were integrated into `local-fork/plan.json` on 2026-04-25.

Recent promotions:
- Schema-level validation helpers were promoted into `local-fork/plan.json` as Epic 34, effort 34.1 on 2026-04-25.
- Dev-safe restart helper or port-ownership sanity checks were promoted into `local-fork/plan.json` as Epic 29, effort 29.1 on 2026-04-25.
- Endpoint-level contract coverage for reasoning metadata on `/api/analysis` and `/api/brief/news` was promoted into `local-fork/plan.json` as Epic 26, effort 26.4 on 2026-04-25.
- Direct per-cluster source provenance or cluster-to-runtime-source attribution was promoted into `local-fork/plan.json` as Epic 26, effort 26.5 on 2026-04-25 and completed in cycle 086.
- Remaining settings safety, preset lifecycle, dashboard performance, and map-event surfacing backlog items were promoted into `local-fork/plan.json` as Epic 36, efforts 36.1 through 36.6 on 2026-04-25.

New items can be added here when they do not yet belong in the active roadmap.

- Add a shared navigation and page-shell component for dashboard-adjacent operator, diagnostics, and admin surfaces so labels, links, and boundary explanations do not drift as more control-plane pages are added. Added to backlog on 2026-04-25 after cycle 094.
- Extend runtime phase telemetry and recovery classification to deferred ideas enrichment so watchdog and `/api/health` can distinguish post-publish idea-generation hangs from analysis refinement hangs. Added to backlog on 2026-04-25 after cycle 095.
- Add source-control audit history and undo metadata for suppress and quarantine actions so local-admin mutations are attributable, reviewable, and safely reversible during incident triage. Added to backlog on 2026-04-26 after cycle 101.
- Add historical source-performance trend snapshots and delta views so the operator workflow can compare attribution, cluster quality, and trust-outcome shifts across sweeps instead of only reading the current snapshot. Added to backlog on 2026-04-26 after cycle 102.
