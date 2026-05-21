# Crucix Architecture Report

> Generated: 2026-03-20

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| **Name** | Crucix |
| **Version** | 2.0.0 |
| **Type** | Local OSINT Intelligence Dashboard |
| **License** | AGPL-3.0-only |
| **Runtime** | Node.js 22+ (ES Modules, `.mjs`) |
| **Entry Point** | `server.mjs` |
| **Port** | 3117 (default) |

---

## 2. Technology Stack

### Backend
| Layer | Technology |
|-------|-----------|
| Web framework | **Express 5.1.0** (only production dependency) |
| HTTP runtime | Node.js native `fetch` (Node 22+) |
| HTTP utils | `apis/utils/fetch.mjs` — timeout wrapper, retry logic |
| Scheduling | `setInterval` (no cron library) |
| Tests | Node.js built-in `node:test` + `assert` |
| Optional bots | `discord.js ^14.25.1` (optional dep) |

### Frontend
| Layer | Technology |
|-------|-----------|
| Framework | **Vanilla JS** — no React/Vue/Angular |
| Entry file | `dashboard/public/jarvis.html` (1,763 lines, monolithic) |
| State | Global `D` object, replaced on SSE update |
| 3D Globe | **Globe.gl v2.33.0** (via CDN) |
| 3D Engine | **Three.js v0.160.0** (via CDN, used by Globe.gl) |
| Flat Map | **D3.js v7** + TopoJSON v3 (via CDN) |
| Animations | **GSAP 3.12.5** (via CDN) |
| Build system | **None** — files served directly, no bundler |

### Infrastructure
| Component | Technology |
|-----------|-----------|
| Container | Docker (Node 22 Alpine, multi-stage) |
| Compose | `docker-compose.yml` — port 3117, volume `./runs` |
| Persistence | **JSON files** (no database) |
| CI/CD | GitHub Actions — `docker-publish.yml` |

---

## 3. Project File Structure

```
Crucix/
├── server.mjs                    # Main entry: Express + sweep orchestrator (475 lines)
├── crucix.config.mjs             # Config with env var overrides
├── diag.mjs                      # Diagnostic tool (Node version, ports)
├── package.json                  # 1 prod dep (express), 1 optional (discord.js)
├── Dockerfile                    # Node 22 Alpine, health check on /api/health
├── docker-compose.yml            # Port 3117, volume ./runs, restart unless-stopped
├── .env.example                  # All environment variable docs
├── .nvmrc                        # Node 22
│
├── apis/
│   ├── briefing.mjs              # Orchestrator: runs all 27 sources in parallel
│   ├── save-briefing.mjs         # Saves raw briefing to disk
│   ├── utils/
│   │   ├── env.mjs               # Loads .env file
│   │   └── fetch.mjs             # Fetch wrapper with timeout + retries
│   └── sources/                  # 27 OSINT/market/satellite data collectors
│       ├── [Tier 1] gdelt, opensky, firms, ships, safecast, acled,
│       │           reliefweb, who, ofac, opensanctions, adsb
│       ├── [Tier 2] fred, treasury, bls, eia, gscpi, usaspending, comtrade
│       ├── [Tier 3] noaa, epa, patents, bluesky, reddit, telegram, kiwisdr
│       ├── [Tier 4] space
│       └── [Tier 5] yfinance
│
├── dashboard/
│   ├── inject.mjs                # Synthesizes raw data → dashboard format + RSS + geo-tagging
│   └── public/
│       ├── jarvis.html           # Main SPA (101KB, inline CSS+JS, 1763 lines)
│       └── loading.html          # Shown until first sweep completes
│
├── lib/
│   ├── i18n.mjs                  # Internationalization (EN, FR)
│   ├── delta/
│   │   ├── engine.mjs            # Delta computation (metric thresholds, risk direction)
│   │   ├── memory.mjs            # Hot/cold persistence, alert cooldown tracking
│   │   └── index.mjs             # Exports MemoryManager + computeDelta
│   ├── alerts/
│   │   ├── telegram.mjs          # Two-way bot: /commands + FLASH/PRIORITY/ROUTINE alerts
│   │   └── discord.mjs           # Slash commands + embeds + webhook fallback
│   └── llm/
│       ├── provider.mjs          # Base class
│       ├── index.mjs             # Factory: createLLMProvider()
│       ├── anthropic.mjs         # Claude (claude-sonnet-4-6)
│       ├── openai.mjs            # GPT
│       ├── openrouter.mjs        # OpenRouter proxy
│       ├── gemini.mjs            # Google Gemini
│       ├── codex.mjs             # Anthropic Codex CLI
│       ├── minimax.mjs           # MiniMax-M2.5
│       ├── mistral.mjs           # Mistral-large-latest
│       └── ideas.mjs             # LLM trade idea generation (5–8 ideas per sweep)
│
├── locales/
│   ├── en.json                   # English strings (12.8KB)
│   └── fr.json                   # French strings (13.7KB)
│
├── test/
│   ├── llm-minimax.test.mjs
│   ├── llm-minimax-integration.test.mjs
│   ├── llm-mistral.test.mjs
│   ├── llm-mistral-integration.test.mjs
│   ├── llm-openrouter.test.mjs
│   └── llm-openrouter-integration.test.mjs
│
├── scripts/
│   └── clean.mjs                 # Deletes runs/ directory
│
└── runs/                         # Runtime data (created at startup)
    ├── latest.json               # Last completed sweep output
    └── memory/
        ├── hot.json              # 3 most recent runs + alert cooldown state
        ├── hot.json.bak          # Atomic write backup
        └── cold/                 # Archived older runs (by timestamp)
```

