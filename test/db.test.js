import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDb, upsertSession, insertEvent, getSession, getAllSessions, getEventsBySession } from '../src/server/db.js';

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
    };
    const id = insertEvent(db, event);
    assert.ok(id > 0);
    const rows = getEventsBySession(db, 'sess-1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tool, 'Bash');
    assert.equal(rows[0].phase, 'pre');
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
});
