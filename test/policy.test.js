import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDb,
  insertPolicyRule,
  insertSensitivePattern,
  getPolicyDecisions,
  seedDefaultSensitivePatterns,
  DEFAULT_SENSITIVE_PATTERNS,
} from '../src/server/db.js';
import {
  evaluateToolCall,
  evaluateSensitivePatternAction,
  toolMatcherMatches,
  globPathToRegExp,
  matchPathPattern,
  matchShellPattern,
  buildHookResponse,
  SENSITIVE_DENY_MESSAGE,
  SENSITIVE_WARN_MESSAGE,
} from '../src/server/policy.js';
import { createObserverServer } from '../src/server/index.js';

const TEST_DIR = join(tmpdir(), 'claude-observer-policy-test-' + Date.now());

describe('seedDefaultSensitivePatterns', () => {
  it('inserts defaults once on empty DB', () => {
    const d = join(tmpdir(), 'claude-observer-seed-' + Date.now());
    mkdirSync(d, { recursive: true });
    const pdb = createDb(join(d, 'seed.db'));
    try {
      const first = seedDefaultSensitivePatterns(pdb);
      assert.equal(first.inserted, DEFAULT_SENSITIVE_PATTERNS.length);
      const second = seedDefaultSensitivePatterns(pdb);
      assert.equal(second.inserted, 0);
    } finally {
      pdb.close();
      rmSync(d, { recursive: true });
    }
  });
});

describe('evaluateSensitivePatternAction (tiers)', () => {
  const sp = { id: 1, pattern: '\\.env', category: 'env', description: 'Env file' };

  it('deny → deny with fixed access message', () => {
    const r = evaluateSensitivePatternAction('deny', sp);
    assert.equal(r.decision, 'deny');
    assert.equal(r.reason, SENSITIVE_DENY_MESSAGE);
    assert.equal(r.matchedPattern, '\\.env');
  });

  it('ask → ask with description', () => {
    const r = evaluateSensitivePatternAction('ask', sp);
    assert.equal(r.decision, 'ask');
    assert.equal(r.reason, 'Env file');
  });

  it('warn → allow with additionalContext', () => {
    const r = evaluateSensitivePatternAction('warn', sp);
    assert.equal(r.decision, 'allow');
    assert.ok(String(r.additionalContext).includes(SENSITIVE_WARN_MESSAGE));
    assert.ok(String(r.reason).includes(SENSITIVE_WARN_MESSAGE));
  });

  it('allow → allow without warning', () => {
    const r = evaluateSensitivePatternAction('allow', sp);
    assert.equal(r.decision, 'allow');
    assert.equal(r.additionalContext, undefined);
  });
});

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

  it('sensitive_patterns deny blocks with access denied message', () => {
    insertSensitivePattern(db, {
      pattern: '\\.pem$',
      category: 'keys',
      description: 'PEM',
      action: 'deny',
    });
    const r = evaluateToolCall(db, {
      tool_name: 'Read',
      tool_input: { path: join(TEST_DIR, 'certs/x.pem') },
    });
    assert.equal(r.decision, 'deny');
    assert.equal(r.reason, SENSITIVE_DENY_MESSAGE);
  });

  it('sensitive_patterns warn allows with warning context', () => {
    insertSensitivePattern(db, {
      pattern: '\\.npmrc',
      category: 'credentials',
      description: 'npm',
      action: 'warn',
    });
    const r = evaluateToolCall(db, {
      tool_name: 'Read',
      tool_input: { path: join(TEST_DIR, 'proj/.npmrc') },
    });
    assert.equal(r.decision, 'allow');
    assert.ok(String(r.additionalContext).includes(SENSITIVE_WARN_MESSAGE));
    const hook = buildHookResponse(r);
    assert.equal(hook.hookSpecificOutput.permissionDecision, 'allow');
    assert.ok(String(hook.hookSpecificOutput.additionalContext).includes(SENSITIVE_WARN_MESSAGE));
  });

  it('sensitive_patterns allow tier passes through', () => {
    insertSensitivePattern(db, {
      pattern: 'public-readme',
      category: 'custom',
      description: 'ok',
      action: 'allow',
    });
    const r = evaluateToolCall(db, {
      tool_name: 'Read',
      tool_input: { path: join(TEST_DIR, 'docs/public-readme') },
    });
    assert.equal(r.decision, 'allow');
    assert.deepEqual(buildHookResponse(r), {});
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

describe('buildHookResponse', () => {
  it('returns {} for allow', () => {
    assert.deepEqual(buildHookResponse({ decision: 'allow' }), {});
  });

  it('returns allow with additionalContext for warn tier', () => {
    const b = buildHookResponse({
      decision: 'allow',
      additionalContext: `${SENSITIVE_WARN_MESSAGE}`,
    });
    assert.equal(b.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(b.hookSpecificOutput.permissionDecision, 'allow');
    assert.equal(b.hookSpecificOutput.additionalContext, SENSITIVE_WARN_MESSAGE);
  });

  it('returns deny with permissionDecisionReason', () => {
    const b = buildHookResponse({
      decision: 'deny',
      reason: 'Write to /etc blocked by policy',
    });
    assert.equal(b.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(b.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(
      b.hookSpecificOutput.permissionDecisionReason,
      'Write to /etc blocked by policy'
    );
  });

  it('returns ask without permissionDecisionReason', () => {
    const b = buildHookResponse({ decision: 'ask', reason: 'ignored for hook shape' });
    assert.equal(b.hookSpecificOutput.permissionDecision, 'ask');
    assert.equal(b.hookSpecificOutput.permissionDecisionReason, undefined);
  });
});

describe('POST /policy/evaluate', () => {
  let prevHome;
  let testHome;
  let server;
  let port;

  before(async () => {
    prevHome = process.env.HOME;
    testHome = join(tmpdir(), 'claude-observer-policy-http-' + Date.now());
    mkdirSync(join(testHome, '.claude-observer'), { recursive: true });
    process.env.HOME = testHome;
    server = createObserverServer(0);
    port = await server.start();
    insertPolicyRule(server.db, {
      rule_type: 'block_path',
      pattern: '/etc/**',
      tool_matcher: '*',
      action: 'deny',
      reason: 'Write to /etc blocked by policy',
      priority: 50,
    });
  });

  after(async () => {
    await server.stop();
    process.env.HOME = prevHome;
    rmSync(testHome, { recursive: true });
  });

  it('returns deny payload and logs policy_decisions', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/policy/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: 'hook-sess',
        tool_name: 'Write',
        tool_input: { path: '/etc/passwd', content: 'x' },
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(json.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(
      String(json.hookSpecificOutput.permissionDecisionReason ?? '').includes('policy') ||
        String(json.hookSpecificOutput.permissionDecisionReason ?? '').includes('blocked')
    );

    const rows = getPolicyDecisions(server.db, 'hook-sess');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].decision, 'deny');
    assert.equal(rows[0].tool_name, 'Write');
  });

  it('returns {} for allow', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/policy/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: 'allow-sess',
        tool_name: 'Read',
        tool_input: { path: '/tmp/foo' },
      }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {});
  });
});
