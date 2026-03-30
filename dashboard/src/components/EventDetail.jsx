export function EventDetail({ event }) {
  if (!event) {
    return (
      <div style={{
        height: 100, background: '#161b22', borderTop: '1px solid #30363d',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#6e7681', fontSize: 12,
      }}>
        Click a node to inspect its input/output
      </div>
    );
  }

  function pretty(str) {
    if (!str) return '—';
    try { return JSON.stringify(JSON.parse(str), null, 2); }
    catch { return str; }
  }

  return (
    <div style={{
      height: 180, background: '#161b22', borderTop: '1px solid #30363d',
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', fontSize: 11,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '8px 12px', borderRight: '1px solid #30363d', overflow: 'auto' }}>
        <div style={{ color: '#6e7681', marginBottom: 4 }}>TOOL</div>
        <div style={{ color: '#e6edf3', fontWeight: 600 }}>{event.tool}</div>
        <div style={{ color: '#6e7681', marginTop: 8 }}>DURATION</div>
        <div>{event.duration_ms != null ? `${event.duration_ms}ms` : '—'}</div>
        <div style={{ color: '#6e7681', marginTop: 8 }}>TIME</div>
        <div>{event.ts?.slice(11, 19) ?? '—'}</div>
      </div>
      <div style={{ padding: '8px 12px', borderRight: '1px solid #30363d', overflow: 'auto' }}>
        <div style={{ color: '#6e7681', marginBottom: 4 }}>INPUT</div>
        <pre style={{ fontSize: 10, color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {pretty(event.input)}
        </pre>
      </div>
      <div style={{ padding: '8px 12px', overflow: 'auto' }}>
        <div style={{ color: '#6e7681', marginBottom: 4 }}>OUTPUT</div>
        <pre style={{ fontSize: 10, color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {pretty(event.output)}
        </pre>
      </div>
    </div>
  );
}
