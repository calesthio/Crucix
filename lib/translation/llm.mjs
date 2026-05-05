// MiniMax LLM client for Crucix translation service
// Uses MiniMax-M2.7 via api.minimaxi.com

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load env vars if not already loaded
try { require('../../.env'); } catch {}

const API_KEY = process.env.LLM_API_KEY;
const API_BASE = 'https://api.minimaxi.com/v1';
const MODEL = 'MiniMax-M2.7';

if (!API_KEY) {
  console.warn('[MiniMax] LLM_API_KEY not set — translation will be disabled');
}

/**
 * Translate text from English to Chinese using MiniMax-M2.7
 * @param {string} text - English text to translate
 * @param {object} opts - Translation options
 * @returns {Promise<{zh: string, en: string, hint: string}>}
 */
export async function translate(text, opts = {}) {
  if (!API_KEY) {
    throw new Error('MiniMax API key not configured');
  }
  if (!text || text.trim().length === 0) {
    return { zh: '', en: text, hint: '' };
  }

  const { context = '', maxTokens = 200 } = opts;

  const systemPrompt = `You are a professional financial and geopolitical translator.
When translating, follow these rules:
1. Keep metric names in English but provide Chinese parenthetical: "CPI (消费者价格指数)"
2. Country names: prefer official Chinese names: "United States" → "美国", "Russia" → "俄罗斯"
3. Organization names: known Chinese names: "IMF" → "国际货币基金组织", "OPEC" → "欧佩克"
4. Market terms: "bear market" → "熊市", "bull market" → "牛市", "spread" → "利差"
5. Technical terms: translate with brief explanation in parentheses when first introduced
6. Event descriptions: translate faithfully, do not add opinions
7. Keep proper nouns (names, locations) in original form when no standard Chinese translation exists
8. Return ONLY valid JSON: {"zh": "...", "hint": "..."} with no markdown or extra text
9. zh field should be the full Chinese translation
10. hint field should be a very brief parenthetical in Chinese for the first appearance`;

  const userPrompt = context
    ? `Context: ${context}\n\nTranslate this to Chinese:\n${text}`
    : `Translate to Chinese:\n${text}`;

  try {
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`MiniMax API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = raw;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);
    return {
      zh: parsed.zh || '',
      en: text,
      hint: parsed.hint || '',
    };
  } catch (err) {
    console.error(`[MiniMax] Translation failed for "${text.substring(0, 50)}...":`, err.message);
    // Fallback: return original with empty translation
    return { zh: '', en: text, hint: '' };
  }
}

/**
 * Batch translate multiple texts efficiently
 * @param {string[]} texts - Array of English texts
 * @param {object} opts - Translation options
 * @returns {Promise<Array<{zh: string, en: string, hint: string}>>}
 */
export async function translateBatch(texts, opts = {}) {
  // Process in parallel with concurrency limit
  const CONCURRENCY = 5;
  const results = [];
  
  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const batch = texts.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(t => translate(t, opts))
    );
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Check if MiniMax API is accessible
 * @returns {Promise<boolean>}
 */
export async function healthCheck() {
  if (!API_KEY) return false;
  try {
    const resp = await fetch(`${API_BASE}/models`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    return resp.ok;
  } catch {
    return false;
  }
}