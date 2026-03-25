/**
 * sdk/aegis-adapter.mjs
 * Ethos Aegis integration layer for Crucix.
 * Uses the native Node.js AegisClient for robust subprocess/HTTP management.
 */

import { AegisClient } from './ethos-aegis/sdk/node/src/index.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const SIDECAR_URL = process.env.AEGIS_SIDECAR_URL || 'http://localhost:8080';
const BEARER_TOKEN = process.env.AEGIS_BEARER_TOKEN || 'local-dev-key';
const STRICT_MODE = process.env.AEGIS_STRICT_MODE === 'true';

// Initialize the real AegisClient
const aegis = new AegisClient({
  baseUrl: SIDECAR_URL,
  apiKey: BEARER_TOKEN,
  throwOnCondemned: false, // We handle the escalation manually in Crucix
  timeoutMs: parseInt(process.env.AEGIS_TIMEOUT_MS || '3000', 10)
});

// ─── Severity → Crucix tier mapping ──────────────────────────────────────────

/**
 * Maps an Aegis depth to a Crucix alert tier.
 * @param {string} depth 
 * @returns {'FLASH'|'PRIORITY'|'ROUTINE'|'PASS'}
 */
export function depthToTier(depth) {
  switch (depth?.toUpperCase()) {
    case 'CONDEMNED': return 'FLASH';
    case 'GRAVE':     return 'PRIORITY';
    case 'CAUTION':   return 'ROUTINE';
    case 'TRACE':     return 'ROUTINE';
    case 'VOID':
    default:          return 'PASS';
  }
}

// ─── Guard Functions ─────────────────────────────────────────────────────────

export async function guardInput(rawText, context = {}) {
  try {
    const verdict = await aegis.adjudicate(rawText, { guardPoint: 'input', ...context });
    return {
      sanctified: verdict.sanctified,
      payload: verdict.sanitized || rawText, // Fallback to raw if not sanitized
      verdict
    };
  } catch (err) {
    if (STRICT_MODE) throw new Error(`[Aegis] Strict mode active. Blocked due to sidecar failure: ${err.message}`);
    console.warn(`[Aegis] Warning: Sidecar unreachable. Failing open. (${err.message})`);
    return { sanctified: true, payload: rawText, verdict: _syntheticPass() };
  }
}

export async function guardOutput(llmResponse, context = {}) {
  try {
    const verdict = await aegis.adjudicate(llmResponse, { guardPoint: 'output', ...context });
    return {
      sanctified: verdict.sanctified,
      payload: verdict.sanitized || llmResponse,
      verdict
    };
  } catch (err) {
    if (STRICT_MODE) throw new Error(`[Aegis] Output guard failed: ${err.message}`);
    return { sanctified: true, payload: llmResponse, verdict: _syntheticPass() };
  }
}

export async function guardBotCommand(commandText, userId) {
  try {
    const verdict = await aegis.adjudicate(commandText, { guardPoint: 'bot_command', userId });
    return {
      sanctified: verdict.sanctified,
      payload: verdict.sanitized || commandText,
      verdict
    };
  } catch (err) {
    if (STRICT_MODE) throw new Error(`[Aegis] Bot command guard failed: ${err.message}`);
    return { sanctified: true, payload: commandText, verdict: _syntheticPass() };
  }
}

export async function evaluateSignal(signal) {
  if (!signal?.content) {
    return {
      signal,
      tier: null,
      blocked: false,
      verdict: _syntheticPass(),
    };
  }

  const { sanctified, payload, verdict } = await guardInput(signal.content, {
    source: signal.source,
    feedId: signal.id
  });

  const tier = depthToTier(verdict.depth);

  if (!sanctified && verdict.condemned) {
    console.error(`[Aegis] CONDEMNED Signal Blocked. RequestID: ${verdict.requestId}`);
    return {
      signal: { ...signal, content: '[CONTENT REDACTED BY AEGIS]' },
      tier: 'FLASH',
      blocked: true,
      verdict,
    };
  }

  return {
    signal: { ...signal, content: payload ?? signal.content },
    tier: tier === 'PASS' ? null : tier, 
    blocked: false,
    verdict,
  };
}

function _syntheticPass() {
  return {
    sanctified: true,
    condemned: false,
    depth: 'VOID',
    malignaCount: 0,
    sanitized: null,
    report: 'Synthetic pass (sidecar offline)',
    latencyMs: 0,
    requestId: `synth-${Date.now()}`
  };
}
