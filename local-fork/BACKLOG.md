# Crucix local fork backlog

This file tracks worthwhile follow-on work that is not yet scheduled into the active roadmap.

## Candidate backlog items

All current backlog items were integrated into `local-fork/plan.json` on 2026-04-24.

New items can be added here when they do not yet belong in the active roadmap.

- Add schema-level validation helpers for source-ops artifacts so example task packets, scorecards, overlap assessments, and result envelopes are checked against their JSON schemas instead of only spot-checking key fields in tests.
- Add a dev-safe Crucix restart helper or port-ownership sanity check so local validation cycles stop hitting ambiguous `3117` listener handoff failures during restart.
- Add evaluator support for batch candidate queues so source-ops can compute next allowed transitions and blockers for more than one candidate record at a time instead of only a single example path.
