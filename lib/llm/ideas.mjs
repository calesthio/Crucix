// LLM-Powered Trade Ideas — generates actionable ideas from sweep data + delta context

/**
 * Generate LLM-enhanced trade ideas from sweep data.
 * @param {LLMProvider} provider - configured LLM provider
 * @param {object} sweepData - synthesized dashboard data
 * @param {object|null} delta - delta from last sweep
 * @param {Array} previousIdeas - ideas from previous runs (for dedup)
 * @returns {Promise<Array>} - array of idea objects
 */
export async function generateLLMIdeas(provider, sweepData, delta, previousIdeas = []) {
  if (!provider?.isConfigured) return null;

  let context;
  try {
    context = compactSweepForLLM(sweepData, delta, previousIdeas);
  } catch (err) {
    console.error('[LLM Ideas] Failed to compact sweep data:', err.message);
    return null;
  }

  const systemPrompt = `You are a quantitative analyst at a macro intelligence firm. You receive structured OSINT + economic data from 25 sources and produce 5-8 actionable trade ideas.

Rules:
- Each idea must cite specific data points from the input
- Include entry rationale, risk factors, and time horizon
- Blend geopolitical, economic, and market signals — cross-correlate across domains
- Be specific: name instruments (tickers, futures, ETFs), not vague sectors
- If delta shows significant changes, lead with those
- Do NOT repeat ideas from the "previous ideas" list unless conditions have materially changed
- Rate confidence: HIGH (multiple confirming signals), MEDIUM (thesis supported), LOW (speculative)

Output ONLY valid JSON array. Each object:
{
  "title": "Short title (max 10 words)",
  "type": "LONG|SHORT|HEDGE|WATCH|AVOID",
  "ticker": "Primary instrument",
  "confidence": "HIGH|MEDIUM|LOW",
  "rationale": "2-3 sentence explanation citing specific data",
  "risk": "Key risk factor",
  "horizon": "Intraday|Days|Weeks|Months",
  "signals": ["signal1", "signal2"]
}`;

  try {
    const result = await provider.complete(systemPrompt, context, { maxTokens: 1024, timeout: 180000 });
    const ideas = parseIdeasResponse(result.text);
    if (ideas && ideas.length > 0) {
      return ideas;
    }
    console.warn('[LLM Ideas] No valid ideas parsed from response');
    return null;
  } catch (err) {
    console.error('[LLM Ideas] Generation failed:', err.message);
    return null;
  }
}

/**
 * Compact sweep data to ~8KB for token efficiency.
 */
function compactSweepForLLM(data, delta, previousIdeas) {
  const sections = [];

  // Economic indicators
  if (data.fred?.length) {
    const key = data.fred.filter(f => ['VIXCLS', 'DFF', 'DGS10', 'DGS2', 'T10Y2Y', 'BAMLH0A0HYM2', 'DTWEXBGS', 'MORTGAGE30US'].includes(f.id));
    sections.push(`ECONOMIC: ${key.map(f => `${f.id}=${f.value}${f.momChange ? ` (${f.momChange > 0 ? '+' : ''}${f.momChange})` : ''}`).join(', ')}`);
  }

  // Energy
  if (data.energy) {
    sections.push(`ENERGY: WTI=$${data.energy.wti}, Brent=$${data.energy.brent}, NatGas=$${data.energy.natgas}, CrudeStocks=${data.energy.crudeStocks}bbl`);
  }

  // BLS
  if (data.bls?.length) {
    sections.push(`LABOR: ${data.bls.map(b => `${b.id}=${b.value}`).join(', ')}`);
  }

  // Treasury
  if (data.treasury) {
    sections.push(`TREASURY: totalDebt=$${data.treasury}T`);
  }

  // Supply chain
  if (data.gscpi) {
    sections.push(`SUPPLY_CHAIN: GSCPI=${data.gscpi.value} (${data.gscpi.interpretation})`);
  }

  // Geopolitical signals
  const urgentPosts = (data.tg?.urgent || []).slice(0, 5);
  if (urgentPosts.length) {
    sections.push(`URGENT_OSINT:\n${urgentPosts.map(p => `- ${(p.text || '').substring(0, 120)}`).join('\n')}`);
  }

  // Thermal / fire detections
  if (data.thermal?.length) {
    const hotRegions = data.thermal.filter(t => t.det > 10).map(t => `${t.region}: ${t.det} detections (${t.hc} high-conf)`);
    if (hotRegions.length) sections.push(`THERMAL: ${hotRegions.join(', ')}`);
  }

  // Air activity
  if (data.air?.length) {
    const airSum = data.air.map(a => `${a.region}: ${a.total} aircraft`);
    sections.push(`AIR_ACTIVITY: ${airSum.join(', ')}`);
  }

  // Nuclear
  if (data.nuke?.length) {
    const anomalies = data.nuke.filter(n => n.anom);
    if (anomalies.length) sections.push(`NUCLEAR_ANOMALY: ${anomalies.map(n => `${n.site}: ${n.cpm}cpm`).join(', ')}`);
  }

  // WHO alerts
  if (data.who?.length) {
    sections.push(`WHO_ALERTS: ${data.who.slice(0, 3).map(w => w.title).join('; ')}`);
  }

  // Defense spending
  if (data.defense?.length) {
    const topContracts = data.defense.slice(0, 3).map(d => `$${((d.amount || 0) / 1e6).toFixed(0)}M to ${d.recipient}`);
    sections.push(`DEFENSE_CONTRACTS: ${topContracts.join(', ')}`);
  }

  // Delta context
  if (delta?.summary) {
    sections.push(`\nDELTA_SINCE_LAST_SWEEP: direction=${delta.summary.direction}, changes=${delta.summary.totalChanges}, critical=${delta.summary.criticalChanges}`);
    if (delta.signals?.escalated?.length) {
      sections.push(`ESCALATED: ${delta.signals.escalated.map(s => `${s.label}: ${s.previous}→${s.current} (${(s.changePct||0) > 0 ? '+' : ''}${(s.changePct||0).toFixed(1)}%)`).join(', ')}`);
    }
    if (delta.signals?.new?.length) {
      sections.push(`NEW_SIGNALS: ${delta.signals.new.map(s => s.label || s.text?.substring(0, 60)).join('; ')}`);
    }
  }

  // Previous ideas (for dedup)
  if (previousIdeas.length) {
    sections.push(`\nPREVIOUS_IDEAS (avoid repeating):\n${previousIdeas.map(i => `- ${i.title} [${i.type}]`).join('\n')}`);
  }

  return sections.join('\n');
}

/**
 * Parse LLM response into ideas array. Handles markdown code blocks.
 */
function parseIdeasResponse(text) {
  if (!text) return null;

  // Strip markdown code block wrappers
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;

    // Validate each idea has required fields
    return parsed.filter(idea =>
      idea.title && idea.type && idea.confidence
    ).map(idea => ({
      title: idea.title,
      type: idea.type,
      ticker: idea.ticker || '',
      confidence: idea.confidence,
      rationale: idea.rationale || '',
      risk: idea.risk || '',
      horizon: idea.horizon || '',
      signals: idea.signals || [],
      source: 'llm',
    }));
  } catch {
    // Try to extract JSON array from mixed text
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const arr = JSON.parse(match[0]);
        return arr.filter(i => i.title && i.type).map(idea => ({
          ...idea,
          source: 'llm',
        }));
      } catch { /* give up */ }
    }
    return null;
  }
}
