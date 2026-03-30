/**
 * createEventProcessor returns a stateful event handler.
 *
 * Agent calls are always top-level (parent_event_id = null). Claude Code runs
 * all hooks from the same parent process, so $PPID cannot distinguish parallel
 * from nested agents. Non-Agent tools are parented to the most recently active
 * open Agent via a last-activity heuristic.
 *
 * deps: { upsertSession, insertEvent, broadcast, printEvent }
 */
export function createEventProcessor({ upsertSession, insertEvent, broadcast, printEvent }) {
  // Map<sessionId, Map<toolName, { dbId, ts, displayName }[]>>
  const openPre = new Map();

  // Map<sessionId, Map<agentDbId, { lastActivityTs }>>
  const openAgents = new Map();

  function getOpenStack(sessionId) {
    if (!openPre.has(sessionId)) openPre.set(sessionId, new Map());
    return openPre.get(sessionId);
  }

  function getOpenAgents(sessionId) {
    if (!openAgents.has(sessionId)) openAgents.set(sessionId, new Map());
    return openAgents.get(sessionId);
  }

  function findActiveParentAgent(sessionId) {
    const agents = getOpenAgents(sessionId);
    if (agents.size === 0) return null;
    let bestId = null;
    let bestTs = null;
    for (const [agentDbId, info] of agents) {
      if (bestTs === null || info.lastActivityTs > bestTs) {
        bestTs = info.lastActivityTs;
        bestId = agentDbId;
      }
    }
    return bestId;
  }

  function resolveParentId(sessionId, toolName) {
    // Agent calls are always top-level
    if (toolName === 'Agent') return null;
    // Non-Agent tools: parent is the most recently active open Agent
    return findActiveParentAgent(sessionId);
  }

  function currentDepth(sessionId) {
    return findActiveParentAgent(sessionId) !== null ? 1 : 0;
  }

  function computeDisplayName(tool_name, tool_input) {
    if (tool_name === 'Agent') {
      const agentLabel = tool_input?.subagent_type
        ?? tool_input?.description
        ?? 'Agent';
      return `AGENT:${agentLabel}`;
    }
    return `TOOL:${tool_name}`;
  }

  function handle(raw) {
    const { phase, session_id, tool_name, tool_input, tool_response, ppid } = raw;
    const ts = new Date().toISOString();

    upsertSession(session_id);

    if (phase === 'pre') {
      const parentId = resolveParentId(session_id, tool_name);
      const displayName = computeDisplayName(tool_name, tool_input);
      const event = {
        session_id,
        tool: tool_name,
        phase: 'pre',
        input: tool_input ? JSON.stringify(tool_input) : null,
        output: null,
        duration_ms: null,
        ts,
        parent_event_id: parentId,
        display_name: displayName,
        ppid: ppid ?? null,
      };
      const dbId = insertEvent(event);

      const stack = getOpenStack(session_id);
      if (!stack.has(tool_name)) stack.set(tool_name, []);
      stack.get(tool_name).push({ dbId, ts, displayName });

      if (tool_name === 'Agent') {
        getOpenAgents(session_id).set(dbId, { lastActivityTs: ts });
      } else if (parentId !== null) {
        const info = getOpenAgents(session_id).get(parentId);
        if (info) info.lastActivityTs = ts;
      }

      const d = tool_name === 'Agent' ? 0 : currentDepth(session_id);
      printEvent({ tool: tool_name, displayName, phase: 'pre', depth: d });
      broadcast(JSON.stringify({ type: 'event', data: { ...event, id: dbId } }));

    } else if (phase === 'post') {
      const stack = getOpenStack(session_id);
      const preStack = stack.get(tool_name) ?? [];
      const preEntry = preStack.pop() ?? null;
      const duration_ms = preEntry
        ? Math.round(new Date(ts) - new Date(preEntry.ts))
        : null;

      const displayName = preEntry?.displayName ?? computeDisplayName(tool_name, null);

      let parentId = null;
      if (tool_name === 'Agent' && preEntry) {
        parentId = null;
        getOpenAgents(session_id).delete(preEntry.dbId);
      } else {
        parentId = findActiveParentAgent(session_id);
        if (parentId !== null) {
          const info = getOpenAgents(session_id).get(parentId);
          if (info) info.lastActivityTs = ts;
        }
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
        display_name: displayName,
        ppid: ppid ?? null,
      };
      const dbId = insertEvent(event);

      const d = tool_name === 'Agent' ? 0 : currentDepth(session_id);
      printEvent({ tool: tool_name, displayName, phase: 'post', depth: d, duration_ms, hasError });
      broadcast(JSON.stringify({ type: 'event', data: { ...event, id: dbId } }));
    }
  }

  return { handle };
}
