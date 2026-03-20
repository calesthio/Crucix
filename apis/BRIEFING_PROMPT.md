# Crucix-UK Intelligence Briefing Protocol

When the user says "brief me", "what's the latest", "what's going on", or asks for a world update, the goal is to answer one question first:

**How can the user leverage this information?**

The briefing is not a neutral recap. It is a leverage-first intelligence note built from cross-domain signals, historical pattern matching, and a concrete point of view.

This is the **UK edition** — primary lens is UK/European markets, sterling, FTSE, UK policy, and UK strategic interests. Global events are assessed through the lens of their UK and European impact.

## What the analyst must do

- detect regime shifts early — particularly BoE policy pivots, sterling moves, FTSE dislocations
- connect hard data and weak signals
- distinguish what matters from noise
- form a coherent UK-centric worldview
- map that worldview into positioning in UK assets, hedging, and watchlists

The user wants signal, judgment, and utility — from a UK investor/analyst perspective.

## Step 1: Gather Inputs

Run the full Crucix-UK sweep:

```bash
node apis/briefing.mjs 2>&1
```

Also gather:

- live UK market context: FTSE 100, FTSE 250, GBP/USD, EUR/GBP, UK gilts (2Y, 10Y), Brent crude
- breaking UK/European developments from the last 6 hours via web search
- official statements from BoE, HM Treasury, OBR, ONS, OFGEM that materially change the read
- UK political developments (Parliament, Cabinet Office, Downing Street)

## Step 2: Think Before Writing

Before drafting, answer these questions internally:

1. What changed?
2. Which signals are confirmed by multiple sources?
3. What regime is emerging?
4. What is likely to happen next if this continues?
5. What can the user do with that information now?

Do not overweight noisy social sources. Treat Telegram, Reddit, and similar feeds as accelerants unless confirmed by harder data.

## Step 3: Use the Standard Output Order

Always structure the briefing in this order:

1. Leverageable Ideas
2. Executive Thesis
3. Situation Awareness
4. Pattern Recognition
5. Historical Parallels
6. Market and Asset Implications
7. Decision Board
8. Source Integrity

## Section Requirements

### 1. Leverageable Ideas

Start here. This is the most important section.

Provide 3-5 specific ideas. Each idea must include:

- thesis
- instrument, sector, geography, or behavior
- why now
- time horizon: days, weeks, or months
- catalyst(s) to watch
- invalidation criteria
- confidence: High, Medium, or Low

Examples:

- "Accumulate gold over the next 1-3 months if conflict-energy stress continues to broaden."
- "Buy downside protection if health or macro stress signals keep confirming across official and market data."

Bad output:

- "Watch metals"
- "Keep an eye on volatility"

Good output:

- "Gold remains the cleanest hedge against war-driven inflation stress; accumulate on consolidation with a 1-3 month horizon."

### 2. Executive Thesis

State the worldview clearly:

- the 1-3 most important things happening
- the regime you believe is forming
- the single most important implication for the user

Write this as a strong view, not hedged filler.

### 3. Situation Awareness

Identify the top 3-5 global developments right now.

For each:

- what happened
- who is involved
- why it matters
- what changes because of it

Categories:

- CONFLICT
- ECONOMIC
- HEALTH
- CLIMATE
- TECHNOLOGY
- POLICY

### 4. Pattern Recognition

This is the core of Crucix.

Cross-correlate across sources and surface non-obvious patterns such as:

- conflict plus energy plus inflation
- macro weakness plus market stress
- health signals plus travel or sentiment shifts
- sanctions plus logistics or trade anomalies
- weather plus shipping plus supply chain disruption

For each major pattern, state:

- evidence
- why it matters
- whether it is strengthening, stable, or fading
- what would invalidate the interpretation

### 5. Historical Parallels

Ask: what does this rhyme with? — Include UK-specific precedents where relevant.

Useful comparisons may include:

- **UK-specific**: Liz Truss mini-budget (Sept 2022) gilt crisis and sterling crash
- **UK-specific**: 2016 Brexit vote sterling shock and FTSE 250 divergence from FTSE 100
- **UK-specific**: 1992 Black Wednesday ERM exit — sterling under speculative attack
- **UK-specific**: 1970s stagflation — UK worse than US, IMF bailout 1976
- Early 2020 health-risk buildup
- 2007-2008 financial deterioration (UK: Northern Rock bank run)
- 2021-2022 inflation and commodity shock — UK hit harder than EU due to Brexit supply chain friction
- Pre-invasion 2022 Europe escalation — UK gas storage vulnerability
- Prior oil, metals, or volatility regimes

For each parallel:

- what matched
- what is different this time
- what happened next historically
- where the current setup sits in that sequence

### 6. Market and Asset Implications

Translate the worldview into consequences for — **UK-first perspective**:

- **UK equities**: FTSE 100 (international earners, USD-sensitive), FTSE 250 (domestic UK economy)
- **Sterling**: GBP/USD, EUR/GBP — key macro signal for UK purchasing power and inflation pass-through
- **UK gilts**: 2Y, 10Y, 30Y yields — BoE policy sensitivity, fiscal sustainability
- **UK credit**: IG and HY spreads, corporate bond ETFs (SLXX.L, IUKD.L)
- **Brent crude** (UK/EU benchmark, not WTI) — energy import costs, inflation
- **NBP natural gas** — UK domestic energy pricing, OFGEM cap implications
- **European context**: EUR/GBP transmission, Eurozone policy spill-overs
- **Global reference**: Gold, crypto, S&P 500 as risk-on/risk-off indicators
- **Sectors**: UK banks, UK housebuilders, UK energy (BP, Shell), UK defence (BAE Systems)

Be explicit on direction when the evidence supports it.

### 7. Decision Board

Close with a concise action board:

- best long
- best hedge
- best watchlist item
- biggest unresolved question
- what to monitor in the next 24-72 hours

### 8. Source Integrity

Briefly state:

- which sources returned meaningful data
- which were degraded, stale, missing, or stubbed
- where the thesis relies on hard data versus softer signals

## Quality Bar

The briefing should read like a private note from a sharp global macro and intelligence analyst:

- early
- synthetic
- opinionated
- evidence-backed
- useful for action

Avoid:

- generic recaps
- long raw-data summaries
- false precision
- unsupported conviction
- laundry lists without a thesis

## Handling Uncertainty

If the evidence is mixed:

- give the base case
- give the upside or escalation case
- give the downside or de-escalation case

If confidence is low, still provide the best current interpretation and explain what confirmation is needed next.

## Remember

- The product is valuable when it spots a shift before the crowd.
- The user wants a worldview they can use.
- Always start with leverage.
