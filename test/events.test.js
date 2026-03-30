import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createEventProcessor } from '../src/server/events.js';

describe('event processor', () => {
  function makeProcessor() {
    const stored = [];
    const broadcasted = [];
    const deps = {
      upsertSession: () => {},
      insertEvent: (event) => { stored.push(event); return stored.length; },
      broadcast: (msg) => broadcasted.push(msg),
      printEvent: () => {},
    };
    return { processor: createEventProcessor(deps), stored, broadcasted };
  }

  it('stores a pre event immediately', () => {
    const { processor, stored } = makeProcessor();
    processor.handle({
      phase: 'pre',
      session_id: 'sess-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      ts: new Date().toISOString(),
    });
    assert.equal(stored.length, 1);
    assert.equal(stored[0].phase, 'pre');
    assert.equal(stored[0].tool, 'Bash');
  });

  it('stores a post event with computed duration_ms', () => {
    const { processor, stored } = makeProcessor();
    processor.handle({ phase: 'pre',  session_id: 's', tool_name: 'Read', tool_input: {} });
    processor.handle({ phase: 'post', session_id: 's', tool_name: 'Read', tool_response: {} });
    const post = stored.find(e => e.phase === 'post');
    assert.ok(post.duration_ms >= 0, 'duration_ms should be a non-negative number');
  });

  it('assigns parent_event_id to events inside an Agent call', () => {
    const { processor, stored } = makeProcessor();
    // Agent pre
    processor.handle({ phase: 'pre',  session_id: 's', tool_name: 'Agent', tool_input: {}, ts: new Date().toISOString() });
    const agentPreId = 1; // insertEvent returns stored.length = 1
    // Nested Bash
    processor.handle({ phase: 'pre',  session_id: 's', tool_name: 'Bash',  tool_input: {}, ts: new Date().toISOString() });
    processor.handle({ phase: 'post', session_id: 's', tool_name: 'Bash',  tool_response: {}, ts: new Date().toISOString() });
    // Agent post
    processor.handle({ phase: 'post', session_id: 's', tool_name: 'Agent', tool_response: {}, ts: new Date().toISOString() });

    const bashPre = stored.find(e => e.tool === 'Bash' && e.phase === 'pre');
    assert.equal(bashPre.parent_event_id, agentPreId);
  });

  it('broadcasts each event over WebSocket', () => {
    const { processor, broadcasted } = makeProcessor();
    processor.handle({ phase: 'pre', session_id: 's', tool_name: 'Grep', tool_input: {}, ts: new Date().toISOString() });
    assert.equal(broadcasted.length, 1);
    const msg = JSON.parse(broadcasted[0]);
    assert.equal(msg.type, 'event');
    assert.equal(msg.data.tool, 'Grep');
  });
});
