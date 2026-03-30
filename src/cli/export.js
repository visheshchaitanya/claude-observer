import { writeFileSync } from 'node:fs';
import { createDb, getDbPath, getAllSessions, getSession, getEventsBySession } from '../server/db.js';

export async function exportSession({ session, output }) {
  const db = createDb(getDbPath());

  let sessionId = session;
  if (!sessionId) {
    const all = getAllSessions(db);
    if (all.length === 0) {
      console.error('[claude-observer] No sessions found.');
      db.close();
      process.exit(1);
    }
    sessionId = all[0].id; // most recent
  }

  const sess = getSession(db, sessionId);
  if (!sess) {
    console.error(`[claude-observer] Session '${sessionId}' not found.`);
    db.close();
    process.exit(1);
  }

  const events = getEventsBySession(db, sessionId);
  db.close();

  const data = JSON.stringify({ session: sess, events }, null, 2);

  if (output) {
    writeFileSync(output, data);
    console.log(`[claude-observer] Exported ${events.length} events to ${output}`);
  } else {
    process.stdout.write(data + '\n');
  }
}
