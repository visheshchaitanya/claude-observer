/**
 * createEventProcessor returns a stateful event handler.
 * It tracks open pre-events (for duration), Agent call stacks (for parent_event_id),
 * and coordinates DB writes, WebSocket broadcasts, and terminal printing.
 *
 * deps: { upsertSession, insertEvent, broadcast, printEvent }
 */
export function createEventProcessor({ upsertSession, insertEvent, broadcast, printEvent }) {
  // Map<sessionId, Map<toolName, { dbId, ts }[]>> — stack of open pre-events
  const openPre = new Map();
  // Map<sessionId, number[]> — stack of Agent pre-event DB IDs (for parent tracking)
  const agentStack = new Map();

  function getOpenStack(sessionId) {
    if (!openPre.has(sessionId)) openPre.set(sessionId, new Map());
    return openPre.get(sessionId);
  }

  function getAgentStack(sessionId) {
    if (!agentStack.has(sessionId)) agentStack.set(sessionId, []);
    return agentStack.get(sessionId);
  }

  function currentParentId(sessionId) {
    const stack = getAgentStack(sessionId);
    return stack.length > 0 ? stack[stack.length - 1] : null;
  }

  function depth(sessionId) {
    return getAgentStack(sessionId).length;
  }

  function handle(raw) {
    const { phase, session_id, tool_name, tool_input, tool_response } = raw;
    const ts = new Date().toISOString();

    upsertSession(session_id);

    if (phase === 'pre') {
      const parentId = currentParentId(session_id);
      const event = {
        session_id,
        tool: tool_name,
        phase: 'pre',
        input: tool_input ? JSON.stringify(tool_input) : null,
        output: null,
        duration_ms: null,
        ts,
        parent_event_id: parentId,
      };
      const dbId = insertEvent(event);

      // Push onto open-pre stack for duration pairing
      const stack = getOpenStack(session_id);
      if (!stack.has(tool_name)) stack.set(tool_name, []);
      stack.get(tool_name).push({ dbId, ts });

      // If this is an Agent call, push onto agent stack for parent tracking
      if (tool_name === 'Agent') {
        getAgentStack(session_id).push(dbId);
      }

      const d = depth(session_id) - (tool_name === 'Agent' ? 1 : 0);
      printEvent({ tool: tool_name, phase: 'pre', depth: d >= 0 ? d : 0 });
      broadcast(JSON.stringify({ type: 'event', data: { ...event, id: dbId } }));

    } else if (phase === 'post') {
      const stack = getOpenStack(session_id);
      const preStack = stack.get(tool_name) ?? [];
      const preEntry = preStack.pop() ?? null;
      const duration_ms = preEntry
        ? Math.round(new Date(ts) - new Date(preEntry.ts))
        : null;

      const parentId = currentParentId(session_id);

      // If closing an Agent call, pop the agent stack
      if (tool_name === 'Agent') {
        getAgentStack(session_id).pop();
      }

      const hasError = tool_response?.error != null;
      const event = {
        session_id,
        tool: tool_name,
        phase: 'post',
        input: null,
        output: tool_response ? JSON.stringify(tool_response) : null,
        duration_ms,
        ts,
        parent_event_id: parentId,
      };
      const dbId = insertEvent(event);

      const d = depth(session_id);
      printEvent({ tool: tool_name, phase: 'post', depth: d, duration_ms, hasError });
      broadcast(JSON.stringify({ type: 'event', data: { ...event, id: dbId } }));
    }
  }

  return { handle };
}
