export function Header({ sessionId, callCount, live }) {
  return (
    <div style={{
      background: '#161b22', borderBottom: '1px solid #30363d',
      padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 16,
      fontSize: 13,
    }}>
      <span style={{ color: '#58a6ff', fontWeight: 700 }}>Claude Observer</span>
      {sessionId && (
        <>
          <span style={{ color: '#6e7681' }}>|</span>
          <span>Session: <span style={{ color: '#e6edf3' }}>{sessionId.slice(0, 8)}...</span></span>
          <span style={{ color: '#6e7681' }}>{callCount} calls</span>
        </>
      )}
      <span style={{ marginLeft: 'auto', color: live ? '#3fb950' : '#6e7681' }}>
        {live ? '● live' : '○ disconnected'}
      </span>
    </div>
  );
}
