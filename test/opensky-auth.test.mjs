// OpenSky source — OAuth2 client-credentials tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies, no network

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const MODULE_URL = new URL('../apis/sources/opensky.mjs', import.meta.url);
const realFetch = globalThis.fetch;
let loadCount = 0;
let calls;
let tokenStatus;
let rejectToken;

// Fresh module instance per test so the token cache starts empty
async function loadOpenSky() {
  return import(`${MODULE_URL.href}?t=${loadCount++}`);
}

function installFakeFetch() {
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.includes('openid-connect/token')) {
      calls.token++;
      calls.tokenBodies.push(String(init.body));
      if (tokenStatus !== 200) return new Response('invalid_client', { status: tokenStatus });
      return new Response(JSON.stringify({ access_token: `tok${calls.token}`, expires_in: 1800 }), { status: 200 });
    }
    const auth = init.headers?.Authorization ?? null;
    calls.api.push(auth);
    if (rejectToken && auth === `Bearer ${rejectToken}`) return new Response('expired', { status: 401 });
    return new Response(JSON.stringify({ states: [['abc123', 'TEST1 ', 'United Kingdom', 0, 0, 0, 0, 13000]] }), { status: 200 });
  };
}

describe('OpenSky authentication', () => {
  beforeEach(() => {
    calls = { token: 0, tokenBodies: [], api: [] };
    tokenStatus = 200;
    rejectToken = null;
    delete process.env.OPENSKY_CLIENT_ID;
    delete process.env.OPENSKY_CLIENT_SECRET;
    installFakeFetch();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.OPENSKY_CLIENT_ID;
    delete process.env.OPENSKY_CLIENT_SECRET;
  });

  it('stays anonymous when no credentials are set', async () => {
    const { briefing } = await loadOpenSky();
    const result = await briefing();
    assert.equal(result.authMode, 'anonymous');
    assert.equal(calls.token, 0);
    assert.ok(calls.api.length > 0);
    assert.ok(calls.api.every(a => a === null));
    assert.equal(result.error, undefined);
  });

  it('fetches one token and shares it across all hotspot requests', async () => {
    process.env.OPENSKY_CLIENT_ID = 'test-client';
    process.env.OPENSKY_CLIENT_SECRET = 'test-secret';
    const { briefing } = await loadOpenSky();
    const result = await briefing();
    assert.equal(result.authMode, 'oauth2');
    assert.equal(calls.token, 1);
    assert.match(calls.tokenBodies[0], /grant_type=client_credentials/);
    assert.match(calls.tokenBodies[0], /client_id=test-client/);
    assert.ok(calls.api.every(a => a === 'Bearer tok1'));
  });

  it('reuses the cached token on the next sweep', async () => {
    process.env.OPENSKY_CLIENT_ID = 'test-client';
    process.env.OPENSKY_CLIENT_SECRET = 'test-secret';
    const { briefing } = await loadOpenSky();
    await briefing();
    await briefing();
    assert.equal(calls.token, 1);
  });

  it('falls back to anonymous and reports authError when credentials are rejected', async () => {
    process.env.OPENSKY_CLIENT_ID = 'test-client';
    process.env.OPENSKY_CLIENT_SECRET = 'wrong';
    tokenStatus = 401;
    const { briefing } = await loadOpenSky();
    const result = await briefing();
    assert.equal(result.authMode, 'anonymous');
    assert.match(result.authError, /HTTP 401/);
    assert.ok(calls.api.every(a => a === null));
    assert.equal(result.error, undefined);
  });

  it('refreshes a stale token once and retries when the API returns 401', async () => {
    process.env.OPENSKY_CLIENT_ID = 'test-client';
    process.env.OPENSKY_CLIENT_SECRET = 'test-secret';
    rejectToken = 'tok1';
    const { briefing } = await loadOpenSky();
    const result = await briefing();
    assert.equal(result.error, undefined);
    assert.equal(calls.token, 2, 'parallel 401s should trigger a single refresh');
    assert.ok(calls.api.includes('Bearer tok2'));
  });
});
