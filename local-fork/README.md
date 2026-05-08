# Crucix Local Fork

This directory tracks runtime-specific work on the local Crucix deployment.

## Standard dev cycle

When Jason says `execute next crucix dev cycle`, the expected flow is:

1. Read `local-fork/plan.json` and the latest cycle note under `local-fork/cycles/`.
2. Pick the next planned effort that is not blocked.
   - If the roadmap is exhausted, promote the next justified backlog item into `plan.json` first.
   - When a backlog item is promoted and completed, remove it from `BACKLOG.md` so the backlog never advertises already-shipped work.
3. Implement the smallest production-meaningful slice.
4. Validate locally.
5. Update prod on this runtime and verify `/api/health` plus a representative `/api/data` check.
6. Record the cycle outcome in `local-fork/plan.json` and a new cycle note.
7. Commit the repo so the local fork is versioned.

## Layout

- `plan.json` — current roadmap, active effort, cycle counter, deployment expectations
- `cycles/` — one markdown note per dev cycle with status and evidence
- `artifacts/` — optional validation snippets or generated evidence worth keeping

This is intentionally local-fork specific, not upstream-facing project docs.
