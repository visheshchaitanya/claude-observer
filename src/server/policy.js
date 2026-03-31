import { resolve, sep, normalize } from 'node:path';
import { getPolicyRules, getSensitivePatterns } from './db.js';

/**
 * @typedef {'allow'|'deny'|'ask'} PolicyDecision
 */

/**
 * @typedef {object} EvaluateResult
 * @property {PolicyDecision} decision
 * @property {string} [reason]
 * @property {number} [ruleId]
 * @property {string} [matchedPattern]
 */

const FILE_TOOLS = new Set(['Write', 'Read', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'Shell']);

/**
 * @param {string} matcher
 * @param {string} toolName
 */
export function toolMatcherMatches(matcher, toolName) {
  const m = matcher ?? '*';
  if (m === '*' || m === '') return true;
  if (m.endsWith('*')) {
    const prefix = m.slice(0, -1);
    return toolName.startsWith(prefix);
  }
  return toolName === m;
}

/**
 * Convert a glob-style path pattern to a RegExp (POSIX-style paths).
 * Supports `**`, single-segment `*`, and `?`.
 * @param {string} globPattern
 */
export function globPathToRegExp(globPattern) {
  let out = '';
  let i = 0;
  const g = globPattern;
  while (i < g.length) {
    if (i < g.length - 1 && g[i] === '*' && g[i + 1] === '*') {
      out += '.*';
      i += 2;
      if (g[i] === '/') i += 1;
      continue;
    }
    if (g[i] === '*') {
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (g[i] === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    const c = g[i];
    if ('\\.^$+()[]{}|'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
    i += 1;
  }
  return new RegExp('^' + out + '$');
}

/**
 * @param {string} pattern
 * @param {string} value
 */
export function matchPathPattern(pattern, value) {
  if (!pattern || !value) return false;
  const p = pattern.trim();
  if (p.startsWith('re:')) {
    try {
      const body = p.slice(3);
      const lastSlash = body.lastIndexOf('/');
      let source = body;
      let flags = '';
      if (body.startsWith('/') && lastSlash > 0) {
        source = body.slice(1, lastSlash);
        flags = body.slice(lastSlash + 1);
      }
      return new RegExp(source, flags).test(value);
    } catch {
      return false;
    }
  }
  if (p.includes('*') || p.includes('?')) {
    return globPathToRegExp(p).test(value);
  }
  return value === p || value.startsWith(p + sep);
}

/**
 * @param {string} pattern
 * @param {string} command
 */
export function matchShellPattern(pattern, command) {
  if (!pattern || command == null) return false;
  try {
    return new RegExp(pattern, 'i').test(command);
  } catch {
    return false;
  }
}

/**
 * Expand ~ in path-like strings for matching.
 * @param {string} p
 */
function expandUserPath(p) {
  if (!p || typeof p !== 'string') return p;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (p === '~') return home;
  if (p.startsWith('~/')) return home ? home + p.slice(1) : p;
  return p;
}

/**
 * @param {object} toolInput
 */
function extractFilePath(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const raw =
    toolInput.path ??
    toolInput.file_path ??
    toolInput.filePath ??
    toolInput.absolute_path ??
    null;
  if (raw == null) return null;
  const s = typeof raw === 'string' ? raw : String(raw);
  return normalize(expandUserPath(s));
}

/**
 * @param {object} toolInput
 */
function extractCommand(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const c = toolInput.command ?? toolInput.cmd ?? '';
  return typeof c === 'string' ? c : String(c);
}

/**
 * @param {string} filePath
 * @param {string} [projectRoot]
 */
function isOutsideProject(filePath, projectRoot) {
  if (!filePath || !projectRoot) return false;
  try {
    const root = resolve(projectRoot);
    const p = resolve(filePath);
    return !(p === root || p.startsWith(root + sep));
  } catch {
    return false;
  }
}

/**
 * @param {string} toolName
 */
function isMcpTool(toolName) {
  return typeof toolName === 'string' && toolName.startsWith('mcp__');
}

/**
 * @param {string} toolName
 */
function isFileTool(toolName) {
  return FILE_TOOLS.has(toolName);
}

/**
 * @param {string} toolName
 */
function isShellTool(toolName) {
  return SHELL_TOOLS.has(toolName);
}

/**
 * Map DB action to API decision.
 * @param {string} action
 * @returns {PolicyDecision}
 */
function normalizeAction(action) {
  const a = (action ?? 'deny').toLowerCase();
  if (a === 'allow') return 'allow';
  if (a === 'ask' || a === 'warn') return 'ask';
  return 'deny';
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object|string} toolCall
 * @returns {EvaluateResult}
 */
export function evaluateToolCall(db, toolCall) {
  let tc = toolCall;
  if (typeof tc === 'string') {
    try {
      tc = JSON.parse(tc);
    } catch {
      return { decision: 'allow', reason: 'Invalid tool call payload' };
    }
  }

  const tool_name = tc.tool_name ?? tc.toolName ?? '';
  const tool_input = tc.tool_input ?? tc.toolInput ?? {};
  const projectRoot = tc.project_root ?? tc.projectRoot ?? null;

  const pathStr = extractFilePath(tool_input);
  const commandStr = extractCommand(tool_input);

  const rules = getPolicyRules(db).filter(r => r.enabled === 1);
  const sensitiveRows = getSensitivePatterns(db).filter(r => r.enabled === 1);

  for (const rule of rules) {
    if (rule.rule_type === 'sensitive_mode') continue;
    if (!toolMatcherMatches(rule.tool_matcher, tool_name)) continue;

    const action = normalizeAction(rule.action);

    if (rule.rule_type === 'write_scope' && rule.pattern === 'outside_project') {
      if ((tool_name === 'Write' || tool_name === 'Edit' || tool_name === 'MultiEdit') && pathStr) {
        if (isOutsideProject(pathStr, projectRoot)) {
          return {
            decision: action,
            reason: rule.reason ?? 'Write outside project root',
            ruleId: rule.id,
            matchedPattern: rule.pattern,
          };
        }
      }
      continue;
    }

    if (rule.rule_type === 'block_path' || rule.rule_type === 'allow_path') {
      if (!isFileTool(tool_name) || !pathStr) continue;
      if (matchPathPattern(rule.pattern, pathStr)) {
        return {
          decision: rule.rule_type === 'allow_path' ? 'allow' : action,
          reason: rule.reason ?? `Path matched policy rule`,
          ruleId: rule.id,
          matchedPattern: rule.pattern,
        };
      }
      continue;
    }

    if (rule.rule_type === 'shell_block_pattern' || rule.rule_type === 'shell_pattern') {
      if (!isShellTool(tool_name) || !commandStr) continue;
      if (matchShellPattern(rule.pattern, commandStr)) {
        return {
          decision: action,
          reason: rule.reason ?? 'Shell command matched policy rule',
          ruleId: rule.id,
          matchedPattern: rule.pattern,
        };
      }
      continue;
    }

    if (rule.rule_type === 'mcp' || rule.rule_type === 'mcp_tool') {
      if (!isMcpTool(tool_name)) continue;
      const haystack = JSON.stringify(tool_input ?? {});
      if (matchShellPattern(rule.pattern, haystack) || matchShellPattern(rule.pattern, tool_name)) {
        return {
          decision: action,
          reason: rule.reason ?? 'MCP tool matched policy rule',
          ruleId: rule.id,
          matchedPattern: rule.pattern,
        };
      }
      continue;
    }

    if (rule.rule_type === 'network' || rule.rule_type === 'network_pattern') {
      if (!isShellTool(tool_name) && !isMcpTool(tool_name)) continue;
      const haystack = isShellTool(tool_name) ? commandStr : JSON.stringify(tool_input ?? {});
      if (matchShellPattern(rule.pattern, haystack)) {
        return {
          decision: action,
          reason: rule.reason ?? 'Network-related policy match',
          ruleId: rule.id,
          matchedPattern: rule.pattern,
        };
      }
    }
  }

  for (const sp of sensitiveRows) {
    let target = '';
    if (isFileTool(tool_name) && pathStr) target = pathStr;
    else if (isShellTool(tool_name)) target = commandStr;
    else if (isMcpTool(tool_name)) target = `${tool_name} ${JSON.stringify(tool_input ?? {})}`;
    else target = JSON.stringify({ tool_name, tool_input });

    try {
      const re = new RegExp(sp.pattern);
      if (re.test(target)) {
        return {
          decision: normalizeAction(sp.action),
          reason: sp.description ?? `Sensitive pattern (${sp.category ?? 'unknown'})`,
          matchedPattern: sp.pattern,
          ruleId: sp.id,
        };
      }
    } catch {
      continue;
    }
  }

  return { decision: 'allow' };
}

/**
 * Format policy result for Claude Code PreToolUse hook HTTP response.
 * @param {EvaluateResult} result
 * @returns {Record<string, unknown>}
 */
export function buildHookResponse(result) {
  if (result.decision === 'allow') {
    return {};
  }
  const out = {
    hookEventName: 'PreToolUse',
    permissionDecision: result.decision,
  };
  if (result.decision === 'deny' && result.reason) {
    out.permissionDecisionReason = result.reason;
  }
  return { hookSpecificOutput: out };
}
