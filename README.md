<div align="center">

# Crucix

**Your own intelligence terminal. 27 sources. One command. Zero cloud.**

## [Visit The Live Site: crucix.live](https://www.crucix.live/)

[![Live Website](https://img.shields.io/badge/live-crucix.live-00d4ff?style=for-the-badge)](https://www.crucix.live/)
[![Open Demo](https://img.shields.io/badge/open-live%20dashboard-0b1220?style=for-the-badge&logo=googlechrome&logoColor=white)](https://www.crucix.live/)

[![Node.js 22+](https://img.shields.io/badge/node-22%2B-brightgreen)](#quick-start)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPLv3-blue.svg)](LICENSE)
[![Dependencies](https://img.shields.io/badge/dependencies-1%20(express)-orange)](#architecture)
[![Sources](https://img.shields.io/badge/OSINT%20sources-27-cyan)](#data-sources-27)
[![Docker](https://img.shields.io/badge/docker-ready-blue?logo=docker)](#docker)

**Enter The Signal Network**

[![Signal Wire](https://img.shields.io/badge/Signal%20Wire-%40crucixmonitor-111111?style=for-the-badge&logo=x&logoColor=white)](https://x.com/crucixmonitor)
[![Ops Room](https://img.shields.io/badge/Ops%20Room-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/ChVy7SF4)

![Crucix Dashboard](docs/dashboard.png)

<details>
<summary>More screenshots</summary>

| Boot Sequence | World Map |
|:---:|:---:|
| ![Boot](docs/boot.png) | ![Map](docs/map.png) |

| 3D Globe View |
|:---:|
| ![Globe](docs/globe.png) |

</details>

</div>

> **Live website:** [https://www.crucix.live/](https://www.crucix.live/)
> Explore the public demo first, then clone the repo to run Crucix locally.

Crucix pulls satellite fire detection, flight tracking, radiation monitoring, satellite constellation tracking, economic indicators, live market prices, conflict data, sanctions lists, and social sentiment from 27 open-source intelligence feeds — in parallel, every 15 minutes — and renders everything on a single self-contained Jarvis-style dashboard.

Hook it up to an LLM and it becomes a **two-way intelligence assistant** — pushing multi-tier alerts to Telegram and Discord when something meaningful changes, responding to commands like `/brief` and `/sweep` from your phone, and generating actionable trade ideas grounded in real cross-domain data. Your own analyst that watches the world while you sleep.

Try the live demo first at [https://www.crucix.live/](https://www.crucix.live/), then clone the repo when you want the full local stack.

No cloud. No telemetry. No subscriptions. Just `node server.mjs` and you're running.

---

## Why This Exists

Most of the world's real-time intelligence — satellite imagery, radiation levels, conflict events, economic indicators, flight tracking, maritime activity — is publicly available. It's just scattered across dozens of government APIs, research institutions, and open data feeds that nobody has time to check individually.

Crucix brings it all into one place. Not behind a paywall, not locked in an enterprise platform, not requiring a security clearance. Just open data, aggregated and cross-correlated on your own machine, updated every 15 minutes.

It was built for anyone who wants to understand what's actually happening in the world right now — researchers, journalists, traders, OSINT analysts, or just curious people who believe access to information shouldn't depend on your budget.

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/calesthio/Crucix.git
cd Crucix

# 2. Install dependencies (just Express)
npm install

# 3. Copy env template and add your API keys (see below)
cp .env.example .env

# 4. Start the dashboard
npm run dev
```

> **If `npm run dev` fails silently** (exits with no output), run Node directly instead:
> ```bash
> node --trace-warnings server.mjs
> ```
> This bypasses npm's script runner, which can swallow errors on some systems (particularly PowerShell on Windows). You can also run `node diag.mjs` to diagnose the exact issue — it checks your Node version, tests each module import individually, and verifies port availability. See [Troubleshooting](#troubleshooting) for more.

The dashboard opens automatically at `http://localhost:3117` and immediately begins its first intelligence sweep. This initial sweep queries all 27 sources in parallel and typically takes 30–60 seconds — the dashboard will appear empty until the sweep completes and pushes the first data update. After that, it auto-refreshes every 15 minutes via SSE (Server-Sent Events). No manual page refresh needed.

**Requirements:** Node.js 22+ (uses native `fetch`, top-level `await`, ESM)

### Docker

```bash
git clone https://github.com/calesthio/Crucix.git
cd Crucix
cp .env.example .env    # add your API keys
docker compose up -d
```

Dashboard at `http://localhost:3117`. Sweep data persists in `./runs/` via volume mount. Includes a health check endpoint.

---

## What You Get

### Live Dashboard
A self-contained Jarvis-style HUD with:
- **3D WebGL globe** (Globe.gl) with atmosphere glow, star field, and smooth rotation — plus a classic flat map toggle
- **9 marker types** across both views: fire detections, air traffic, radiation sites, maritime chokepoints, SDR receivers, OSINT events, health alerts, geolocated news, conflict events
- **Animated 3D flight corridor arcs** between air traffic hotspots and global hubs
- **Region filters** (World, Americas, Europe, Middle East, Asia Pacific, Africa) — rotates the globe or zooms the flat map
- **Live market data** — indexes, crypto, energy, commodities via Yahoo Finance (no API key needed)
- **Risk gauges** — VIX, high-yield spread, supply chain pressure index
- **OSINT feed** — English-language posts from 17 Telegram intelligence channels (expandable)
- **News ticker** — merged RSS + GDELT headlines + Telegram posts, auto-scrolling
- **Sweep delta** — live panel showing what changed since last sweep (new signals, escalations, de-escalations with severity)
- **Cross-source signals** — correlated intelligence across satellite, economic, conflict, and social domains
- **Nuclear watch** — real-time radiation readings from Safecast + EPA RadNet
- **Space watch** — CelesTrak satellite tracking: recent launches, ISS, military constellations, Starlink/OneWeb counts
- **Leverageable ideas** — AI-generated trade ideas (with LLM) or signal-correlated ideas (without)

### Auto-Refresh
The server runs a sweep cycle every 15 minutes (configurable). Each cycle:
1. Queries all 27 sources in parallel (~30s)
2. Synthesizes raw data into dashboard format
3. Computes delta from previous run (what changed, escalated, de-escalated) — visible in the **Sweep Delta** panel on the dashboard
4. Generates LLM trade ideas (if configured)
5. Evaluates breaking news alerts — multi-tier (FLASH / PRIORITY / ROUTINE) with semantic dedup. Sends to Telegram and/or Discord if configured. Works with LLM evaluation or falls back to rule-based alerting when LLM is unavailable.
6. Pushes update to all connected browsers via SSE

### Telegram Bot (Two-Way)
Crucix doubles as an interactive Telegram bot. Beyond sending alerts, it responds to commands directly from your chat:

| Command | What It Does |
|---------|-------------|
| `/status` | System health, last sweep time, source status, LLM status |
| `/sweep` | Trigger a manual sweep cycle |
| `/brief` | Compact text summary of the latest intelligence (direction, key metrics, top OSINT) |
| `/portfolio` | Portfolio status (if Alpaca connected) |
| `/alerts` | Recent alert history with tiers |
| `/mute` / `/mute 2h` | Silence alerts for 1h (or custom duration) |
| `/unmute` | Resume alerts |
| `/help` | Show all available commands |

This requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`. The bot polls for messages every 5 seconds (configurable via `TELEGRAM_POLL_INTERVAL`).

### Discord Bot (Two-Way)

Crucix also supports Discord as a full-featured bot with slash commands and rich embed alerts. It mirrors the Telegram bot's capabilities with Discord-native formatting.

| Command | What It Does |
|---------|-------------|
| `/status` | System health, last sweep time, source status, LLM status |
| `/sweep` | Trigger a manual sweep cycle |
| `/brief` | Compact text summary of the latest intelligence |
| `/portfolio` | Portfolio status (if Alpaca connected) |

Alerts are delivered as rich embeds with color-coded sidebars: red for FLASH, yellow for PRIORITY, blue for ROUTINE. Each embed includes signal details, confidence scores, and cross-domain correlations.

**Setup requires:** `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, and optionally `DISCORD_GUILD_ID` for instant slash command registration. See [API Keys Setup](#api-keys-setup) for details.

**Webhook fallback:** If you don't want to run a full bot, set `DISCORD_WEBHOOK_URL` instead. This enables one-way alerts (no slash commands) with zero dependencies — no `discord.js` needed.

**Optional dependency:** The full bot requires `discord.js`. Install it with `npm install discord.js`. If it's not installed, Crucix automatically falls back to webhook-only mode.

### Optional LLM Layer
Connect any of 7 LLM providers for enhanced analysis:
- **AI trade ideas** — quantitative analyst producing 5-8 actionable ideas citing specific data
- **Smarter alert evaluation** — LLM classifies signals into FLASH/PRIORITY/ROUTINE tiers with cross-domain correlation and confidence scoring
- Providers: Anthropic Claude, OpenAI, Google Gemini, OpenRouter (Unified API), OpenAI Codex (ChatGPT subscription), MiniMax, Mistral
- Graceful fallback — when LLM is unavailable, a rule-based engine takes over alert evaluation. LLM failures never crash the sweep cycle.

---

## API Keys Setup

Copy `.env.example` to `.env` at the project root:

```bash
cp .env.example .env
```

### Required for Best Results (all free)

| Key | Source | How to Get |
|-----|--------|------------|
| `FRED_API_KEY` | Federal Reserve Economic Data | [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html) — instant, free |
| `FIRMS_MAP_KEY` | NASA FIRMS (satellite fire data) | [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/api/area/) — instant, free |
| `EIA_API_KEY` | US Energy Information Administration | [api.eia.gov](https://www.eia.gov/opendata/register.php) — instant, free |

These three unlock the most valuable economic and satellite data. Each takes about 60 seconds to register.

### Optional (enable additional sources)

| Key | Source | How to Get |
|-----|--------|------------|
| `ACLED_EMAIL` + `ACLED_PASSWORD` | Armed conflict event data | [acleddata.com/register](https://acleddata.com/register/) — free, OAuth2 |
| `AISSTREAM_API_KEY` | Maritime AIS vessel tracking | [aisstream.io](https://aisstream.io/) — free |
| `ADSB_API_KEY` | Unfiltered flight tracking | [RapidAPI](https://rapidapi.com/adsbexchange/api/adsbexchange-com1) — ~$10/mo |

### LLM Provider (optional, for AI-enhanced ideas)

Set `LLM_PROVIDER` to one of: `anthropic`, `openai`, `gemini`, `codex`, `openrouter`, `minimax`, `mistral`

| Provider | Key Required | Default Model |
|----------|-------------|---------------|
| `anthropic` | `LLM_API_KEY` | claude-sonnet-4-6 |
| `openai` | `LLM_API_KEY` | gpt-5.4 |
| `gemini` | `LLM_API_KEY` | gemini-3.1-pro |
| `openrouter` | `LLM_API_KEY` | openrouter/auto |
| `codex` | None (uses `~/.codex/auth.json`) | gpt-5.3-codex |
| `minimax` | `LLM_API_KEY` | MiniMax-M2.5 |
| `mistral` | `LLM_API_KEY` | mistral-small-latest |

For Codex, run `npx @openai/codex login` to authenticate via your ChatGPT subscription.

### Telegram Bot + Alerts (optional)

| Key | How to Get |
|-----|------------|
| `TELEGRAM_BOT_TOKEN` | Create via [@BotFather](https://t.me/BotFather) on Telegram |
| `TELEGRAM_CHAT_ID` | Get via [@userinfobot](https://t.me/userinfobot) |
| `TELEGRAM_CHANNELS` | *(Optional)* Comma-separated extra channel IDs to monitor beyond the 17 built-in channels |
| `TELEGRAM_POLL_INTERVAL` | *(Optional)* Bot command polling interval in ms (default: 5000) |

### Discord Bot + Alerts (optional)

| Key | How to Get |
|-----|------------|
| `DISCORD_BOT_TOKEN` | Create at [Discord Developer Portal](https://discord.com/developers/applications) → Bot → Token |
| `DISCORD_CHANNEL_ID` | Right-click channel in Discord (Developer Mode on) → Copy Channel ID |
| `DISCORD_GUILD_ID` | *(Optional)* Right-click server → Copy Server ID. Enables instant slash command registration (otherwise takes up to 1 hour for global commands) |
| `DISCORD_WEBHOOK_URL` | *(Optional)* Channel Settings → Integrations → Webhooks → New Webhook → Copy URL. Use this for alert-only mode without a bot |

**Discord bot setup:**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications) and create a new application
2. Go to **Bot** → click **Reset Token** → copy the token to `DISCORD_BOT_TOKEN`
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**
4. Go to **OAuth2** → **URL Generator** → select `bot` + `applications.commands` scopes → select `Send Messages` + `Embed Links` permissions
5. Copy the generated URL and open it in your browser to invite the bot to your server
6. Install the dependency: `npm install discord.js`

Alerts work with or without an LLM on both Telegram and Discord. With an LLM configured, signal evaluation is richer and more context-aware. Without one, a deterministic rule engine evaluates signals based on severity, cross-domain correlation, and signal counts.

### Without Any Keys

Crucix still works with zero API keys. 18+ sources require no authentication at all. Sources that need keys return structured errors and the rest of the sweep continues normally.

---

## Architecture

```
crucix/
├── server.mjs                 # Express dev server (SSE, auto-refresh, LLM, bot commands)
├── crucix.config.mjs          # Configuration with env var overrides + delta thresholds
├── diag.mjs                   # Diagnostic script — run if server fails to start
├── .env.example               # All documented env vars
├── package.json               # Runtime: express | Optional: discord.js
├── docs/                      # Screenshots for README
│
├── apis/
│   ├── briefing.mjs           # Master orchestrator — runs all 27 sources in parallel
│   ├── save-briefing.mjs      # CLI: save timestamped + latest.json
│   ├── BRIEFING_PROMPT.md     # Intelligence synthesis protocol
│   ├── BRIEFING_TEMPLATE.md   # Briefing output structure
│   ├── utils/
│   │   ├── fetch.mjs          # safeFetch() — timeout, retries, abort, auto-JSON
│   │   └── env.mjs            # .env loader (no dotenv dependency)
│   └── sources/               # 27 self-contained source modules
│       ├── gdelt.mjs          # Each exports briefing() → structured data
│       ├── fred.mjs           # Can run standalone: node apis/sources/fred.mjs
│       ├── space.mjs          # CelesTrak satellite tracking
│       ├── yfinance.mjs       # Yahoo Finance — free live market data
│       └── ...                # 23 more
│
├── dashboard/
│   ├── inject.mjs             # Data synthesis + standalone HTML injection
│   └── public/
│       └── jarvis.html        # Self-contained Jarvis HUD
│
├── lib/
│   ├── llm/                   # LLM abstraction (7 providers, raw fetch, no SDKs)
│   │   ├── provider.mjs       # Base class
│   │   ├── anthropic.mjs      # Claude
│   │   ├── openai.mjs         # GPT
│   │   ├── gemini.mjs         # Gemini
│   │   ├── openrouter.mjs     # OpenRouter (Unified API)
│   │   ├── codex.mjs          # Codex (ChatGPT subscription)
│   │   ├── minimax.mjs        # MiniMax (M2.5, 204K context)
│   │   ├── mistral.mjs        # Mistral (OpenAI-compatible, JSON mode)
│   │   ├── ideas.mjs          # LLM-powered trade idea generation
│   │   └── index.mjs          # Factory: createLLMProvider()
│   ├── delta/                 # Change tracking between sweeps
│   │   ├── engine.mjs         # Delta computation — semantic dedup, configurable thresholds, severity scoring
│   │   ├── memory.mjs         # Hot memory (3 runs, atomic writes) + cold storage (daily archives)
│   │   └── index.mjs          # Re-exports
│   └── alerts/
│       ├── telegram.mjs       # Multi-tier alerts (FLASH/PRIORITY/ROUTINE) + two-way bot commands
│       └── discord.mjs        # Discord bot (slash commands, rich embeds) + webhook fallback
│
└── runs/                      # Runtime data (gitignored)
    ├── latest.json            # Most recent sweep output
    └── memory/                # Delta memory (hot.json + cold/YYYY-MM-DD.json)
```

### Design Principles
- **Pure ESM** — every file is `.mjs` with explicit imports
- **Minimal dependencies** — Express is the only runtime dependency. `discord.js` is optional (for Discord bot). LLM providers use raw `fetch()`, no SDKs.
- **Parallel execution** — `Promise.allSettled()` fires all 27 sources simultaneously
- **Graceful degradation** — missing keys produce errors, not crashes. LLM failures don't kill sweeps.
- **Each source is standalone** — run `node apis/sources/gdelt.mjs` to test any source independently
- **Self-contained dashboard** — the HTML file works with or without the server

---

## Data Sources (27)

### Tier 1: Core OSINT & Geopolitical (11)

| Source | What It Tracks | Auth |
|--------|---------------|------|
| **GDELT** | Global news events, conflict mapping (100+ languages) | None |
| **OpenSky** | Real-time ADS-B flight tracking across 6 hotspot regions | None |
| **NASA FIRMS** | Satellite fire/thermal anomaly detection (3hr latency) | Free key |
| **Maritime/AIS** | Vessel tracking, dark ships, sanctions evasion | Free key |
| **Safecast** | Citizen-science radiation monitoring near 6 nuclear sites | None |
| **ACLED** | Armed conflict events: battles, explosions, protests | Free (OAuth2) |
| **ReliefWeb** | UN humanitarian crisis tracking | None |
| **WHO** | Disease outbreaks and health emergencies | None |
| **OFAC** | US Treasury sanctions (SDN list) | None |
| **OpenSanctions** | Aggregated global sanctions (30+ sources) | Partial |
| **ADS-B Exchange** | Unfiltered flight tracking including military | Paid |

### Tier 2: Economic & Financial (7)

| Source | What It Tracks | Auth |
|--------|---------------|------|
| **FRED** | 22 key indicators: yield curve, CPI, VIX, fed funds, M2 | Free key |
| **US Treasury** | National debt, yields, fiscal data | None |
| **BLS** | CPI, unemployment, nonfarm payrolls, PPI | None |
| **EIA** | WTI/Brent crude, natural gas, inventories | Free key |
| **GSCPI** | NY Fed Global Supply Chain Pressure Index | None |
| **USAspending** | Federal spending and defense contracts | None |
| **UN Comtrade** | Strategic commodity trade flows between major powers | None |

### Tier 3: Weather, Environment, Tech, Social, SIGINT (7)

| Source | What It Tracks | Auth |
|--------|---------------|------|
| **NOAA/NWS** | Active US weather alerts | None |
| **EPA RadNet** | US government radiation monitoring | None |
| **USPTO Patents** | Patent filings in 7 strategic tech areas | None |
| **Bluesky** | Social sentiment on geopolitical/market topics | None |
| **Reddit** | Social sentiment from key subreddits | OAuth |
| **Telegram** | 17 curated OSINT/conflict/finance channels (web scraping, expandable via config) | None |
| **KiwiSDR** | Global HF radio receiver network (~600 receivers) | None |

### Tier 4: Space & Satellites (1)

| Source | What It Tracks | Auth |
|--------|---------------|------|
| **CelesTrak** | Satellite launches, ISS tracking, military constellations, Starlink/OneWeb counts | None |

### Tier 5: Live Market Data (1)

| Source | What It Tracks | Auth |
|--------|---------------|------|
| **Yahoo Finance** | Real-time prices: SPY, QQQ, BTC, Gold, WTI, VIX + 9 more | None |

---

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | `node --trace-warnings server.mjs` | Start dashboard with auto-refresh |
| `npm run sweep` | `node apis/briefing.mjs` | Run a single sweep, output JSON to stdout |
| `npm run inject` | `node dashboard/inject.mjs` | Inject latest data into static HTML |
| `npm run brief:save` | `node apis/save-briefing.mjs` | Run sweep + save timestamped JSON |
| `npm run diag` | `node diag.mjs` | Run diagnostics (Node version, imports, port check) |

---

## Configuration

All settings are in `.env` with sensible defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3117` | Dashboard server port |
| `REFRESH_INTERVAL_MINUTES` | `15` | Auto-refresh interval |
| `LLM_PROVIDER` | disabled | `anthropic`, `openai`, `gemini`, `codex`, `openrouter`, `minimax`, or `mistral` |
| `LLM_API_KEY` | — | API key (not needed for codex) |
| `LLM_MODEL` | per-provider default | Override model selection |
| `TELEGRAM_BOT_TOKEN` | disabled | For Telegram alerts + bot commands |
| `TELEGRAM_CHAT_ID` | — | Your Telegram chat ID |
| `TELEGRAM_CHANNELS` | — | Extra channel IDs to monitor (comma-separated) |
| `TELEGRAM_POLL_INTERVAL` | `5000` | Bot command polling interval (ms) |
| `DISCORD_BOT_TOKEN` | disabled | For Discord alerts + slash commands |
| `DISCORD_CHANNEL_ID` | — | Discord channel for alerts |
| `DISCORD_GUILD_ID` | — | Server ID (instant slash command registration) |
| `DISCORD_WEBHOOK_URL` | — | Webhook URL (alert-only fallback, no bot needed) |

Delta engine thresholds (how sensitive the system is to changes between sweeps) can be customized in `crucix.config.mjs` under the `delta.thresholds` section. The defaults are tuned to filter out noise while catching meaningful moves.

---

## API Endpoints

When running `npm run dev`:

| Endpoint | Description |
|----------|-------------|
| `GET /` | Jarvis HUD dashboard |
| `GET /api/data` | Current synthesized intelligence data (JSON) |
| `GET /api/health` | Server status, uptime, source count, LLM status |
| `GET /events` | SSE stream for live push updates |

---

## Troubleshooting

### `npm run dev` exits silently (no output, no error)

This is a known issue where npm's script runner can swallow errors, particularly on Windows PowerShell. Try these in order:

**1. Run Node directly (bypasses npm):**
```bash
node --trace-warnings server.mjs
```
This is functionally identical to `npm run dev` but gives you full error output.

**2. Run the diagnostic script:**
```bash
node diag.mjs
```
This tests every import one by one, checks your Node.js version, and verifies port 3117 is available. It will tell you exactly what's failing.

**3. Check if port 3117 is already in use:**

A previous Crucix instance may still be running in the background.

```powershell
# Windows PowerShell
netstat -ano | findstr 3117
taskkill /F /PID <the_PID_from_above>

# Or kill all Node processes
taskkill /F /IM node.exe
```

```bash
# macOS / Linux
lsof -ti:3117 | xargs kill
```

Then try starting again. You can also change the port by setting `PORT=3118` in your `.env` file.

**4. Check Node.js version:**
```bash
node --version
```
Crucix requires Node.js 22 or later. If you have an older version, download the latest LTS from [nodejs.org](https://nodejs.org/).

### Dashboard shows empty panels after first start

This is normal — the first sweep takes 30–60 seconds to query all 27 sources. The dashboard will populate automatically once the sweep completes. Check the terminal for sweep progress logs.

### Some sources show errors

Expected behavior. Sources that require API keys will return structured errors if the key isn't set. The rest of the sweep continues normally. Check the Source Integrity section in the dashboard (or the server logs) to see which sources failed and why. The 3 most impactful free keys to add are `FRED_API_KEY`, `FIRMS_MAP_KEY`, and `EIA_API_KEY`.

### Telegram bot not responding to commands

Make sure both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set in `.env`. The bot only responds to messages from the configured chat ID (security measure). You should see `[Crucix] Telegram alerts enabled` and `[Crucix] Bot command polling started` in the server logs on startup. If not, double-check your token with `curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe`.

### Discord bot not responding to slash commands

Check these in order:
1. Make sure `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` are set in `.env`
2. Verify `discord.js` is installed: `npm ls discord.js`. If missing, run `npm install discord.js`
3. If slash commands don't appear, set `DISCORD_GUILD_ID` — without it, global commands can take up to 1 hour to propagate. Guild-specific commands register instantly
4. Confirm the bot was invited with `bot` + `applications.commands` scopes and has `Send Messages` + `Embed Links` permissions in the target channel
5. Check server logs for `[Discord] Bot logged in as ...` on startup. If you see `[Discord] discord.js not installed`, install it and restart
6. **Webhook-only fallback:** If you just want alerts without slash commands, set `DISCORD_WEBHOOK_URL` instead of the bot token. No `discord.js` needed.

---

## Screenshots

The `docs/` folder contains dashboard screenshots referenced by this README:

| File | Description |
|------|-------------|
| `docs/dashboard.png` | Full dashboard — hero image at the top of this README |
| `docs/boot.png` | Cinematic boot sequence animation |
| `docs/map.png` | D3 world map with marker types and flight arcs |
| `docs/globe.png` | 3D WebGL globe view with atmosphere glow and markers |

To update them: run the dashboard, wait for a sweep to complete, then use your browser's DevTools (`F12` → `Ctrl+Shift+P` → "Capture full size screenshot") or a tool like [LICEcap](https://www.cockos.com/licecap/) for GIFs.

---

## Contributing

Found a bug? Want to add a 28th source? PRs welcome. Each source is a standalone module in `apis/sources/` — just export a `briefing()` function that returns structured data and add it to the orchestrator in `apis/briefing.mjs`.

If you find this useful, a star helps others find it too.

For contribution guidelines, review expectations, and source-add rules, see `CONTRIBUTING.md`. For security reports, see `SECURITY.md`.

## Contact

For partnerships, integrations, or other non-issue inquiries, you can reach me at `celesthioailabs@gmail.com`.

For bugs and feature requests, please use GitHub Issues so discussion stays visible and actionable.

---

## License

AGPL-3.0
