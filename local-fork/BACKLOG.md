# Crucix local fork backlog

This file tracks worthwhile follow-on work that is not yet scheduled into the active roadmap.

## Candidate backlog items

- Evaluate NDJSON or SQLite-backed social-lead history once operator-driven X intake grows beyond the bounded JSON store used in the first intake slice, so audit depth and query flexibility improve without overloading a single recent-state file.
- Add an explicit social-leads policy artifact and endpoint before enabling browser-assisted X retrieval, so operator-visible guardrails, request budgets, and audit trails exist before any real browser-backed X collection runs.

Recent promotions:
- Social-lead intake, verification, and LLM-hardening roadmap for integrating high-value social-media claims into Crucix was promoted into `local-fork/plan.json` as `epic-72` through `epic-77` on 2026-05-08, then refined the same day so `epic-72` became an explicit first-class X acquisition strategy covering bounded retrieval tiers, provider-guardrail policy, and formal API decision gates. Supporting docs live in `docs/social-leads-llm-pipeline-design.md` and `local-fork/artifacts/2026-05-08-social-leads-backlog.md`.
- Noise-suppression pressure alert acknowledge/snooze controls plus recent audit visibility was promoted into `local-fork/plan.json` as Epic 29, effort 29.9 on 2026-04-26.
- SQLite runtime-history diagnostics or export visibility was promoted into `local-fork/plan.json` as Epic 33, effort 33.7 on 2026-04-26.
- Deployment-packaging follow-on work such as checked example `launchd` or `systemd` service definitions plus restart-policy guidance was promoted into `local-fork/plan.json` as Epic 33, effort 33.6 on 2026-04-26.
- Schema-level validation helpers were promoted into `local-fork/plan.json` as Epic 34, effort 34.1 on 2026-04-25.
- Dev-safe restart helper or port-ownership sanity checks were promoted into `local-fork/plan.json` as Epic 29, effort 29.1 on 2026-04-25.
- Endpoint-level contract coverage for reasoning metadata on `/api/analysis` and `/api/brief/news` was promoted into `local-fork/plan.json` as Epic 26, effort 26.4 on 2026-04-25.
- Direct per-cluster source provenance or cluster-to-runtime-source attribution was promoted into `local-fork/plan.json` as Epic 26, effort 26.5 on 2026-04-25 and completed in cycle 086.
- Remaining settings safety, preset lifecycle, dashboard performance, and map-event surfacing backlog items were promoted into `local-fork/plan.json` as Epic 36, efforts 36.1 through 36.6 on 2026-04-25.
- Local runtime restart verification after `restart-safe` was promoted into `local-fork/plan.json` as Epic 37, effort 37.1 on 2026-04-27.
- Shared navigation and page-shell work was promoted into `local-fork/plan.json` as Epic 32, effort 32.5 on 2026-04-26.
- Deferred ideas-enrichment phase telemetry was promoted into `local-fork/plan.json` as Epic 31, effort 31.5 on 2026-04-26.
- Source-control audit history and undo metadata was promoted into `local-fork/plan.json` as Epic 33, effort 33.5 on 2026-04-26.
- Historical source-performance trend snapshots and delta views were promoted into `local-fork/plan.json` as Epic 30, effort 30.5 on 2026-04-26.
- Active LLM provider readiness probing was promoted into `local-fork/plan.json` as Epic 31, effort 31.6 on 2026-04-26.
- Endpoint-level regression coverage for settings-driven agent-analysis publish behavior was promoted into `local-fork/plan.json` as Epic 34, effort 34.4 on 2026-04-26.
- Provider-specific cheap readiness checks and richer failure classification for LLM probes was promoted into `local-fork/plan.json` as Epic 31, effort 31.7 on 2026-04-26.
- End-to-end regression coverage for `POST /api/review-workflow/action` and `GET /api/review-workflow/audit` was promoted into `local-fork/plan.json` as Epic 34, effort 34.5 on 2026-04-26.
- Endpoint-level regression coverage for cluster-repair workflow actions and suppressed-cluster state was promoted into `local-fork/plan.json` as Epic 34, effort 34.6 on 2026-04-26.
- Attribution-diagnostics follow-on work to distinguish routine aggregator publisher mixes from true alias-collision anomalies was promoted into `local-fork/plan.json` as Epic 32, effort 32.6 on 2026-04-26.
- Rolling noise-suppression match history and per-rule hit counters were promoted into `local-fork/plan.json` as Epic 32, effort 32.7 on 2026-04-26.
- Browser-level regression coverage for the shared operator surface shell was promoted into `local-fork/plan.json` as Epic 34, effort 34.7 on 2026-04-26.
- Source-registry metadata for expected multi-publisher runtime buckets was promoted into `local-fork/plan.json` as Epic 23, effort 23.4 on 2026-04-26.
- Source-registry runtime-bucket metadata and registry-vs-observed attribution drift surfacing were promoted into `local-fork/plan.json` as Epic 32, effort 32.8 on 2026-04-26.
- Bounded retention or time-decay for `runs/noise-suppression-history.json` was promoted into `local-fork/plan.json` as Epic 29, effort 29.5 on 2026-04-26.
- Noise-suppression history decay and prune telemetry surfacing was promoted into `local-fork/plan.json` as Epic 29, effort 29.6 on 2026-04-26.
- Rolling per-sweep noise-suppression telemetry snapshots and trend-view surfacing was promoted into `local-fork/plan.json` as Epic 29, effort 29.7 on 2026-04-26.
- Sustained-pressure alerting or queue-threshold escalation for noise-suppression telemetry was promoted into `local-fork/plan.json` as Epic 29, effort 29.8 on 2026-04-26 and completed in cycle 126.
- Runtime-bucket drift history and delta trends were promoted into `local-fork/plan.json` as Epic 32, effort 32.9 on 2026-04-26.

