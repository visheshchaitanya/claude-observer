import { useState } from 'preact/hooks';

const TOOL_COLORS = {
  Bash: '#f0883e', Read: '#58a6ff', Write: '#3fb950', Edit: '#3fb950',
  Agent: '#bc8cff', Grep: '#79c0ff', Glob: '#79c0ff',
};

const STATUS_STYLES = {
  blocked: { bg: '#f8514922', color: '#f85149', border: '#f8514944', label: 'BLOCKED' },
  ask:     { bg: '#d2992222', color: '#d29922', border: '#d2992244', label: 'ASK' },
  allowed: { bg: '#3fb95022', color: '#3fb950', border: '#3fb95044', label: 'ALLOWED' },
};

function toolColor(tool) {
  return TOOL_COLORS[tool] ?? '#8b949e';
}

function buildTree(events) {
  const byId = new Map();
  const roots = [];

  for (const e of events) {
    byId.set(e.id, { ...e, children: [] });
  }
  for (const e of events) {
    if (e.parent_event_id && byId.has(e.parent_event_id)) {
      byId.get(e.parent_event_id).children.push(byId.get(e.id));
    } else if (!e.parent_event_id) {
      roots.push(byId.get(e.id));
    }
  }

  // Deduplicate: keep only pre-events (merge duration from matching post)
  function merge(nodes) {
    const out = [];
    for (const n of nodes) {
      if (n.phase === 'pre') {
        out.push({ ...n, children: merge(n.children) });
      } else if (n.phase === 'post') {
        const pre = out.findLast(o => o.tool === n.tool && !o._hasDuration);
        if (pre) { pre.duration_ms = n.duration_ms; pre._hasDuration = true; }
      }
    }
    return out;
  }
  return merge(roots);
}

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.allowed;
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      borderRadius: 3, padding: '0px 4px', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.5px',
    }}>
      {s.label}
    </span>
  );
}

function Node({ node, depth, onSelect }) {
  const [collapsed, setCollapsed] = useState(false);
  const color = toolColor(node.tool);
  const hasChildren = node.children?.length > 0;
  const status = node.status ?? 'allowed';

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <div
        onClick={() => onSelect(node)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px',
          cursor: 'pointer', borderRadius: 4, fontSize: 12,
          opacity: status === 'blocked' ? 0.7 : 1,
        }}
      >
        {hasChildren && (
          <span
            onClick={(e) => { e.stopPropagation(); setCollapsed(c => !c); }}
            style={{ color: '#6e7681', userSelect: 'none', width: 12 }}
          >
            {collapsed ? '▶' : '▼'}
          </span>
        )}
        {!hasChildren && <span style={{ width: 12 }} />}
        <span style={{
          background: color + '22', color, border: `1px solid ${color}44`,
          borderRadius: 3, padding: '1px 5px', fontWeight: 600,
        }}>
          {node.display_name ?? node.tool}
        </span>
        <StatusBadge status={status} />
        {node.duration_ms != null && (
          <span style={{ color: '#6e7681' }}>{node.duration_ms}ms</span>
        )}
        {node.input && (() => {
          try {
            const parsed = JSON.parse(node.input);
            const preview = Object.values(parsed)[0]?.toString().slice(0, 60) ?? '';
            return <span style={{ color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{preview}</span>;
          } catch { return null; }
        })()}
      </div>
      {!collapsed && hasChildren && (
        <div>
          {node.children.map((child, i) => (
            <Node key={i} node={child} depth={depth + 1} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CallGraph({ events, onSelect }) {
  const tree = buildTree(events);

  if (tree.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7681', fontSize: 13 }}>
        Waiting for tool calls...
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      {tree.map((node, i) => (
        <Node key={i} node={node} depth={0} onSelect={onSelect} />
      ))}
    </div>
  );
}
