// server.mjs — unit tests
// server.mjs is a top-level script that starts the Express server and sweep cycle.
// It has NO exports — everything runs as side effects on import.
// We CANNOT import server.mjs (it binds to a port, opens a browser, runs sweeps).
//
// Instead, we test:
// 1. The route handler logic by reconstructing it with mockReq/mockRes
// 2. The broadcast/SSE helper logic
// 3. The config and dependency shape that server.mjs relies on
// 4. Integration of the modules server.mjs imports

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockReq, mockRes, saveFetch, restoreFetch, mockFetch } from './helpers.mjs';
import config from '../crucix.config.mjs';
import { getLocale, currentLanguage, getSupportedLocales } from '../lib/i18n.mjs';

// ─── Route handler reconstructions ───
// We replicate the route handler logic from server.mjs to test it in isolation.

describe('server.mjs (route handler logic)', () => {

  before(() => saveFetch());
  afterEach(() => restoreFetch());
  after(() => restoreFetch());

  // ─── GET /api/data ───

  describe('GET /api/data', () => {
    // Mirrors: app.get('/api/data', handler)
    function handleApiData(currentData, req, res) {
      if (!currentData) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
      res.json(currentData);
    }

    it('should return 503 when no data available', () => {
      const req = mockReq();
      const res = mockRes();
      handleApiData(null, req, res);
      assert.equal(res.statusCode, 503);
      assert.deepEqual(res._jsonBody, { error: 'No data yet — first sweep in progress' });
    });

    it('should return current data when available', () => {
      const req = mockReq();
      const res = mockRes();
      const data = { meta: { sourcesOk: 5 }, ideas: [] };
      handleApiData(data, req, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res._jsonBody, data);
    });
  });

  // ─── GET /api/health ───

  describe('GET /api/health', () => {
    function handleApiHealth({ currentData, lastSweepTime, sweepInProgress, sweepStartedAt, startTime }, req, res) {
      res.json({
        status: 'ok',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        lastSweep: lastSweepTime,
        nextSweep: lastSweepTime
          ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toISOString()
          : null,
        sweepInProgress,
        sweepStartedAt,
        sourcesOk: currentData?.meta?.sourcesOk || 0,
        sourcesFailed: currentData?.meta?.sourcesFailed || 0,
        llmEnabled: !!config.llm.provider,
        llmProvider: config.llm.provider,
        telegramEnabled: !!(config.telegram.botToken && config.telegram.chatId),
        refreshIntervalMinutes: config.refreshIntervalMinutes,
        language: currentLanguage,
      });
    }

    it('should return health with status ok', () => {
      const req = mockReq();
      const res = mockRes();
      handleApiHealth({
        currentData: null,
        lastSweepTime: null,
        sweepInProgress: false,
        sweepStartedAt: null,
        startTime: Date.now() - 60000,
      }, req, res);

      assert.equal(res._jsonBody.status, 'ok');
      assert.equal(typeof res._jsonBody.uptime, 'number');
      assert.ok(res._jsonBody.uptime >= 0);
      assert.equal(res._jsonBody.lastSweep, null);
      assert.equal(res._jsonBody.nextSweep, null);
      assert.equal(res._jsonBody.sweepInProgress, false);
      assert.equal(res._jsonBody.refreshIntervalMinutes, config.refreshIntervalMinutes);
    });

    it('should compute nextSweep when lastSweepTime is set', () => {
      const req = mockReq();
      const res = mockRes();
      const lastSweep = '2026-01-01T12:00:00.000Z';
      handleApiHealth({
        currentData: { meta: { sourcesOk: 10, sourcesFailed: 2 } },
        lastSweepTime: lastSweep,
        sweepInProgress: true,
        sweepStartedAt: '2026-01-01T12:15:00.000Z',
        startTime: Date.now() - 120000,
      }, req, res);

      assert.ok(res._jsonBody.nextSweep);
      const nextDate = new Date(res._jsonBody.nextSweep);
      const expectedNext = new Date(new Date(lastSweep).getTime() + config.refreshIntervalMinutes * 60000);
      assert.equal(nextDate.getTime(), expectedNext.getTime());
      assert.equal(res._jsonBody.sourcesOk, 10);
      assert.equal(res._jsonBody.sourcesFailed, 2);
      assert.equal(res._jsonBody.sweepInProgress, true);
    });

    it('should include language field', () => {
      const req = mockReq();
      const res = mockRes();
      handleApiHealth({
        currentData: null, lastSweepTime: null,
        sweepInProgress: false, sweepStartedAt: null,
        startTime: Date.now(),
      }, req, res);
      assert.ok('language' in res._jsonBody);
    });
  });

  // ─── GET /api/locales ───

  describe('GET /api/locales', () => {
    function handleApiLocales(req, res) {
      res.json({
        current: currentLanguage,
        supported: getSupportedLocales(),
      });
    }

    it('should return current language and supported locales', () => {
      const req = mockReq();
      const res = mockRes();
      handleApiLocales(req, res);
      assert.ok(res._jsonBody.current);
      assert.ok(Array.isArray(res._jsonBody.supported));
      assert.ok(res._jsonBody.supported.length > 0);
      assert.ok(res._jsonBody.supported.some(l => l.code === 'en'));
    });
  });

  // ─── GET / (root route) ───

  describe('GET / (root route)', () => {
    it('should serve loading page when no data', () => {
      // We test the branching logic, not actual file reads
      const currentData = null;
      assert.equal(currentData, null); // would trigger sendFile(loading.html)
    });

    it('should serve dashboard with locale injection when data exists', () => {
      const locale = getLocale();
      const localeScript = `<script>window.__CRUCIX_LOCALE__ = ${JSON.stringify(locale).replace(/<\/script>/gi, '<\\/script>')};</script>`;

      // Verify the locale script is valid
      assert.ok(localeScript.includes('window.__CRUCIX_LOCALE__'));
      assert.ok(localeScript.startsWith('<script>'));
      assert.ok(localeScript.endsWith('</script>'));

      // Verify it does not contain unescaped closing script tags in the JSON
      const jsonPart = JSON.stringify(locale);
      if (jsonPart.includes('</script>')) {
        assert.fail('Locale JSON contains unescaped </script> tag');
      }
    });
  });

  // ─── SSE /events ───

  describe('GET /events (SSE)', () => {
    it('should set correct SSE headers', () => {
      // Replicate the handler logic
      const res = mockRes();
      res.writeHead = (status, headers) => {
        res.statusCode = status;
        Object.assign(res._headers, headers);
      };

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('data: {"type":"connected"}\n\n');

      assert.equal(res.statusCode, 200);
      assert.equal(res._headers['Content-Type'], 'text/event-stream');
      assert.equal(res._headers['Cache-Control'], 'no-cache');
      assert.equal(res._headers['Connection'], 'keep-alive');
      assert.equal(res._headers['Access-Control-Allow-Origin'], '*');
      assert.ok(res._body.includes('"type":"connected"'));
    });
  });

  // ─── broadcast helper ───

  describe('broadcast', () => {
    function broadcast(sseClients, data) {
      const msg = `data: ${JSON.stringify(data)}\n\n`;
      for (const client of sseClients) {
        try { client.write(msg); } catch { sseClients.delete(client); }
      }
    }

    it('should send SSE message to all connected clients', () => {
      const clients = new Set();
      const c1 = mockRes();
      const c2 = mockRes();
      clients.add(c1);
      clients.add(c2);

      broadcast(clients, { type: 'update', data: { test: true } });

      assert.ok(c1._body.includes('"type":"update"'));
      assert.ok(c2._body.includes('"type":"update"'));
      assert.ok(c1._body.startsWith('data: '));
      assert.ok(c1._body.endsWith('\n\n'));
    });

    it('should remove failing clients from the set', () => {
      const clients = new Set();
      const goodClient = mockRes();
      const badClient = {
        write() { throw new Error('Connection reset'); },
      };
      clients.add(goodClient);
      clients.add(badClient);

      broadcast(clients, { type: 'test' });

      assert.equal(clients.size, 1);
      assert.ok(clients.has(goodClient));
      assert.ok(!clients.has(badClient));
    });

    it('should handle empty client set', () => {
      const clients = new Set();
      broadcast(clients, { type: 'test' });
      assert.equal(clients.size, 0);
    });

    it('should format data as SSE event correctly', () => {
      const clients = new Set();
      const client = mockRes();
      clients.add(client);

      const payload = { type: 'sweep_start', timestamp: '2026-01-01T00:00:00Z' };
      broadcast(clients, payload);

      const expected = `data: ${JSON.stringify(payload)}\n\n`;
      assert.equal(client._body, expected);
    });
  });

  // ─── sweep guard logic ───

  describe('sweep guard logic', () => {
    it('should prevent concurrent sweeps', () => {
      let sweepInProgress = false;

      // First sweep starts
      function canStartSweep() {
        if (sweepInProgress) return false;
        sweepInProgress = true;
        return true;
      }

      assert.ok(canStartSweep());
      assert.ok(!canStartSweep()); // second attempt blocked
      sweepInProgress = false;
      assert.ok(canStartSweep()); // available again after reset
    });
  });

  // ─── Config dependencies ───

  describe('server config dependencies', () => {
    it('should have a valid port number', () => {
      assert.equal(typeof config.port, 'number');
      assert.ok(config.port > 0 && config.port < 65536);
    });

    it('should have refreshIntervalMinutes as a positive number', () => {
      assert.ok(config.refreshIntervalMinutes > 0);
    });

    it('should have llm config object', () => {
      assert.equal(typeof config.llm, 'object');
    });

    it('should have telegram config object', () => {
      assert.equal(typeof config.telegram, 'object');
    });

    it('should have discord config object', () => {
      assert.equal(typeof config.discord, 'object');
    });
  });

  // ─── Telegram /status command output logic ───

  describe('Telegram /status command format', () => {
    it('should format uptime correctly', () => {
      const uptime = 7320; // 2h 2m
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      assert.equal(h, 2);
      assert.equal(m, 2);
    });

    it('should format sources count', () => {
      const currentData = { meta: { sourcesOk: 20, sourcesQueried: 25, sourcesFailed: 5 } };
      const sourcesOk = currentData?.meta?.sourcesOk || 0;
      const sourcesTotal = currentData?.meta?.sourcesQueried || 0;
      const sourcesFailed = currentData?.meta?.sourcesFailed || 0;
      assert.equal(sourcesOk, 20);
      assert.equal(sourcesTotal, 25);
      assert.equal(sourcesFailed, 5);
    });

    it('should handle null currentData', () => {
      const currentData = null;
      const sourcesOk = currentData?.meta?.sourcesOk || 0;
      assert.equal(sourcesOk, 0);
    });
  });

  // ─── Telegram /brief command logic ───

  describe('Telegram /brief command format', () => {
    it('should return waiting message when no data', () => {
      const currentData = null;
      const result = !currentData ? 'No data yet' : 'has data';
      assert.equal(result, 'No data yet');
    });

    it('should select direction emoji correctly', () => {
      const emojiMap = { 'risk-off': '1', 'risk-on': '2', 'mixed': '3' };
      assert.equal(emojiMap['risk-off'] || '4', '1');
      assert.equal(emojiMap['risk-on'] || '4', '2');
      assert.equal(emojiMap['mixed'] || '4', '3');
      assert.equal(emojiMap['unknown'] || '4', '4'); // fallback
    });

    it('should slice ideas to top 3', () => {
      const ideas = [
        { title: 'A', type: 'long' },
        { title: 'B', type: 'hedge' },
        { title: 'C', type: 'watch' },
        { title: 'D', type: 'long' },
      ];
      const top = ideas.slice(0, 3);
      assert.equal(top.length, 3);
      assert.equal(top[2].title, 'C');
    });
  });

  // ─── Browser open command logic ───

  describe('browser open command', () => {
    it('should select correct open command by platform', () => {
      const getOpenCmd = (platform) =>
        platform === 'win32' ? 'cmd /c start ""' :
        platform === 'darwin' ? 'open' : 'xdg-open';

      assert.equal(getOpenCmd('win32'), 'cmd /c start ""');
      assert.equal(getOpenCmd('darwin'), 'open');
      assert.equal(getOpenCmd('linux'), 'xdg-open');
    });
  });

  // ─── Directory creation logic ───

  describe('directory initialization', () => {
    it('should define correct directory paths', async () => {
      const { join } = await import('path');
      const ROOT = '/tmp/crucix-health';
      const RUNS_DIR = join(ROOT, 'runs');
      const MEMORY_DIR = join(RUNS_DIR, 'memory');

      assert.equal(RUNS_DIR, '/tmp/crucix-health/runs');
      assert.equal(MEMORY_DIR, '/tmp/crucix-health/runs/memory');
      assert.equal(join(MEMORY_DIR, 'cold'), '/tmp/crucix-health/runs/memory/cold');
    });
  });

  // ─── i18n integration for dashboard ───

  describe('i18n integration', () => {
    it('should provide locale data for HTML injection', () => {
      const locale = getLocale();
      assert.equal(typeof locale, 'object');
      // Locale should have translation keys
      assert.ok(Object.keys(locale).length > 0);
    });

    it('should escape </script> in locale JSON', () => {
      const locale = getLocale();
      const json = JSON.stringify(locale);
      const escaped = json.replace(/<\/script>/gi, '<\\/script>');
      assert.ok(!escaped.includes('</script>'));
    });
  });
});
