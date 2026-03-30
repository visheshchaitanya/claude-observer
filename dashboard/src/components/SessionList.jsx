export function SessionList({ sessions, activeId, onSelect }) {
  return (
    <div style={{
      width: 180, background: '#0d1117', borderRight: '1px solid #30363d',
      overflowY: 'auto', fontSize: 12, padding: '8px 0',
    }}>
      {sessions.length === 0 && (
        <div style={{ color: '#6e7681', padding: '8px 12px' }}>No sessions yet</div>
      )}
      {sessions.map(s => (
        <div
          key={s.id}
          onClick={() => onSelect(s.id)}
          style={{
            padding: '6px 12px', cursor: 'pointer',
            background: s.id === activeId ? '#161b22' : 'transparent',
            borderLeft: s.id === activeId ? '2px solid #58a6ff' : '2px solid transparent',
            color: s.id === activeId ? '#e6edf3' : '#8b949e',
          }}
        >
          <div style={{ fontFamily: 'monospace' }}>{s.id.slice(0, 10)}...</div>
          <div style={{ color: '#6e7681', marginTop: 2 }}>{s.total_calls} calls</div>
        </div>
      ))}
    </div>
  );
}
