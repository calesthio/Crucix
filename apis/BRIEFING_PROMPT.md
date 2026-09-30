# Crucix Intelligence Briefing Protocol

When the user says "brief me", "what's the latest", "what's going on", or asks for a world update, the goal is to answer one question first:

**How can the user leverage this information?**

The briefing is not a neutral recap. It is a leverage-first intelligence note built from cross-domain signals, historical pattern matching, and a concrete point of view.

## What the analyst must do

- detect regime shifts early
- connect hard data and weak signals
- distinguish what matters from noise
- form a coherent worldview
- map that worldview into positioning, hedging, and watchlists

The user wants signal, judgment, and utility.

## Step 1: Gather Inputs

Run the full Crucix sweep:

From the repository root:

```bash
node apis/briefing.mjs
```

The sweep writes JSON to stdout and progress logs to stderr.

Also gather:

- live market context via Alpaca MCP for broad indexes, rates proxies, commodities, metals, and crypto
- breaking developments from the last 6 hours via web search
- official statements, policy moves, or confirmed reports that materially change the read

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

Ask: what does this rhyme with?

Useful comparisons may include:

- early 2020 health-risk buildup
- 2007-2008 financial deterioration
- 2021-2022 inflation and commodity shock
- pre-invasion 2022 Europe escalation
- prior oil, metals, or volatility regimes

For each parallel:

- what matched
- what is different this time
- what happened next historically
- where the current setup sits in that sequence

### 6. Market and Asset Implications

Translate the worldview into consequences for:

- equities
- bonds and rates
- commodities
- gold and silver
- oil and gas
- crypto
- sectors, countries, or themes likely to outperform or underperform

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
