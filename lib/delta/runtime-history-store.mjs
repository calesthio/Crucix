import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function parseJson(value, fallback = null) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class RuntimeHistoryStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS runtime_runs (
        run_timestamp TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        compact_json TEXT NOT NULL,
        delta_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_runs_created_at ON runtime_runs(created_at DESC);
      CREATE TABLE IF NOT EXISTS runtime_signal_state (
        signal_key TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL,
        state_json TEXT NOT NULL
      );
    `);
    this.insertRunStmt = this.db.prepare(`
      INSERT INTO runtime_runs (run_timestamp, created_at, compact_json, delta_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(run_timestamp) DO UPDATE SET
        created_at=excluded.created_at,
        compact_json=excluded.compact_json,
        delta_json=excluded.delta_json
    `);
    this.listRunsStmt = this.db.prepare(`
      SELECT run_timestamp, created_at, compact_json, delta_json
      FROM runtime_runs
      ORDER BY datetime(run_timestamp) DESC, datetime(created_at) DESC
      LIMIT ?
    `);
    this.allRunsStmt = this.db.prepare(`
      SELECT run_timestamp, created_at, compact_json, delta_json
      FROM runtime_runs
      ORDER BY datetime(run_timestamp) DESC, datetime(created_at) DESC
    `);
    this.getSignalStateStmt = this.db.prepare(`SELECT state_json FROM runtime_signal_state WHERE signal_key = ?`);
    this.setSignalStateStmt = this.db.prepare(`
      INSERT INTO runtime_signal_state (signal_key, updated_at, state_json)
      VALUES (?, ?, ?)
      ON CONFLICT(signal_key) DO UPDATE SET
        updated_at=excluded.updated_at,
        state_json=excluded.state_json
    `);
    this.deleteSignalStateStmt = this.db.prepare(`DELETE FROM runtime_signal_state WHERE signal_key = ?`);
  }

  hasPersistedRuns() {
    const row = this.db.prepare('SELECT 1 AS present FROM runtime_runs LIMIT 1').get();
    return Boolean(row?.present);
  }

  upsertRun({ timestamp, compact, delta }) {
    const ts = String(timestamp || '').trim() || new Date().toISOString();
    const createdAt = new Date().toISOString();
    this.insertRunStmt.run(ts, createdAt, JSON.stringify(compact || {}), JSON.stringify(delta || {}));
  }

  listRuns(limit = 1000) {
    const rows = this.listRunsStmt.all(Math.max(1, Number(limit) || 1));
    return rows.map(row => ({
      timestamp: row.run_timestamp,
      createdAt: row.created_at,
      data: clone(parseJson(row.compact_json, {})),
      delta: clone(parseJson(row.delta_json, {})),
    }));
  }

  getAllRuns() {
    const rows = this.allRunsStmt.all();
    return rows.map(row => ({
      timestamp: row.run_timestamp,
      createdAt: row.created_at,
      data: clone(parseJson(row.compact_json, {})),
      delta: clone(parseJson(row.delta_json, {})),
    }));
  }

  getSignalState(signalKey) {
    const row = this.getSignalStateStmt.get(String(signalKey || ''));
    return clone(parseJson(row?.state_json, null));
  }

  setSignalState(signalKey, state) {
    const key = String(signalKey || '').trim();
    if (!key) return;
    if (state == null) {
      this.deleteSignalStateStmt.run(key);
      return;
    }
    this.setSignalStateStmt.run(key, new Date().toISOString(), JSON.stringify(state));
  }

  close() {
    this.db?.close();
  }

  getDiagnostics({ sampleLimit = 3 } = {}) {
    const boundedSampleLimit = Math.max(0, Math.min(Number(sampleLimit) || 0, 10));
    const databaseSizeBytes = existsSync(this.dbPath) ? statSync(this.dbPath).size : 0;
    const walPath = `${this.dbPath}-wal`;
    const shmPath = `${this.dbPath}-shm`;
    const pageInfo = this.db.prepare('SELECT page_count AS pageCount, page_size AS pageSize FROM pragma_page_count(), pragma_page_size()').get() || {};
    const runtimeRunsStats = this.db.prepare(`
      SELECT COUNT(*) AS rowCount,
             MIN(created_at) AS firstWriteAt,
             MAX(created_at) AS lastWriteAt,
             MIN(run_timestamp) AS oldestRunTimestamp,
             MAX(run_timestamp) AS newestRunTimestamp
      FROM runtime_runs
    `).get() || {};
    const signalStateStats = this.db.prepare(`
      SELECT COUNT(*) AS rowCount,
             MIN(updated_at) AS firstWriteAt,
             MAX(updated_at) AS lastWriteAt
      FROM runtime_signal_state
    `).get() || {};
    const integrityRow = this.db.prepare('PRAGMA quick_check(1)').get() || {};
    const sampleRuns = boundedSampleLimit > 0
      ? this.db.prepare(`
          SELECT run_timestamp, created_at
          FROM runtime_runs
          ORDER BY datetime(run_timestamp) DESC, datetime(created_at) DESC
          LIMIT ?
        `).all(boundedSampleLimit)
      : [];
    const sampleSignalStates = boundedSampleLimit > 0
      ? this.db.prepare(`
          SELECT signal_key, updated_at
          FROM runtime_signal_state
          ORDER BY datetime(updated_at) DESC, signal_key ASC
          LIMIT ?
        `).all(boundedSampleLimit)
      : [];

    return {
      version: 'runtime-history-diagnostics-v1',
      path: this.dbPath,
      storage: {
        databaseSizeBytes,
        walSizeBytes: existsSync(walPath) ? statSync(walPath).size : 0,
        shmSizeBytes: existsSync(shmPath) ? statSync(shmPath).size : 0,
        estimatedAllocatedBytes: (Number(pageInfo.pageCount) || 0) * (Number(pageInfo.pageSize) || 0),
        pageCount: Number(pageInfo.pageCount) || 0,
        pageSize: Number(pageInfo.pageSize) || 0,
      },
      integrity: {
        mode: 'quick_check(1)',
        ok: String(integrityRow.quick_check || '').toLowerCase() === 'ok',
        result: integrityRow.quick_check || null,
      },
      tables: {
        runtimeRuns: {
          rowCount: Number(runtimeRunsStats.rowCount) || 0,
          firstWriteAt: runtimeRunsStats.firstWriteAt || null,
          lastWriteAt: runtimeRunsStats.lastWriteAt || null,
          oldestRunTimestamp: runtimeRunsStats.oldestRunTimestamp || null,
          newestRunTimestamp: runtimeRunsStats.newestRunTimestamp || null,
          sample: sampleRuns.map(row => ({
            runTimestamp: row.run_timestamp,
            createdAt: row.created_at,
          })),
        },
        runtimeSignalState: {
          rowCount: Number(signalStateStats.rowCount) || 0,
          firstWriteAt: signalStateStats.firstWriteAt || null,
          lastWriteAt: signalStateStats.lastWriteAt || null,
          sample: sampleSignalStates.map(row => ({
            signalKey: row.signal_key,
            updatedAt: row.updated_at,
          })),
        },
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
