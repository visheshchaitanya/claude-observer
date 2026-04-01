#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const program = new Command();

program
  .name('claude-observer')
  .description('Real-time Claude Code tool call observer')
  .version(pkg.version);

program
  .command('start')
  .description('Start observer server, inject hooks, open dashboard')
  .action(async () => {
    const { start } = await import('../src/cli/start.js');
    await start();
  });

program
  .command('stop')
  .description('Remove hooks and shut down server')
  .action(async () => {
    const { stop } = await import('../src/cli/stop.js');
    await stop();
  });

program
  .command('sessions')
  .description('List recorded sessions')
  .action(async () => {
    const { listSessions } = await import('../src/cli/sessions.js');
    await listSessions();
  });

program
  .command('export')
  .description('Export a session to JSON')
  .option('-s, --session <id>', 'Session ID to export (defaults to most recent)')
  .option('-o, --output <path>', 'Output file path (defaults to stdout)')
  .action(async (opts) => {
    const { exportSession } = await import('../src/cli/export.js');
    await exportSession(opts);
  });

function registerInitSetup(cmd) {
  return cmd
    .description('Interactive policy configuration wizard')
    .action(async () => {
      const { runInitWizard } = await import('../src/cli/init.js');
      await runInitWizard();
    });
}

registerInitSetup(program.command('init'));
registerInitSetup(program.command('setup'));

program.parse();
