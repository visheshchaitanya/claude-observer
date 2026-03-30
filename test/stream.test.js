import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { formatPre, formatPost } from '../src/server/stream.js';

describe('stream formatter', () => {
  it('formatPre returns indented pre-event line', () => {
    const line = formatPre({ tool: 'Bash', depth: 0 });
    assert.ok(line.includes('Bash'));
    assert.ok(line.includes('►'));
    assert.ok(!line.startsWith(' ')); // depth 0 = no indent
  });

  it('formatPre indents for sub-agents at depth 1', () => {
    const line = formatPre({ tool: 'Read', depth: 1 });
    assert.ok(line.startsWith('    ')); // 4 spaces per depth level
  });

  it('formatPost returns indented post-event line with duration', () => {
    const line = formatPost({ tool: 'Bash', depth: 0, duration_ms: 42 });
    assert.ok(line.includes('Bash'));
    assert.ok(line.includes('42ms'));
    assert.ok(line.includes('✓'));
  });

  it('formatPost shows error indicator when output contains error', () => {
    const line = formatPost({ tool: 'Bash', depth: 0, duration_ms: 5, hasError: true });
    assert.ok(line.includes('✗'));
  });
});
