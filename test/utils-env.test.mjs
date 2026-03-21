// utils/env — unit tests
// Side-effect module: loads .env on import. Nothing is exported.
// Tests verify the module loads cleanly and leaves process.env intact.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('utils/env', () => {
  it('loads without throwing', async () => {
    await import('../apis/utils/env.mjs');
    assert.ok(true); // if we got here, it loaded cleanly
  });

  it('re-importing does not throw (idempotent / module cache)', async () => {
    await import('../apis/utils/env.mjs');
    await import('../apis/utils/env.mjs');
    assert.ok(true);
  });

  it('process.env is still an object with standard Node.js vars after import', async () => {
    await import('../apis/utils/env.mjs');
    assert.equal(typeof process.env, 'object');
    assert.ok(process.env !== null);
    // Node always populates PATH on every supported platform
    assert.ok('PATH' in process.env || 'Path' in process.env);
  });
});