---

## 4. API Routes (Express Server)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves `jarvis.html` (with locale injection) or `loading.html` on cold start |
| `GET` | `/api/data` | Returns latest synthesized dashboard data (JSON); 503 if sweep not yet complete |
| `GET` | `/api/health` | Uptime, lastSweep, nextSweep, sourcesOk/Failed, LLM/Telegram/Discord status |
| `GET` | `/api/locales` | Current language + supported locales |
| `GET` | `/events` | SSE stream — pushes `sweep_start`, `update`, `sweep_error` events |

**SSE Message Types** (`/events`):
- `{"type":"connected"}` — on client connect
- `{"type":"sweep_start", timestamp}` — when sweep begins
- `{"type":"update", data}` — full synthesized dataset on sweep completion
- `{"type":"sweep_error", error}` — on sweep failure

---

## 5. External API Integrations (27 Sources)

### Tier 1 — Core OSINT & Geopolitical (11 sources)

| Source | File | Auth | Purpose |
|--------|------|------|---------|
| **GDELT** | `apis/sources/gdelt.mjs` | None | Global events/news, 100+ languages |
| **OpenSky** | `apis/sources/opensky.mjs` | None (or API key for higher rate) | Real-time ADS-B flight tracking; hotspot monitoring (Middle East, Taiwan, Ukraine, etc.) |
| **NASA FIRMS** | `apis/sources/firms.mjs` | `FIRMS_MAP_KEY` | Active fire/thermal anomaly detection (strikes, wildfires) |
| **Maritime AIS** | `apis/sources/ships.mjs` | `AISSTREAM_API_KEY` | Vessel tracking across 9 chokepoints (Hormuz, Suez, Malacca, etc.) |
| **Safecast** | `apis/sources/safecast.mjs` | None | Radiation monitoring network |
| **ACLED** | `apis/sources/acled.mjs` | `ACLED_EMAIL` + `ACLED_PASSWORD` (OAuth2) | Armed conflict events + fatality counts |
| **ReliefWeb** | `apis/sources/reliefweb.mjs` | None | Humanitarian crisis tracking |
| **WHO** | `apis/sources/who.mjs` | None | Disease outbreak / health emergency alerts |
| **OFAC** | `apis/sources/ofac.mjs` | None | US Treasury sanctions list |
| **OpenSanctions** | `apis/sources/opensanctions.mjs` | None | Global sanctions (30+ lists: OFAC, EU, UN) |
| **ADS-B Exchange** | `apis/sources/adsb.mjs` | `ADSB_API_KEY` (RapidAPI, optional) | Unfiltered flight tracking incl. military (AWACS, U-2, B-52, drones) |

### Tier 2 — Economic & Financial (7 sources)

