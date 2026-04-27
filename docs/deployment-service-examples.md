# Deployment service examples

These examples are meant to operationalize the startup and shutdown hardening added in Epic 33. They assume:

- Node.js 22+ is already installed.
- Crucix lives in a stable checkout path.
- `.env` is present in the repo root.
- The process should restart automatically after crashes or host reboot.

Crucix already exposes process-manager-friendly health semantics:

- `GET /api/health` returns `200` while serving normally.
- `GET /api/health` returns `503` while shutting down.
- `SIGTERM` and `SIGINT` trigger graceful shutdown.

## Path assumptions you should edit

Before installing either example, replace these placeholders:

- `/opt/crucix` with your real repo path
- `/usr/bin/env` if your host stores `env` elsewhere
- `crucix` user/group names for your target system

## launchd example (macOS)

Example file: `deploy/launchd/com.crucix.local.plist`

Install steps:

```bash
mkdir -p ~/Library/LaunchAgents
cp deploy/launchd/com.crucix.local.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.crucix.local.plist
launchctl enable gui/$(id -u)/com.crucix.local
launchctl kickstart -k gui/$(id -u)/com.crucix.local
```

Useful commands:

```bash
launchctl print gui/$(id -u)/com.crucix.local
launchctl kickstart -k gui/$(id -u)/com.crucix.local
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.crucix.local.plist
```

Guidance:

- `RunAtLoad` starts Crucix on login.
- `KeepAlive` restarts it if Node exits unexpectedly.
- Log files are written under the repo `logs/` directory.
- `CRUCIX_AUTO_OPEN_BROWSER=0` keeps headless launches from opening a browser window.

## systemd example (Linux)

Example file: `deploy/systemd/crucix.service`

Install steps:

```bash
sudo cp deploy/systemd/crucix.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now crucix.service
```

Useful commands:

```bash
sudo systemctl status crucix.service
sudo systemctl restart crucix.service
sudo journalctl -u crucix.service -n 200 --no-pager
sudo systemctl disable --now crucix.service
```

Guidance:

- `Restart=on-failure` avoids a restart loop on clean operator-requested shutdown.
- `RestartSec=10` gives the port a brief cool-down before re-launch.
- `Environment=CRUCIX_AUTO_OPEN_BROWSER=0` keeps server mode headless.
- `ExecStartPre` performs a lightweight config sanity check before starting the long-running server.
- `TimeoutStopSec=30` gives Crucix time to close SSE clients and flush shutdown work after `SIGTERM`.

## Restart-policy recommendation

Recommended defaults for both launchd and systemd:

- Restart automatically after crashes.
- Do not rely on browser auto-open in service mode.
- Prefer a small restart delay instead of immediate tight loops.
- Treat `SIGTERM` as the normal stop path.
- Check `/api/health` after deployment or restart.

## Post-install validation

After enabling the service, validate with:

```bash
curl -fsS http://127.0.0.1:3117/api/health
```

You should see a payload where:

- `status` is `"ok"`
- `lifecycle.phase` is `"serving"`
- `startupValidation.valid` is `true`

If the server is intentionally stopping, a temporary `503` from `/api/health` is expected and honest.
