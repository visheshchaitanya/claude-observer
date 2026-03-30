// ANSI color codes
const GREY = '\x1b[90m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const INDENT = '    '; // 4 spaces per depth level

function indent(depth) {
  return INDENT.repeat(depth);
}

function padTool(tool) {
  return tool.padEnd(12);
}

export function formatPre({ tool, displayName, depth = 0 }) {
  const label = displayName ?? tool;
  return `${indent(depth)}${GREY}  ► ${padTool(label)}${RESET}`;
}

export function formatPost({ tool, displayName, depth = 0, duration_ms, hasError = false }) {
  const label = displayName ?? tool;
  const icon = hasError ? `${RED}✗${RESET}` : `${GREEN}✓${RESET}`;
  const dur = duration_ms != null ? `${String(duration_ms).padStart(6)}ms` : '';
  return `${indent(depth)}  ${icon} ${padTool(label)} ${dur}`;
}

export function printSessionStart(sessionId) {
  process.stderr.write(`\n${GREY}[claude-observer] Session ${sessionId}${RESET}\n`);
}

export function printEvent({ tool, displayName, phase, depth = 0, duration_ms = null, hasError = false }) {
  if (phase === 'pre') {
    process.stderr.write(formatPre({ tool, displayName, depth }) + '\n');
  } else {
    process.stderr.write(formatPost({ tool, displayName, depth, duration_ms, hasError }) + '\n');
  }
}
