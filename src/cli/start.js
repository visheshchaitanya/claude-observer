import { createServer } from 'node:net';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createObserverServer } from '../server/index.js';
import { injectHooks, getSettingsPath } from '../server/hooks.js';

const PORT = 4242;
const PID_FILE = (() => {
  const home = process.env.HOME || process.env.USERPROFILE;
  return join(home, '.claude-observer', 'server.pid');
})();

async function isPortBusy(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, '127.0.0.1', () => { server.close(); resolve(false); });
    server.on('error', () => resolve(true));
  });
}

export async function start() {
  if (await isPortBusy(PORT)) {
    console.error(`[claude-observer] Port ${PORT} is already in use. Is claude-observer already running?`);
    console.error(`  Run: claude-observer stop`);
    process.exit(1);
  }

  const settingsPath = getSettingsPath();
  injectHooks(settingsPath, PORT);
  console.log(`[claude-observer] Hooks injected into ${settingsPath}`);

  const server = createObserverServer(PORT);
  await server.start();

  // Write PID file so stop command can find us
  const pidDir = dirname(PID_FILE);
  mkdirSync(pidDir, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));

  console.log(`[claude-observer] Server running at http://localhost:${PORT}`);
  console.log(`[claude-observer] Watching for tool calls... (Ctrl+C or 'claude-observer stop' to quit)`);

  // Open browser
  try {
    const { default: open } = await import('open');
    await open(`http://localhost:${PORT}`);
  } catch {}

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('\n[claude-observer] Shutting down...');
    await server.stop();
    try { unlinkSync(PID_FILE); } catch {}
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    try { unlinkSync(PID_FILE); } catch {}
    process.exit(0);
  });
}