| Source | File | Auth | Key Data |
|--------|------|------|----------|
| **FRED** | `apis/sources/fred.mjs` | `FRED_API_KEY` | Yield curve, VIX, CPI, unemployment, M2, mortgage rates, USD index |
| **Treasury** | `apis/sources/treasury.mjs` | None | Bond yields, debt data |
| **BLS** | `apis/sources/bls.mjs` | `BLS_API_KEY` (optional) | Employment, wages, inflation |
| **EIA** | `apis/sources/eia.mjs` | `EIA_API_KEY` | Oil/gas/coal prices, inventory |
| **GSCPI** | `apis/sources/gscpi.mjs` | None | Global supply chain pressure index |
| **USAspending** | `apis/sources/usaspending.mjs` | None | Federal government spending |
| **Comtrade** | `apis/sources/comtrade.mjs` | None | UN international trade flows |

### Tier 3 — Weather, Environment, Tech, Social (7 sources)

| Source | File | Auth | Purpose |
|--------|------|------|---------|
| **NOAA** | `apis/sources/noaa.mjs` | None | Severe weather alerts (hurricanes, tornadoes, floods) |
| **EPA** | `apis/sources/epa.mjs` | None | Air quality, pollution |
| **Patents** | `apis/sources/patents.mjs` | None | USPTO/WIPO patent filings, tech trends |
| **Bluesky** | `apis/sources/bluesky.mjs` | None | AT Protocol social sentiment (`public.api.bsky.app`) |
| **Reddit** | `apis/sources/reddit.mjs` | `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` (OAuth2) | Subreddit sentiment: worldnews, geopolitics, economics, WSB, commodities |
| **Telegram** | `apis/sources/telegram.mjs` | `TELEGRAM_BOT_TOKEN` (optional) | 30+ public OSINT channels (Intel Slava Z, ZSU Operative, etc.) via `t.me/s/` web preview |
| **KiwiSDR** | `apis/sources/kiwisdr.mjs` | None | Global SDR receiver network, military radio activity |

### Tier 4 — Space & Satellites (1 source)

| Source | File | Auth | Purpose |
|--------|------|------|---------|
| **CelesTrak/Space** | `apis/sources/space.mjs` | None | TLE data, ISS position, launches, orbital debris |

### Tier 5 — Live Market Data (1 source)

| Source | File | Auth | Symbols |
|--------|------|------|---------|
| **Yahoo Finance** | `apis/sources/yfinance.mjs` | None | SPY, QQQ, TLT, HYG, GC=F, CL=F, BZ=F, BTC-USD, ^VIX, and more |

---

## 6. Data Flow (Full Pipeline)

```
STARTUP
  └── Load runs/latest.json (instant display on restart)
  └── Run first sweep immediately → schedule every 15 min

SWEEP CYCLE (runSweepCycle)
  │
  ├── [1] fullBriefing()                         apis/briefing.mjs
  │       └── 27 sources in parallel, 30s timeout each
  │       └── Returns raw data + timing + errors
  │
  ├── [2] Save to runs/latest.json               (atomic file write)
  │
  ├── [3] synthesize(rawData)                    dashboard/inject.mjs
  │       ├── Transform each source's raw output
  │       ├── Fetch RSS news feeds
  │       ├── Geo-tag articles (90+ city/region keywords → lat/lon)
  │       └── Compute OpenSky fallback if source failed
  │
  ├── [4] computeDelta(current, previous)        lib/delta/engine.mjs
  │       ├── Compare 11 numeric metrics (VIX, WTI, yields, etc.)
  │       ├── Compare 9 count metrics (alerts, fires, flights, etc.)
  │       ├── Semantic dedup Telegram posts (MD5 hashing)
  │       └── Determine direction: risk-on / risk-off / mixed
  │
  ├── [5] MemoryManager.addRun()                 lib/delta/memory.mjs
  │       ├── Append to hot.json (keep last 3 runs)
  │       └── Archive older runs to cold/
  │
  ├── [6] generateLLMIdeas() [optional]          lib/llm/ideas.mjs
  │       ├── Send sweep context to LLM provider
  │       └── Get 5–8 trade ideas (LONG/SHORT/HEDGE/WATCH/AVOID)
  │
  ├── [7] Alert Evaluation [optional]            lib/alerts/telegram.mjs + discord.mjs
  │       ├── Classify signals → FLASH / PRIORITY / ROUTINE
  │       ├── Check cooldown state in memory
  │       ├── Send to Telegram + Discord
  │       └── Update cooldown state
  │
  └── [8] broadcast({type:'update', data})       server.mjs SSE
          └── All connected browsers receive new D object → reinit()

BROWSER
  └── DOMContentLoaded → fetch('/api/data') → init()
  └── EventSource('/events') → on update: D = msg.data; reinit()
```

