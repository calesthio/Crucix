// Shared fetch utility with timeout, retries, exponential backoff, and HTTP 429 handling

// HTTP status codes that are safe to retry
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

// Maximum total backoff across all retries (30s)
const MAX_BACKOFF_MS = 30_000;

// Base delay for exponential backoff (100ms)
const BASE_DELAY_MS = 100;

// Cap on how long we'll wait for a Retry-After header (60s)
const MAX_RETRY_AFTER_SEC = 60;

function isRetryable(status) {
  return RETRYABLE_STATUSES.has(status);
}

function parseRetryAfter(res) {
  const header = res.headers?.get('Retry-After');
  if (!header) return null;
  const seconds = parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds, MAX_RETRY_AFTER_SEC);
  }
  // Retry-After can also be an HTTP-date, but that's rare in practice.
  // Fall through to exponential backoff if we can't parse it.
  return null;
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch a URL with timeout, retries, exponential backoff, and HTTP 429 awareness.
 *
 * @param {string} url          - The URL to fetch
 * @param {object} [opts]       - Options
 * @param {number} [opts.timeout=15000]  - Per-request timeout in ms
 * @param {number} [opts.retries=1]      - Number of retry attempts (0 = try once, no retry)
 * @param {object} [opts.headers={}]     - Extra request headers
 * @param {string} [opts.method='GET']   - HTTP method
 * @param {*}      [opts.body]           - Request body (for POST/PUT)
 * @returns {Promise<object>} Parsed JSON, or `{ error, source }` on failure
 */
export async function safeFetch(url, opts = {}) {
  const { timeout = 15000, retries = 1, headers = {}, method = 'GET', body } = opts;
  let lastError;
  let totalBackoff = 0;

  for (let i = 0; i <= retries; i++) {
    const isLastAttempt = i === retries;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const fetchOpts = {
        signal: controller.signal,
        method,
        headers: { 'User-Agent': 'Crucix/1.0', ...headers },
      };
      if (body && method !== 'GET') {
        fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const res = await fetch(url, fetchOpts);
      clearTimeout(timer);

      if (res.ok) {
        const text = await res.text();
        try { return JSON.parse(text); } catch { return { rawText: text.slice(0, 500) }; }
      }

      // Non-retryable client error — bail immediately
      if (!isRetryable(res.status)) {
        const errBody = await res.text().catch(() => '');
        return { error: `HTTP ${res.status}: ${errBody.slice(0, 200)}`, source: url };
      }

      // Retryable — check Retry-After header
      const retryAfter = parseRetryAfter(res);
      if (retryAfter !== null && !isLastAttempt) {
        const waitMs = Math.min(retryAfter * 1000, MAX_BACKOFF_MS - totalBackoff);
        if (waitMs > 0) {
          totalBackoff += waitMs;
          await delay(waitMs);
          continue;
        }
      }

      throw new Error(`HTTP ${res.status}`);

    } catch (e) {
      clearTimeout(timer);

      if (e.name === 'AbortError') {
        lastError = new Error(`Request timed out after ${timeout}ms`);
      } else {
        lastError = e;
      }

      if (!isLastAttempt) {
        // Exponential backoff with jitter: base * 2^i + random(0, 1000)
        const baseBackoff = Math.min(BASE_DELAY_MS * Math.pow(2, i), MAX_BACKOFF_MS);
        const jitter = Math.round(Math.random() * 1000);
        const waitMs = Math.min(baseBackoff + jitter, MAX_BACKOFF_MS - totalBackoff);

        if (waitMs > 0) {
          totalBackoff += waitMs;
          await delay(waitMs);
        }
      }
    }
  }

  return { error: lastError?.message || 'Unknown error', source: url };
}

export function ago(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

export function today() {
  return new Date().toISOString().split('T')[0];
}

export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
