import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    last_event_at TEXT,
    total_calls INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tool_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    tool TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('pre', 'post')),
    input TEXT,
    output TEXT,
    duration_ms INTEGER,
    ts TEXT NOT NULL,
    parent_event_id INTEGER REFERENCES tool_events(id)
  );

  CREATE INDEX IF NOT EXISTS idx_events_session ON tool_events(session_id);
`;

export function createDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  return db;
}

export function upsertSession(db, sessionId) {
  db.prepare(`
    INSERT INTO sessions (id, started_at, total_calls)
    VALUES (?, ?, 0)
    ON CONFLICT(id) DO NOTHING
  `).run(sessionId, new Date().toISOString());
}

export function insertEvent(db, event) {
  const result = db.prepare(`
    INSERT INTO tool_events (session_id, tool, phase, input, output, duration_ms, ts, parent_event_id)
    VALUES (@session_id, @tool, @phase, @input, @output, @duration_ms, @ts, @parent_event_id)
  `).run(event);

  db.prepare(`
    UPDATE sessions
    SET total_calls = total_calls + CASE WHEN ? = 'pre' THEN 1 ELSE 0 END,
        last_event_at = ?
    WHERE id = ?
  `).run(event.phase, event.ts, event.session_id);

  return result.lastInsertRowid;
}

export function getSession(db, sessionId) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
}

export function getAllSessions(db) {
  return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all();
}

export function getEventsBySession(db, sessionId) {
  return db.prepare(
    'SELECT * FROM tool_events WHERE session_id = ? ORDER BY id ASC'
  ).all(sessionId);
}

export function getDbPath() {
  const home = process.env.HOME || process.env.USERPROFILE;
  return `${home}/.claude-observer/sessions.db`;
}