---

## 7. Delta Engine — Tracked Metrics

### Numeric Metrics (% threshold to trigger)
| Metric | Threshold | FRED Series |
|--------|-----------|-------------|
| VIX | 5% | VIXCLS |
| HY Spread | 5% | BAMLH0A0HYM2 |
| 10Y-2Y Spread | 10% | T10Y2Y |
| WTI Crude | 3% | — |
| Brent Crude | 3% | — |
| Natural Gas | 5% | — |
| Unemployment | 2% | UNRATE |
| Fed Funds Rate | 1% | DFF |
| 10Y Treasury | 3% | DGS10 |
| USD Index | 1% | DTWEXBGS |
| 30Y Mortgage | 2% | MORTGAGE30US |

### Count Metrics (absolute threshold)
| Metric | Threshold |
|--------|-----------|
| Urgent Telegram Posts | ±2 |
| Thermal Detections | ±500 |
| Air Activity (aircraft) | ±50 |
| WHO Alerts | ±1 |
| Conflict Events | ±5 |
| Conflict Fatalities | ±10 |
| SDR Receivers Online | ±3 |
| News Items | ±5 |
| Sources Healthy | ±1 |

---

## 8. Alert System

### Tiers
| Tier | Cooldown | Max/Hour | Use Case |
|------|----------|----------|----------|
| FLASH | 5 min | 6 | Market-moving events |
| PRIORITY | 30 min | 4 | Important signals |
| ROUTINE | 60 min | 2 | Noteworthy changes |

### Cooldown Decay (per signal hash)
- 1st alert: no wait
- 2nd within 24h: 6h cooldown
- 3rd within 24h: 12h cooldown
- 4th+: 24h cooldown

### Telegram Bot Commands
`/status`, `/sweep`, `/brief`, `/portfolio`, `/alerts`, `/mute`, `/unmute`, `/help`

### Discord Bot Commands
Same as Telegram — registered as slash commands on guild; webhook fallback available.

---

## 9. LLM Provider System

**Pattern**: Factory (`lib/llm/index.mjs`) instantiates selected provider via `LLM_PROVIDER` env.

| Provider | File | Default Model |
|----------|------|---------------|
| Anthropic | `lib/llm/anthropic.mjs` | claude-sonnet-4-6 |
| OpenAI | `lib/llm/openai.mjs` | — |
| OpenRouter | `lib/llm/openrouter.mjs` | — |
| Google Gemini | `lib/llm/gemini.mjs` | — |
| Codex CLI | `lib/llm/codex.mjs` | — |
| MiniMax | `lib/llm/minimax.mjs` | MiniMax-M2.5 |
| Mistral | `lib/llm/mistral.mjs` | mistral-large-latest |

LLM is fully optional — failure is isolated and non-fatal to the sweep cycle.

---

## 10. Frontend Architecture

### State Management
```javascript
// Global state object
let D = {};  // Replaced atomically on each SSE update

// On SSE message:
D = msg.data;
reinit();  // Re-renders all sections
```

### Render Functions
| Function | Renders |
|----------|---------|
| `renderTopbar()` | Title, perf toggle, source health, time, alerts |
| `renderLeftRail()` | Sensor grid, nuclear watch, risk gauges, space data |
| `initMap()` / `initGlobe()` | 3D/2D map with markers, arcs, rings |
| `renderRight()` | OSINT feed cards |
| `renderLower()` | Market cards, ticker, delta, macro metrics |
| `renderGlossary()` | Signal interpretation guide |
| `showPopup()` | Context popup on marker click |

### Globe.gl Data Layers
| Layer | Color | Data Source |
|-------|-------|-------------|
| Air Activity | `rgba(100,240,200,0.8)` | OpenSky |
| Thermal/Fire | `rgba(255,95,99,0.7)` | NASA FIRMS |
| Conflict Rings | `rgba(255,120,80,...)` | ACLED (pulsing 800ms) |
| Maritime | `rgba(179,136,255,0.8)` | AIS |
| Nuclear | Yellow/Red | Safecast |
| SDR Receivers | `rgba(68,204,255,0.6)` | KiwiSDR |
| News Markers | `rgba(129,212,250,0.7)` | GDELT/RSS |
| WHO Health | `rgba(105,240,174,0.7)` | WHO |
| Space Stations | White pulsing | CelesTrak |

