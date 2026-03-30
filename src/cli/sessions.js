import { createDb, getDbPath, getAllSessions } from '../server/db.js';

export async function listSessions() {
  const db = createDb(getDbPath());
  const sessions = getAllSessions(db);
  db.close();

  if (sessions.length === 0) {
    console.log('[claude-observer] No sessions recorded yet.');
    return;
  }

  console.log('\nRecorded sessions:\n');
  console.log('  ID                                    Calls  Started');
  console.log('  ' + '-'.repeat(70));
  for (const s of sessions) {
    const id = s.id.padEnd(38);
    const calls = String(s.total_calls).padStart(5);
    const started = s.started_at ? s.started_at.slice(0, 19) : 'unknown';
    console.log(`  ${id} ${calls}  ${started}`);
  }
  console.log('');
}
