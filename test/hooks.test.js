import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { injectHooks, removeHooks, hasObserverHooks, isObserverEntry } from '../src/server/hooks.js';

const TEST_DIR = join(tmpdir(), 'claude-hooks-test-' + Date.now());
const SETTINGS_PATH = join(TEST_DIR, 'settings.json');

describe('hooks', () => {
  before(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  after(() => {
    rmSync(TEST_DIR, { recursive: true });
  });

  it('injectHooks creates settings.json with hooks when file does not exist', () => {
    injectHooks(SETTINGS_PATH, 4242);
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    assert.ok(settings.hooks?.PreToolUse?.length > 0);
    assert.ok(settings.hooks?.PostToolUse?.length > 0);
    const pre = settings.hooks.PreToolUse[0].hooks[0];
    assert.equal(pre.type, 'http');
    assert.equal(pre.url, 'http://localhost:4242/policy/evaluate');
    assert.equal(pre.timeout, 5);
    assert.ok(settings.hooks.PostToolUse[0].hooks[0].command.includes('4242'));
    assert.ok(settings.hooks.PostToolUse[0].hooks[0].command.includes('claude-observer'));
  });

  it('injectHooks merges with existing settings without overwriting other keys', () => {
    writeFileSync(SETTINGS_PATH, JSON.stringify({ theme: 'dark', permissions: ['read'] }));
    injectHooks(SETTINGS_PATH, 4242);
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    assert.equal(settings.theme, 'dark');
    assert.deepEqual(settings.permissions, ['read']);
    assert.ok(settings.hooks?.PreToolUse);
  });

  it('injectHooks merges with existing hooks without duplicating observer entries', () => {
    const existing = {
      hooks: {
        PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'my-hook' }] }]
      }
    };
    writeFileSync(SETTINGS_PATH, JSON.stringify(existing));
    injectHooks(SETTINGS_PATH, 4242);
    injectHooks(SETTINGS_PATH, 4242); // second call must not duplicate
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    const preHooks = settings.hooks.PreToolUse;
    const observerEntries = preHooks.filter(isObserverEntry);
    assert.equal(observerEntries.length, 1);
    assert.equal(preHooks.length, 2); // original + observer
  });

  it('hasObserverHooks returns true after inject', () => {
    assert.equal(hasObserverHooks(SETTINGS_PATH), true);
  });

  it('removeHooks removes only observer entries, leaves others', () => {
    removeHooks(SETTINGS_PATH);
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    const preHooks = settings.hooks?.PreToolUse ?? [];
    const observerEntries = preHooks.filter(isObserverEntry);
    assert.equal(observerEntries.length, 0);
    const otherEntries = preHooks.filter(h =>
      h.hooks?.[0]?.command === 'my-hook'
    );
    assert.equal(otherEntries.length, 1);
  });

  it('hasObserverHooks returns false after remove', () => {
    assert.equal(hasObserverHooks(SETTINGS_PATH), false);
  });

  it('isObserverEntry detects legacy PreToolUse command hook', () => {
    assert.equal(
      isObserverEntry({
        matcher: '.*',
        hooks: [{ type: 'command', command: 'curl ... # claude-observer' }]
      }),
      true
    );
  });

  it('isObserverEntry detects PreToolUse http policy hook', () => {
    assert.equal(
      isObserverEntry({
        matcher: '.*',
        hooks: [{ type: 'http', url: 'http://localhost:9999/policy/evaluate', timeout: 5 }]
      }),
      true
    );
  });

  it('isObserverEntry detects PostToolUse command hook', () => {
    assert.equal(
      isObserverEntry({
        matcher: '.*',
        hooks: [{ type: 'command', command: 'curl ... || true # claude-observer' }]
      }),
      true
    );
  });

  it('isObserverEntry returns false for unrelated hooks', () => {
    assert.equal(
      isObserverEntry({
        matcher: '.*',
        hooks: [{ type: 'command', command: 'echo hi' }]
      }),
      false
    );
    assert.equal(
      isObserverEntry({
        matcher: '.*',
        hooks: [{ type: 'http', url: 'http://localhost:8080/other', timeout: 1 }]
      }),
      false
    );
  });
});
