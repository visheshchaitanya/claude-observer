import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDb, insertPolicyRule, insertSensitivePattern } from '../src/server/db.js';
import {
  evaluateToolCall,
  toolMatcherMatches,
  globPathToRegExp,
  matchPathPattern,
  matchShellPattern,
} from '../src/server/policy.js';

const TEST_DIR = join(tmpdir(), 'claude-observer-policy-test-' + Date.now());

describe('policy helpers', () => {
  it('toolMatcherMatches', () => {
    assert.equal(toolMatcherMatches('*', 'Bash'), true);
    assert.equal(toolMatcherMatches('Bash', 'Bash'), true);
    assert.equal(toolMatcherMatches('Bash', 'Read'), false);
    assert.equal(toolMatcherMatches('mcp__*', 'mcp__obsidian'), true);
    assert.equal(toolMatcherMatches('mcp__*', 'Bash'), false);
  });

  it('globPathToRegExp matches ** segments', () => {
    const re = globPathToRegExp('/etc/**');
    assert.equal(re.test('/etc/passwd'), true);
    assert.equal(re.test('/etc/ssh/sshd_config'), true);
    assert.equal(re.test('/usr/etc/foo'), false);
  });

  it('matchPathPattern glob and re:', () => {
    assert.equal(matchPathPattern('**/.ssh/**', '/Users/x/.ssh/id_rsa'), true);
    assert.equal(matchPathPattern('re:/\\.env($|\\.)', '/app/.env'), true);
    assert.equal(matchPathPattern('re:/\\.env($|\\.)', '/app/.env.local'), true);
    assert.equal(matchPathPattern('/tmp/foo', '/tmp/foo'), true);
  });

  it('matchShellPattern is case-insensitive regex', () => {
    assert.equal(matchShellPattern('\\brm\\s+-rf\\b', 'rm -rf /'), true);
    assert.equal(matchShellPattern('\\bsudo\\b', 'SUDO apt'), true);
    assert.equal(matchShellPattern('\\b(curl|wget)\\b', 'curl https://x'), true);
  });
});

describe('evaluateToolCall', () => {
  let db;

  before(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    db = createDb(join(TEST_DIR, 'policy.db'));
  });

  after(() => {
    db.close();
    rmSync(TEST_DIR, { recursive: true });
  });

  it('allows when no rules match', () => {
    const r = evaluateToolCall(db, {
      tool_name: 'Read',
      tool_input: { path: '/tmp/readme.txt' },
    });
    assert.equal(r.decision, 'allow');
  });

  it('denies block_path for /etc writes', () => {
    insertPolicyRule(db, {
      rule_type: 'block_path',
      pattern: '/etc/**',
      tool_matcher: '*',
      action: 'deny',
      reason: 'system path',
      priority: 50,
    });
    const r = evaluateToolCall(db, {
      tool_name: 'Write',
      tool_input: { path: '/etc/hosts' },
    });
    assert.equal(r.decision, 'deny');
    assert.match(r.reason ?? '', /system path|policy/);
    assert.ok(r.ruleId);
    assert.equal(r.matchedPattern, '/etc/**');
  });

  it('allows writes under project when write_scope outside_project is set', () => {
    insertPolicyRule(db, {
      rule_type: 'write_scope',
      pattern: 'outside_project',
      tool_matcher: '*',
      action: 'deny',
      priority: 80,
    });
    const proj = join(TEST_DIR, 'proj');
    const r = evaluateToolCall(db, {
      tool_name: 'Write',
      tool_input: { path: join(proj, 'src/a.ts') },
      project_root: proj,
    });
    assert.equal(r.decision, 'allow');
  });

  it('denies write_scope when path is outside project_root', () => {
    insertPolicyRule(db, {
      rule_type: 'write_scope',
      pattern: 'outside_project',
      tool_matcher: '*',
      action: 'deny',
      priority: 80,
    });
    const proj = join(TEST_DIR, 'proj');
    const r = evaluateToolCall(db, {
      tool_name: 'Write',
      tool_input: { path: '/tmp/outside.txt' },
      project_root: proj,
    });
    assert.equal(r.decision, 'deny');
  });

  it('matches shell_block_pattern on Bash', () => {
    insertPolicyRule(db, {
      rule_type: 'shell_block_pattern',
      pattern: '\\b(rm\\s+-rf|sudo)\\b',
      tool_matcher: 'Bash',
      action: 'deny',
      reason: 'destructive',
      priority: 100,
    });
    const denied = evaluateToolCall(db, {
      tool_name: 'Bash',
      tool_input: { command: 'sudo rm -rf /tmp/x' },
    });
    assert.equal(denied.decision, 'deny');

    const ok = evaluateToolCall(db, {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    });
    assert.equal(ok.decision, 'allow');
  });

  it('higher priority rule wins', () => {
    insertPolicyRule(db, {
      rule_type: 'shell_block_pattern',
      pattern: '.*',
      tool_matcher: 'Bash',
      action: 'deny',
      priority: 5,
    });
    insertPolicyRule(db, {
      rule_type: 'shell_block_pattern',
      pattern: 'git\\s+status',
      tool_matcher: 'Bash',
      action: 'allow',
      priority: 100,
    });
    const r = evaluateToolCall(db, {
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
    });
    assert.equal(r.decision, 'allow');
  });

  it('sensitive_patterns ask when regex matches path', () => {
    insertSensitivePattern(db, {
      pattern: '\\.env($|\\.)',
      category: 'env',
      description: 'env file',
      action: 'ask',
    });
    const r = evaluateToolCall(db, {
      tool_name: 'Read',
      tool_input: { path: join(TEST_DIR, 'app/.env') },
    });
    assert.equal(r.decision, 'ask');
    assert.ok(r.matchedPattern);
  });

  it('MCP tools match mcp rule_type', () => {
    insertPolicyRule(db, {
      rule_type: 'mcp',
      pattern: 'mcp__',
      tool_matcher: 'mcp__*',
      action: 'ask',
      priority: 40,
    });
    const r = evaluateToolCall(db, {
      tool_name: 'mcp__plugin',
      tool_input: { query: 'x' },
    });
    assert.equal(r.decision, 'ask');
  });

  it('allow_path short-circuits to allow', () => {
    insertPolicyRule(db, {
      rule_type: 'allow_path',
      pattern: '/safe/**',
      tool_matcher: '*',
      action: 'allow',
      priority: 200,
    });
    insertPolicyRule(db, {
      rule_type: 'shell_block_pattern',
      pattern: '.*',
      tool_matcher: 'Bash',
      action: 'deny',
      priority: 1,
    });
    const r = evaluateToolCall(db, {
      tool_name: 'Read',
      tool_input: { path: '/safe/notes.txt' },
    });
    assert.equal(r.decision, 'allow');
  });
});
