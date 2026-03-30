import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { removeHooks, getSettingsPath } from '../server/hooks.js';

const PID_FILE = (() => {
  const home = process.env.HOME || process.env.USERPROFILE;
  return join(home, '.claude-observer', 'server.pid');
})();

export async function stop() {
  const settingsPath = getSettingsPath();
  removeHooks(settingsPath);
  console.log(`[claude-observer] Hooks removed from ${settingsPath}`);

  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    try {
      process.kill(pid, 0); // throws if PID doesn't exist
      process.kill(pid, 'SIGTERM');
      console.log(`[claude-observer] Sent SIGTERM to server (PID ${pid})`);
      unlinkSync(PID_FILE);
    } catch {
      console.warn(`[claude-observer] Could not signal PID ${pid} — server may already be stopped`);
      try { unlinkSync(PID_FILE); } catch {}
    }
  } else {
    console.log('[claude-observer] No running server found (no PID file)');
  }
}
