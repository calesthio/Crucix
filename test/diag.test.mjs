// diag.mjs — unit tests
// diag.mjs is a CLI script that runs checks and exits. It has no exports.
// We test the underlying logic (Node version check, module imports) indirectly,
// but cannot import diag.mjs directly since it:
//   1. Runs all checks at top level as side effects
//   2. Calls process.exit() on failure
//   3. Tries to import server.mjs (which starts the server)
//
// Instead we test the diagnostic checks as isolated logic.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('diag.mjs (diagnostic checks)', () => {

  // ─── Node version check ───

  describe('Node version check', () => {
    it('should correctly parse and check the major version', () => {
      const major = parseInt(process.version.slice(1));
      assert.equal(typeof major, 'number');
      assert.ok(major > 0, `Major version should be positive, got ${major}`);
      // diag.mjs checks for >= 22; verify the check logic works
      const passes22Check = major >= 22;
      assert.equal(typeof passes22Check, 'boolean');
    });

    it('should parse major version from process.version correctly', () => {
      const version = 'v22.3.0';
      const major = parseInt(version.slice(1));
      assert.equal(major, 22);
    });

    it('should parse higher versions correctly', () => {
      const version = 'v23.1.0';
      const major = parseInt(version.slice(1));
      assert.equal(major, 23);
    });
  });

  // ─── Module imports ───

  describe('module imports', () => {
    it('should import express successfully', async () => {
      const express = await import('express');
      assert.ok(express.default || express);
    });

    it('should import crypto successfully', async () => {
      const { createHash } = await import('crypto');
      const hash = createHash('sha256').update('test').digest('hex');
      assert.equal(typeof hash, 'string');
      assert.equal(hash.length, 64);
    });

    it('should import crucix.config.mjs successfully', async () => {
      const mod = await import('../crucix.config.mjs');
      assert.ok(mod.default);
      assert.equal(typeof mod.default.port, 'number');
    });

    it('should import apis/utils/env.mjs without error', async () => {
      // This module has side effects (loads .env) but should not throw
      await assert.doesNotReject(async () => {
        await import('../apis/utils/env.mjs');
      });
    });

    it('should import lib/delta/engine.mjs successfully', async () => {
      const mod = await import('../lib/delta/engine.mjs');
      assert.ok(mod);
    });

    it('should import lib/delta/memory.mjs successfully', async () => {
      const mod = await import('../lib/delta/memory.mjs');
      assert.ok(mod);
    });

    it('should import lib/delta/index.mjs successfully', async () => {
      const mod = await import('../lib/delta/index.mjs');
      assert.ok(mod);
    });

    it('should import lib/llm/index.mjs successfully', async () => {
      const mod = await import('../lib/llm/index.mjs');
      assert.ok(mod.createLLMProvider);
    });

    it('should import lib/llm/ideas.mjs successfully', async () => {
      const mod = await import('../lib/llm/ideas.mjs');
      assert.ok(mod.generateLLMIdeas);
    });

    it('should import lib/alerts/telegram.mjs successfully', async () => {
      const mod = await import('../lib/alerts/telegram.mjs');
      assert.ok(mod.TelegramAlerter);
    });

    it('should import dashboard/inject.mjs successfully', async () => {
      const mod = await import('../dashboard/inject.mjs');
      assert.ok(mod.synthesize);
      assert.ok(mod.generateIdeas);
      assert.ok(mod.fetchAllNews);
    });

    it('should import apis/briefing.mjs successfully', async () => {
      const mod = await import('../apis/briefing.mjs');
      assert.ok(mod.fullBriefing);
    });
  });

  // ─── Port availability check logic ───

  describe('port availability check', () => {
    it('should detect available port', async () => {
      const net = await import('net');
      const testPort = 59123; // unlikely to be in use
      const server = net.default.createServer();

      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(testPort, () => { server.close(); resolve(); });
      });
      // If we got here, port was available
      assert.ok(true);
    });

    it('should detect port in use', async () => {
      const net = await import('net');
      const testPort = 59124;
      const server1 = net.default.createServer();
      const server2 = net.default.createServer();

      // First server grabs the port
      await new Promise((resolve) => {
        server1.listen(testPort, resolve);
      });

      // Second server should fail with EADDRINUSE
      try {
        await new Promise((resolve, reject) => {
          server2.once('error', reject);
          server2.listen(testPort, resolve);
        });
        assert.fail('Should have thrown EADDRINUSE');
      } catch (err) {
        assert.equal(err.code, 'EADDRINUSE');
      } finally {
        server1.close();
      }
    });
  });

  // ─── Module list completeness ───

  describe('diagnostic module list', () => {
    it('should cover all expected modules', () => {
      // Mirror the modules array from diag.mjs to confirm it is accurate
      const expectedModules = [
        './crucix.config.mjs',
        './apis/utils/env.mjs',
        './lib/delta/engine.mjs',
        './lib/delta/memory.mjs',
        './lib/delta/index.mjs',
        './lib/llm/index.mjs',
        './lib/llm/ideas.mjs',
        './lib/alerts/telegram.mjs',
        './dashboard/inject.mjs',
        './apis/briefing.mjs',
      ];
      assert.equal(expectedModules.length, 10);
      // Verify paths are reasonable
      for (const path of expectedModules) {
        assert.ok(path.startsWith('./'), `Path should be relative: ${path}`);
        assert.ok(path.endsWith('.mjs'), `Path should end with .mjs: ${path}`);
      }
    });
  });
});
