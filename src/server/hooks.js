import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OBSERVER_MARKER = 'claude-observer';

/** Path segment for synchronous policy PreToolUse HTTP hook (must match server route). */
const POLICY_EVALUATE_PATH = '/policy/evaluate';

function buildPostCommand(port) {
  return `curl -s --max-time 1 -X POST "http://localhost:${port}/event?phase=post&ppid=$PPID" -H 'Content-Type: application/json' --data-binary @- || true # claude-observer`;
}

function makePreHookEntry(port) {
  return {
    matcher: '.*',
    hooks: [
      {
        type: 'http',
        url: `http://localhost:${port}${POLICY_EVALUATE_PATH}`,
        timeout: 5,
      },
    ],
  };
}

function makePostHookEntry(port) {
  return {
    matcher: '.*',
    hooks: [{ type: 'command', command: buildPostCommand(port) }],
  };
}

export function isObserverEntry(entry) {
  return (
    entry?.hooks?.some(h => {
      if (h.type === 'command') return h.command?.includes(OBSERVER_MARKER);
      if (h.type === 'http') return h.url?.includes(POLICY_EVALUATE_PATH);
      return false;
    }) ?? false
  );
}

function readSettings(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(path, settings) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2));
}

export function injectHooks(settingsPath, port) {
  const settings = readSettings(settingsPath);
  settings.hooks = settings.hooks ?? {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse ?? [];
  settings.hooks.PostToolUse = settings.hooks.PostToolUse ?? [];

  // Remove stale observer entries before re-adding (idempotent)
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(e => !isObserverEntry(e));
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(e => !isObserverEntry(e));

  settings.hooks.PreToolUse.push(makePreHookEntry(port));
  settings.hooks.PostToolUse.push(makePostHookEntry(port));

  writeSettings(settingsPath, settings);
}

export function removeHooks(settingsPath) {
  const settings = readSettings(settingsPath);
  if (!settings.hooks) return;

  if (settings.hooks.PreToolUse) {
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(e => !isObserverEntry(e));
  }
  if (settings.hooks.PostToolUse) {
    settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(e => !isObserverEntry(e));
  }

  writeSettings(settingsPath, settings);
}

export function hasObserverHooks(settingsPath) {
  const settings = readSettings(settingsPath);
  const pre = settings.hooks?.PreToolUse ?? [];
  return pre.some(isObserverEntry);
}

export function getSettingsPath() {
  const home = process.env.HOME || process.env.USERPROFILE;
  return `${home}/.claude/settings.json`;
}
