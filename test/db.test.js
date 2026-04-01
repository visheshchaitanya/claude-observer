import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDb,
  upsertSession,
  insertEvent,
  getSession,
  getAllSessions,
  getEventsBySession,
  insertPolicyRule,
  getPolicyRules,
  insertSensitivePattern,
  getSensitivePatterns,
  insertPolicyDecision,
  getPolicyDecisions,
} from '../src/server/db.js';

const TEST_DIR = join(tmpdir(), 'claude-observer-test-' + Date.now());

describe('db', () => {
  let db;

  before(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = createDb(join(TEST_DIR, 'test.db'));
  });

  after(() => {
    db.close();
    rmSync(TEST_DIR, { recursive: true });
  });

  it('upsertSession creates a new session', () => {
    upsertSession(db, 'sess-1');
    const row = getSession(db, 'sess-1');
    assert.equal(row.id, 'sess-1');
    assert.ok(row.started_at);
    assert.equal(row.total_calls, 0);
  });

  it('upsertSession is idempotent', () => {
    upsertSession(db, 'sess-1');
    upsertSession(db, 'sess-1');
    const all = getAllSessions(db);
    assert.equal(all.filter(s => s.id === 'sess-1').length, 1);
  });

  it('insertEvent stores a pre event and increments total_calls', () => {
    const event = {
      session_id: 'sess-1',
      tool: 'Bash',
      phase: 'pre',
      input: JSON.stringify({ command: 'ls' }),
      output: null,
      duration_ms: null,
      ts: new Date().toISOString(),
      parent_event_id: null,
      display_name: 'TOOL:Bash',
      ppid: null,
    };
    const id = insertEvent(db, event);
    assert.ok(id > 0);
    const rows = getEventsBySession(db, 'sess-1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tool, 'Bash');
    assert.equal(rows[0].phase, 'pre');
    assert.equal(rows[0].display_name, 'TOOL:Bash');
    const sess = getSession(db, 'sess-1');
    assert.equal(sess.total_calls, 1);
  });

  it('insertEvent stores a post event with duration', () => {
    const event = {
      session_id: 'sess-1',
      tool: 'Bash',
      phase: 'post',
      input: null,
      output: JSON.stringify({ output: 'file.txt\n' }),
      duration_ms: 42,
      ts: new Date().toISOString(),
      parent_event_id: null,
      display_name: 'TOOL:Bash',
      ppid: null,
    };
    insertEvent(db, event);
    const rows = getEventsBySession(db, 'sess-1');
    const post = rows.find(r => r.phase === 'post');
    assert.equal(post.duration_ms, 42);
  });

  it('getAllSessions returns all sessions ordered by started_at desc', () => {
    upsertSession(db, 'sess-2');
    const all = getAllSessions(db);
    assert.ok(all.length >= 2);
    assert.equal(all[0].id, 'sess-2');
  });

  it('insertPolicyRule and getPolicyRules round-trip with defaults', () => {
    const id = insertPolicyRule(db, {
      rule_type: 'block_path',
      pattern: '/etc/**',
    });
    assert.ok(id > 0);
    const rows = getPolicyRules(db);
    const row = rows.find(r => r.id === id);
    assert.ok(row);
    assert.equal(row.rule_type, 'block_path');
    assert.equal(row.pattern, '/etc/**');
    assert.equal(row.tool_matcher, '*');
    assert.equal(row.action, 'deny');
    assert.equal(row.priority, 0);
    assert.equal(row.enabled, 1);
    assert.ok(row.created_at);
  });

  it('getPolicyRules orders by priority desc', () => {
    insertPolicyRule(db, { rule_type: 'allow_path', pattern: '/tmp', priority: 1 });
    insertPolicyRule(db, { rule_type: 'block_path', pattern: '/root', priority: 10 });
    const rows = getPolicyRules(db);
    const priorities = rows.map(r => r.priority);
    const sorted = [...priorities].sort((a, b) => b - a);
    assert.deepEqual(priorities, sorted);
  });

  it('insertSensitivePattern and getSensitivePatterns round-trip', () => {
    const id = insertSensitivePattern(db, {
      pattern: '\\.env$',
      category: 'env',
      description: 'Environment variable files',
    });
    assert.ok(id > 0);
    const rows = getSensitivePatterns(db);
    const row = rows.find(r => r.id === id);
    assert.ok(row);
    assert.equal(row.pattern, '\\.env$');
    assert.equal(row.category, 'env');
    assert.equal(row.action, 'ask');
    assert.equal(row.enabled, 1);
  });

  it('insertPolicyDecision and getPolicyDecisions', () => {
    const id = insertPolicyDecision(db, {
      event_id: '42',
      session_id: 'sess-policy',
      rule_id: null,
      tool_name: 'Write',
      tool_input: JSON.stringify({ path: '/secret' }),
      matched_pattern: '\\.env$',
      decision: 'deny',
      reason: 'Sensitive path',
    });
    assert.ok(id > 0);
    const all = getPolicyDecisions(db);
    assert.ok(all.some(r => r.id === id && r.decision === 'deny'));
    const bySession = getPolicyDecisions(db, 'sess-policy');
    assert.equal(bySession.length, 1);
    assert.equal(bySession[0].tool_name, 'Write');
  });
});
