# Source operations

Use these guides to diagnose provider failures and understand what remains visible when a Crucix source degrades.

- [OpenSky: air traffic, throttling, and historical fallback](opensky.md)

## Adding a source guide

Create one Markdown file per provider in this directory and link it above. Keep the guide aligned with the source module and its dashboard integration, using these sections:

1. **What it provides** — coverage and important data limitations.
2. **Authentication** — required keys, supported configuration, and behavior without credentials.
3. **Limits and instability** — known failure modes; distinguish current Crucix behavior from provider policies that may change.
4. **Failure handling** — retries, timeouts, returned errors, and fallback conditions.
5. **Dashboard and briefing** — where errors appear and whether displayed data can be stale or incomplete.
6. **Local checks** — prerequisites, commands, expected results, and negative cases; identify commands that contact the provider or write runtime data.
7. **Contributor caveats** — implementation links and behavior to preserve.

Document implemented behavior rather than proposed fixes. Avoid copying credentials or generated run data into documentation. Keep setup instructions in the [main README](../../README.md) and follow the [contribution guidelines](../../CONTRIBUTING.md).