### Projection Toggle
- **3D**: Globe.gl + Three.js WebGL
- **Flat**: D3.js `geoNaturalEarth1()` + TopoJSON, with zoom/pan
- Auto-fallback to flat if 3D/WebGL fails

### Performance Mode
- `localStorage: crucix_low_perf` — disables animations, backdrop blur, scanlines, conflict rings
- Auto-detected on weak mobile devices

---

## 11. Persistence (File-Based, No Database)

| File | Contents |
|------|----------|
| `runs/latest.json` | Raw sweep output from all 27 sources |
| `runs/memory/hot.json` | Last 3 synthesized runs + alert cooldown state |
| `runs/memory/hot.json.bak` | Backup (atomic write recovery) |
| `runs/memory/cold/*.json` | Archived older runs |
| `runs/briefing_*.json` | Optional historical snapshots (`npm run brief:save`) |

**Atomic write pattern**: write to `.tmp` → backup current → rename `.tmp` to target.

---

## 12. Internationalization

- **Languages**: English (`en`), French (`fr`)
- **Config**: `CRUCIX_LANG` or `LANGUAGE` env var; falls back to English
- **Injection**: `window.__CRUCIX_LOCALE__` injected into HTML `<head>` at request time
- **Scope**: UI strings + LLM system prompts are localized

---

## 13. Configuration Reference (`.env.example`)

```
# Server
PORT=3117
REFRESH_INTERVAL_MINUTES=15

# OSINT API Keys (all optional — sources degrade gracefully)
FRED_API_KEY=
FIRMS_MAP_KEY=
EIA_API_KEY=
AISSTREAM_API_KEY=
ACLED_EMAIL=
ACLED_PASSWORD=
BLS_API_KEY=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
ADSB_API_KEY=

# LLM (optional)
LLM_PROVIDER=          # anthropic|openai|gemini|codex|openrouter|minimax|mistral
LLM_API_KEY=
LLM_MODEL=

# Telegram (requires LLM)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_POLL_INTERVAL=5000

# Discord (optional)
DISCORD_BOT_TOKEN=
DISCORD_CHANNEL_ID=
DISCORD_GUILD_ID=
DISCORD_WEBHOOK_URL=
```

---

## 14. npm Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Run production server |
| `npm run dev` | Run with `--trace-warnings` |
| `npm run sweep` | Run briefing.mjs directly |
| `npm run brief` | Alias for sweep |
| `npm run brief:save` | Save briefing to timestamped file |
| `npm run inject` | Run dashboard synthesis |
| `npm run diag` | Diagnose environment |
| `npm run clean` | Delete `runs/` directory |

---

## 15. Architectural Strengths & Limitations

### Strengths
- **Zero frontend framework overhead** — pure vanilla JS, instant load
- **Parallel execution** — 27 sources run concurrently, 30s timeout each
- **Graceful degradation** — any source failure is isolated; app continues
- **Atomic persistence** — no data loss on crash via `.tmp` + `.bak` pattern
- **Semantic deduplication** — MD5-based alert hashing prevents spam
- **SSE real-time** — no client polling; browser receives push updates
- **Pluggable LLM** — 7 providers, easily swappable, non-fatal on failure
- **Delta-driven alerting** — only alerts on statistically meaningful changes

### Limitations
- **No database** — file-based storage only, no query capability
- **No authentication** — open to anyone on the network (internal tool design)
- **Single-process** — no horizontal scaling / clustering
- **No rate limiting** on API endpoints
- **No frontend tests** — UI is entirely untested
- **Monolithic HTML** — 101KB single file, difficult to maintain at scale

---

## 16. How to Run

```bash
# Local
cp .env.example .env   # Add API keys as desired
npm install
npm start              # Opens http://localhost:3117

# Docker
docker compose up -d
curl http://localhost:3117/api/health

# Tests
node --test test/llm-mistral.test.mjs
node --test test/llm-openrouter.test.mjs
```
