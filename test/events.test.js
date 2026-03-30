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

  it('assigns parent_event_id to child tools inside an Agent call', () => {
    const { processor, stored } = makeProcessor();
    processor.handle({ phase: 'pre',  session_id: 's', tool_name: 'Agent', tool_input: {} });
    const agentPreId = 1;
    processor.handle({ phase: 'pre',  session_id: 's', tool_name: 'Bash',  tool_input: {} });
    processor.handle({ phase: 'post', session_id: 's', tool_name: 'Bash',  tool_response: {} });
    processor.handle({ phase: 'post', session_id: 's', tool_name: 'Agent', tool_response: {} });

    const bashPre = stored.find(e => e.tool === 'Bash' && e.phase === 'pre');
    assert.equal(bashPre.parent_event_id, agentPreId);
  });

  it('all Agent calls are top-level regardless of ordering', () => {
    const { processor, stored } = makeProcessor();
    const ppid = '43921';
    // Agent 1 with child activity
    processor.handle({ phase: 'pre',  session_id: 's', tool_name: 'Agent', tool_input: { description: 'a1' }, ppid });
    processor.handle({ phase: 'pre',  session_id: 's', tool_name: 'Read', tool_input: {}, ppid });
    processor.handle({ phase: 'post', session_id: 's', tool_name: 'Read', tool_response: {}, ppid });
    // Agent 2 arrives after Agent 1 has had children — still top-level
    processor.handle({ phase: 'pre',  session_id: 's', tool_name: 'Agent', tool_input: { description: 'a2' }, ppid });
    // Agent 3 arrives even later
    processor.handle({ phase: 'pre',  session_id: 's', tool_name: 'Agent', tool_input: { description: 'a3' }, ppid });

    assert.equal(stored[0].parent_event_id, null, 'Agent 1 top-level');
    assert.equal(stored[3].parent_event_id, null, 'Agent 2 top-level');
    assert.equal(stored[4].parent_event_id, null, 'Agent 3 top-level');
  });

  it('computes display_name with AGENT: and TOOL: prefixes', () => {
    const { processor, stored } = makeProcessor();
    processor.handle({ phase: 'pre', session_id: 's', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'test' } });
    processor.handle({ phase: 'pre', session_id: 's', tool_name: 'Read', tool_input: {} });
    processor.handle({ phase: 'pre', session_id: 's', tool_name: 'Agent', tool_input: { description: 'planner' } });

    assert.equal(stored[0].display_name, 'AGENT:Explore');
    assert.equal(stored[1].display_name, 'TOOL:Read');
    assert.equal(stored[2].display_name, 'AGENT:planner');
  });

  it('broadcasts each event over WebSocket', () => {
    const { processor, broadcasted } = makeProcessor();
    processor.handle({ phase: 'pre', session_id: 's', tool_name: 'Grep', tool_input: {} });
    assert.equal(broadcasted.length, 1);
    const msg = JSON.parse(broadcasted[0]);
    assert.equal(msg.type, 'event');
    assert.equal(msg.data.tool, 'Grep');
  });
});
