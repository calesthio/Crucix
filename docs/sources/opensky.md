# OpenSky operations

## What it provides

[The OpenSky source](../../apis/sources/opensky.mjs) summarizes ADS-B aircraft state vectors across ten hotspot regions. Each region reports aircraft totals, origin-country counts, aircraft without callsigns, and aircraft above 12 km. Missing callsigns do not establish that an aircraft is military; these are activity summaries, not complete airspace coverage.

## Authentication

The current hotspot integration uses public requests without credentials. It requires no API key and has no OpenSky authentication environment variables. Adding an OpenSky account does not change this implementation's requests.

## Limits and instability

Public hotspot requests can return `HTTP 429`. A briefing queries all ten regions concurrently, so repeated manual sweeps add load. Crucix does not bypass rate limits. Treat quota numbers in source comments as context, not a guaranteed allowance; this guide describes the client behavior rather than promising provider availability or a fixed daily quota.

## Failure handling

- Hotspot requests use a 20-second fetch timeout and the [shared `safeFetch` helper](../../apis/utils/fetch.mjs).
- The helper defaults to one retry after a two-second delay, including for HTTP errors such as 429. It has no OpenSky-specific backoff or `Retry-After` handling.
- After both attempts fail, the helper returns an error object. The region retains an `error` and reports zero aircraft; the source includes `hotspotErrors` and a summary `error` for partial or total failure. Successful regions are retained.
- The [full sweep](../../apis/briefing.mjs) also has a 30-second source deadline. A source-level timeout is recorded in the sweep's `errors`; it does not cancel the already-running requests. Other sources can still complete.

## Dashboard and briefing

For returned OpenSky data, inspect `sources.OpenSky.error`, `hotspotErrors`, and each hotspot's `error` in the raw briefing. A resolved error-bearing object can still have an `ok` timing status: the sweep's completion counts do not prove upstream success. Source health in the dashboard marks returned source errors. A source-level timeout instead appears in the raw sweep's `errors` and is absent from the dashboard's health list, which is built from returned sources.

[Dashboard synthesis](../../dashboard/inject.mjs) uses current hotspots whenever their combined aircraft count is positive. It does not fill failed regions individually from history. When the combined count is zero, even without an explicit error, it searches `runs/briefing_*.json` in reverse filename order for a non-empty OpenSky snapshot. It skips unreadable files and snapshots whose available timestamp is at or after the current timestamp.

The fallback affects dashboard air summaries, not the raw briefing. Synthesized `airMeta` records `fallback`, `liveTotal`, `timestamp`, `source`, and, when used, `fallbackFile`; a current OpenSky error is retained there. Cached traffic is historical, with no maximum-age cutoff, and should not be interpreted as a fresh observation. If no usable history exists, the air summary remains empty or zero. Do not assume that the dashboard visibly labels every piece of fallback metadata.

## Local checks

From the repository root, with Node.js 22+ installed:

```sh
node apis/sources/opensky.mjs
```

This contacts OpenSky for all ten hotspots and prints JSON without saving a run. No npm dependencies or credentials are needed for this standalone module. Inspect the JSON, not just the exit code: throttling is returned as data. Expect `source: "OpenSky"`, a timestamp, and hotspot summaries; on failure, expect the error fields described above. Avoid repeatedly rerunning it after a 429.

For dashboard checks, use the normal application setup in the [main README](../../README.md). A normal sweep saves runtime data in `runs/`; retain an earlier non-empty run when checking fallback. Full sweeps contact other providers too. Keep generated data out of commits.

When testing changes with local fixtures or mocked fetch responses, cover these cases without deliberately provoking a live rate limit:

| Case | Expected result |
| --- | --- |
| All hotspot requests fail with 429 | Regional errors plus a source error; zero current aircraft |
| One region fails, another returns aircraft | Partial source error; dashboard keeps current results, without historical region merging |
| Successful empty response | Zero aircraft without a regional error; dashboard may still use history |
| Zero current aircraft and earlier non-empty run | Dashboard uses historical air summaries and sets `airMeta.fallback` |
| Positive current aircraft and earlier non-empty run | Current summaries win; `airMeta.fallback` is false |
| Missing, empty, or unreadable history | No usable fallback; do not invent traffic or suppress the current error |

Mocked checks establish client behavior, not live provider availability.

## Contributor caveats

Preserve error visibility when using historical data. Keep fallback scoped to dashboard synthesis and preserve partial live results. The fetch helper is shared by many providers: changing retry policy there affects more than OpenSky. This guide adds no authentication, rate-limit evasion, or retry-policy changes.
