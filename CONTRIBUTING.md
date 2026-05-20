# Contributing to Crucix


Crucix moves quickly, but review bandwidth is limited. The easiest way to get a change merged is to keep it small, well-scoped, and aligned with the project's direction.

## What Contributions Are Most Helpful

- Focused bug fixes with a clear reproduction and validation path
- Documentation improvements that reduce setup friction
- Dashboard usability improvements with a small review surface
- New OSINT sources that add clear signal, degrade gracefully, and fit the existing architecture

## Changes That Should Start With an Issue First

Open an issue before writing code if your change would:

- add a new external provider or paid API
- add a new feature family or dashboard surface
- change the project scope or roadmap
- change licensing, distribution, or deployment model
- introduce new dependencies

## Development Baseline

- Node.js 22+
- Pure ESM
- Keep the zero-extra-dependency approach unless there is a strong reason not to
- Do not commit secrets, `.env` files, or generated runtime data

## Adding a New Source

Each source should be a standalone module in `apis/sources/` and integrate cleanly with `apis/briefing.mjs`.

Minimum expectations:

- export a `briefing()` function that returns structured data
- handle upstream errors and rate limits cleanly
- degrade gracefully when API keys are missing
- avoid breaking the full sweep if the source fails
- document any required environment variables in `.env.example` and `README.md`
- explain why the source improves signal quality, not just source count

If your source also affects the dashboard:

- wire it through `dashboard/inject.mjs`
- explain the user-facing impact in the PR
- include a screenshot when the UI changes materially

## Frontend and Security Expectations

Frontend changes are reviewed carefully because the dashboard renders mixed-source data.

- do not render untrusted content directly with `innerHTML` unless it is sanitized first
- only allow safe external URL schemes such as `http:` and `https:`
- escape JSON injected into inline `<script>` tags
- prefer text rendering over HTML rendering when possible

## Pull Request Scope

One bugfix or one feature family per PR.

Good:

- fix one parser bug
- add one source and its minimal wiring
- improve one dashboard interaction

Bad:

- add a source, redesign the dashboard, and change config behavior in the same PR
- mix bug fixes with unrelated product expansion
- bundle license or provider changes into unrelated work

Large changes may be asked to split before review.

## Pull Request Checklist

Before opening a PR, make sure you have:

- explained the problem and why the change is needed
- kept the diff focused
- listed any setup or environment variable changes
- validated the changed path locally
- included screenshots for visible dashboard changes
- updated docs when behavior or config changed

## Review Priorities

Review is primarily about:

- correctness
- regression risk
- security of mixed-source content rendering
- maintainability
- fit with project direction

Not every technically correct change will be merged. Scope and long-term maintenance cost matter.

## Commit and PR Hygiene

- Use clear commit messages
- Avoid unrelated file churn
- Do not include generated metadata or tool signatures in PR descriptions unless they are actually useful
- Keep PR titles specific and concrete

## Security Reports

If you believe you found a security issue, do not open a public issue first. See `SECURITY.md` for reporting instructions.
