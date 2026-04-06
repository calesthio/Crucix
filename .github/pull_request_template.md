## Summary

Describe what changed.

## Why

Explain the problem being solved.

## Scope

- [ ] Focused bug fix
- [ ] Small UX improvement
- [ ] New source
- [ ] Dashboard change
- [ ] Docs/config change

## Validation

List the commands, checks, or manual validation you performed.

## Screenshots

If the dashboard or any visible output changed, add screenshots.

## Config and Docs

- [ ] No new environment variables
- [ ] `.env.example` updated if needed
- [ ] `README.md` updated if behavior changed

## Source Additions

If this PR adds a new source, explain:

- why the source improves signal quality
- whether it requires an API key
- how it degrades when the key is missing
- what changed in `apis/briefing.mjs` and `dashboard/inject.mjs`

## Checklist

- [ ] This PR stays within one bugfix or one feature family
- [ ] I kept unrelated changes out of the diff
- [ ] I considered security for any mixed-source content rendering
- [ ] I tested the changed path locally
