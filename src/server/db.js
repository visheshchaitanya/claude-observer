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
    parent_event_id INTEGER REFERENCES tool_events(id),
    display_name TEXT,
    ppid TEXT,
    status TEXT DEFAULT 'allowed'
  );

  CREATE INDEX IF NOT EXISTS idx_events_session ON tool_events(session_id);

  CREATE TABLE IF NOT EXISTS policy_rules (
    id INTEGER PRIMARY KEY,
    rule_type TEXT NOT NULL,
    pattern TEXT NOT NULL,
    tool_matcher TEXT DEFAULT '*',
    action TEXT DEFAULT 'deny',
    reason TEXT,
    priority INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sensitive_patterns (
    id INTEGER PRIMARY KEY,
    pattern TEXT NOT NULL,
    category TEXT,
    description TEXT,
    action TEXT DEFAULT 'ask',
    enabled INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS policy_decisions (
    id INTEGER PRIMARY KEY,
    event_id TEXT,
    session_id TEXT,
    rule_id INTEGER,
    tool_name TEXT,
    tool_input TEXT,
    matched_pattern TEXT,
    decision TEXT,
    reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_policy_decisions_session ON policy_decisions(session_id);
`;

export function createDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  // Migrate: add columns that may not exist in older DBs
  const cols = db.pragma('table_info(tool_events)').map(c => c.name);
  if (!cols.includes('display_name')) {
    db.exec('ALTER TABLE tool_events ADD COLUMN display_name TEXT');
  }
  if (!cols.includes('ppid')) {
    db.exec('ALTER TABLE tool_events ADD COLUMN ppid TEXT');
  }
  if (!cols.includes('status')) {
    db.exec("ALTER TABLE tool_events ADD COLUMN status TEXT DEFAULT 'allowed'");
  }
  migratePolicyTables(db);
  return db;
}

function migratePolicyTables(db) {
  const columnNames = (table) => db.pragma(`table_info(${table})`).map(c => c.name);

  if (columnNames('policy_rules').length) {
    const pr = columnNames('policy_rules');
    if (!pr.includes('tool_matcher')) {
      db.exec("ALTER TABLE policy_rules ADD COLUMN tool_matcher TEXT DEFAULT '*'");
    }
    if (!pr.includes('reason')) {
      db.exec('ALTER TABLE policy_rules ADD COLUMN reason TEXT');
    }
    if (!pr.includes('priority')) {
      db.exec('ALTER TABLE policy_rules ADD COLUMN priority INTEGER DEFAULT 0');
    }
    if (!pr.includes('enabled')) {
      db.exec('ALTER TABLE policy_rules ADD COLUMN enabled INTEGER DEFAULT 1');
    }
    if (!pr.includes('created_at')) {
      db.exec("ALTER TABLE policy_rules ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP");
    }
  }

  if (columnNames('sensitive_patterns').length) {
    const sp = columnNames('sensitive_patterns');
    if (!sp.includes('description')) {
      db.exec('ALTER TABLE sensitive_patterns ADD COLUMN description TEXT');
    }
    if (!sp.includes('action')) {
      db.exec("ALTER TABLE sensitive_patterns ADD COLUMN action TEXT DEFAULT 'ask'");
    }
    if (!sp.includes('enabled')) {
      db.exec('ALTER TABLE sensitive_patterns ADD COLUMN enabled INTEGER DEFAULT 1');
    }
  }

  if (columnNames('policy_decisions').length) {
    const pd = columnNames('policy_decisions');
    if (!pd.includes('matched_pattern')) {
      db.exec('ALTER TABLE policy_decisions ADD COLUMN matched_pattern TEXT');
    }
    if (!pd.includes('reason')) {
      db.exec('ALTER TABLE policy_decisions ADD COLUMN reason TEXT');
    }
    if (!pd.includes('created_at')) {
      db.exec("ALTER TABLE policy_decisions ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP");
    }
  }
}

export function upsertSession(db, sessionId) {
  db.prepare(`
    INSERT INTO sessions (id, started_at, total_calls)
    VALUES (?, ?, 0)
    ON CONFLICT(id) DO NOTHING
  `).run(sessionId, new Date().toISOString());
}

export function insertEvent(db, event) {
  const insertEventTx = db.transaction((ev) => {
    const result = db.prepare(`
      INSERT INTO tool_events (session_id, tool, phase, input, output, duration_ms, ts, parent_event_id, display_name, ppid, status)
      VALUES (@session_id, @tool, @phase, @input, @output, @duration_ms, @ts, @parent_event_id, @display_name, @ppid, @status)
    `).run({ ...ev, status: ev.status ?? 'allowed' });

    db.prepare(`
      UPDATE sessions
      SET total_calls = total_calls + CASE WHEN ? = 'pre' THEN 1 ELSE 0 END,
          last_event_at = ?
      WHERE id = ?
    `).run(ev.phase, ev.ts, ev.session_id);

    return result.lastInsertRowid;
  });

  return insertEventTx(event);
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

/**
 * Default tiered sensitive path/name patterns (regex source strings, POSIX-style paths).
 * @type {Array<{ pattern: string, category: string, description: string, action: 'deny'|'ask'|'warn'|'allow' }>}
 */
export const DEFAULT_SENSITIVE_PATTERNS = [
  { pattern: '\\.env', category: 'env', description: 'Environment variable files', action: 'ask' },
  { pattern: '\\.env\\..+', category: 'env', description: 'Environment variant files (.env.local, .env.prod)', action: 'ask' },
  { pattern: '\\.pem$', category: 'keys', description: 'PEM certificate/key files', action: 'deny' },
  { pattern: '\\.key$', category: 'keys', description: 'Private key files', action: 'deny' },
  { pattern: 'id_rsa', category: 'keys', description: 'SSH private keys', action: 'deny' },
  { pattern: 'id_ed25519', category: 'keys', description: 'SSH private keys', action: 'deny' },
  { pattern: 'credentials', category: 'credentials', description: 'Credential files', action: 'ask' },
  { pattern: 'secret', category: 'credentials', description: 'Secret files', action: 'ask' },
  { pattern: '\\.aws/', category: 'credentials', description: 'AWS configuration directory', action: 'deny' },
  { pattern: '\\.ssh/', category: 'keys', description: 'SSH directory', action: 'deny' },
  { pattern: 'token', category: 'credentials', description: 'Token files', action: 'ask' },
  { pattern: 'password', category: 'credentials', description: 'Password files', action: 'deny' },
  { pattern: '\\.npmrc', category: 'credentials', description: 'NPM config (may contain tokens)', action: 'ask' },
  { pattern: '\\.netrc', category: 'credentials', description: 'Netrc credentials', action: 'deny' },
  { pattern: '\\.pypirc', category: 'credentials', description: 'PyPI credentials', action: 'deny' },
];

/**
 * Insert {@link DEFAULT_SENSITIVE_PATTERNS} when `sensitive_patterns` is empty (first run).
 * @param {import('better-sqlite3').Database} db
 * @returns {{ inserted: number }}
 */
export function seedDefaultSensitivePatterns(db) {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM sensitive_patterns').get();
  if (c > 0) return { inserted: 0 };
  let inserted = 0;
  for (const row of DEFAULT_SENSITIVE_PATTERNS) {
    insertSensitivePattern(db, {
      pattern: row.pattern,
      category: row.category,
      description: row.description,
      action: row.action,
      enabled: 1,
    });
    inserted += 1;
  }
  return { inserted };
}

export function insertPolicyRule(db, rule) {
  const result = db
    .prepare(
      `
    INSERT INTO policy_rules (rule_type, pattern, tool_matcher, action, reason, priority, enabled)
    VALUES (@rule_type, @pattern, @tool_matcher, @action, @reason, @priority, @enabled)
  `
    )
    .run({
      rule_type: rule.rule_type,
      pattern: rule.pattern,
      tool_matcher: rule.tool_matcher ?? '*',
      action: rule.action ?? 'deny',
      reason: rule.reason ?? null,
      priority: rule.priority ?? 0,
      enabled: rule.enabled !== undefined ? rule.enabled : 1,
    });
  return Number(result.lastInsertRowid);
}

export function getPolicyRules(db) {
  return db
    .prepare('SELECT * FROM policy_rules ORDER BY priority DESC, id ASC')
    .all();
}

export function insertSensitivePattern(db, row) {
  const result = db
    .prepare(
      `
    INSERT INTO sensitive_patterns (pattern, category, description, action, enabled)
    VALUES (@pattern, @category, @description, @action, @enabled)
  `
    )
    .run({
      pattern: row.pattern,
      category: row.category ?? null,
      description: row.description ?? null,
      action: row.action ?? 'ask',
      enabled: row.enabled !== undefined ? row.enabled : 1,
    });
  return Number(result.lastInsertRowid);
}

export function getSensitivePatterns(db) {
  return db.prepare('SELECT * FROM sensitive_patterns ORDER BY id ASC').all();
}

export function insertPolicyDecision(db, row) {
  const result = db
    .prepare(
      `
    INSERT INTO policy_decisions (event_id, session_id, rule_id, tool_name, tool_input, matched_pattern, decision, reason)
    VALUES (@event_id, @session_id, @rule_id, @tool_name, @tool_input, @matched_pattern, @decision, @reason)
  `
    )
    .run({
      event_id: row.event_id ?? null,
      session_id: row.session_id ?? null,
      rule_id: row.rule_id ?? null,
      tool_name: row.tool_name ?? null,
      tool_input: row.tool_input ?? null,
      matched_pattern: row.matched_pattern ?? null,
      decision: row.decision,
      reason: row.reason ?? null,
    });
  return Number(result.lastInsertRowid);
}

export function getPolicyDecisions(db, sessionId = null) {
  if (sessionId != null) {
    return db
      .prepare(
        'SELECT * FROM policy_decisions WHERE session_id = ? ORDER BY id DESC'
      )
      .all(sessionId);
  }
  return db.prepare('SELECT * FROM policy_decisions ORDER BY id DESC').all();
}