New items can be added here when they do not yet belong in the active roadmap.

Recent promotions:
- Candidate snapshot timestamp fallback stamping work was promoted into `local-fork/plan.json` on 2026-04-30 during cycle 187 execution as `epic-68 / effort-68.1`.
- Published-versus-candidate snapshot timestamp honesty work was promoted into `local-fork/plan.json` on 2026-04-30 during cycle 186 execution as `epic-67 / effort-67.1`.
- Startup synthesis latency visibility and handoff timing work was promoted into `local-fork/plan.json` on 2026-04-30 during cycle 185 execution as `epic-66 / effort-66.1`.
- Health-contract startup phase visibility work was promoted into `local-fork/plan.json` on 2026-04-30 during cycle 184 execution as `epic-65 / effort-65.1`.
- Startup synthesis honesty and raw-vs-published sweep timing work was promoted into `local-fork/plan.json` on 2026-04-30 during cycle 183 execution as `epic-64 / effort-64.1`.
- Post-publish retained sweep-state tracing was promoted into `local-fork/plan.json` on 2026-04-30 during cycle 182 execution as the active `epic-63 / effort-63.1` slice.
- Settings concurrency conflict UX was promoted into `local-fork/plan.json` as Epic 54, effort 54.1 on 2026-04-28.
- Extended local admin write-auth boundary work was promoted into `local-fork/plan.json` as Epic 55, effort 55.1 on 2026-04-28.
- Restart-safe helper portability hardening was promoted into `local-fork/plan.json` as Epic 56, effort 56.1 on 2026-04-28.
- Dashboard persistence honesty work was promoted into `local-fork/plan.json` as Epic 57, efforts 57.1 through 57.2 on 2026-04-28.
- Admin preset browser regression coverage was promoted into `local-fork/plan.json` as Epic 58, effort 58.1 on 2026-04-28.
- Telegram and RSS cluster corroboration hardening was promoted into `local-fork/plan.json` as Epic 59, effort 59.1 on 2026-04-28.
- Headless layout-budget measurement thresholds were promoted into `local-fork/plan.json` as Epic 60, effort 60.1 on 2026-04-28.
- Admin preset presentation controls were promoted into `local-fork/plan.json` as Epic 61, effort 61.1 on 2026-04-28.
- Preset-aware dashboard density tuning was completed in `local-fork/plan.json` as Epic 50, effort 50.1 on 2026-04-28.

Recent promotions:
- Critical-event classifier hardening, transition audit, and delivery audit work were promoted into `local-fork/plan.json` as Epic 39, efforts 39.1 through 39.3 on 2026-04-27.
- Browser-level regression coverage for dashboard layout-budget diagnostics was promoted into `local-fork/plan.json` as Epic 49, effort 49.1 on 2026-04-28.
- Preset-specific dashboard density tuning was promoted into `local-fork/plan.json` as Epic 50, effort 50.1 on 2026-04-28.
- Shared runtime-action feedback helpers beyond restart-safe were promoted into `local-fork/plan.json` as Epic 51, effort 51.1 on 2026-04-28.
- Critical-event classifier observability plus operator-facing audit and delivery surfaces were promoted into `local-fork/plan.json` as Epic 52, efforts 52.1 through 52.3 on 2026-04-28.
- SDR session operator workflow surfacing was promoted into `local-fork/plan.json` as Epic 53, effort 53.1 on 2026-04-28.
- SDR session automation and retained RF evidence work were promoted into `local-fork/plan.json` as Epic 40, effort 40.1 on 2026-04-27.
- Runtime restart audit visibility work was promoted into `local-fork/plan.json` as Epic 41, effort 41.1 on 2026-04-27.
- Runtime restart audit UI/workflow surfacing was promoted into `local-fork/plan.json` as Epic 42, effort 42.1 on 2026-04-27.
- Runtime restart audit live-refresh feedback was promoted into `local-fork/plan.json` as Epic 43, effort 43.1 on 2026-04-27.
- Shared runtime restart-audit polling helpers were promoted into `local-fork/plan.json` as Epic 44, effort 44.1 on 2026-04-27.
- Dashboard map proportional sizing was promoted into `local-fork/plan.json` as Epic 45, effort 45.1 on 2026-04-27.
- Dashboard map sizing tokens were promoted into `local-fork/plan.json` as Epic 46, effort 46.1 on 2026-04-27.
- Dashboard layout budget diagnostics were promoted into `local-fork/plan.json` as Epic 47, effort 47.1 on 2026-04-27.
- Dashboard layout efficiency tuning was promoted into `local-fork/plan.json` as Epic 48, effort 48.1 on 2026-04-27.

New items can be added here when they do not yet belong in the active roadmap.



