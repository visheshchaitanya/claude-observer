import { useState, useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';

const activeTab = signal('rules');
const rules = signal([]);
const patterns = signal([]);
const decisions = signal([]);
const loading = signal(false);

const styles = {
  panel: {
    background: '#0d1117',
    borderTop: '1px solid #30363d',
    maxHeight: '300px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    background: '#161b22',
    borderBottom: '1px solid #30363d',
    gap: '8px',
  },
  title: {
    color: '#58a6ff',
    fontWeight: 700,
    fontSize: '13px',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    marginLeft: '16px',
  },
  tab: {
    padding: '4px 12px',
    background: 'transparent',
    border: '1px solid #30363d',
    borderRadius: '6px',
    color: '#8b949e',
    cursor: 'pointer',
    fontSize: '12px',
  },
  tabActive: {
    background: '#21262d',
    color: '#e6edf3',
    borderColor: '#58a6ff',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '8px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px',
  },
  th: {
    textAlign: 'left',
    padding: '6px 8px',
    borderBottom: '1px solid #30363d',
    color: '#8b949e',
    fontWeight: 600,
  },
  td: {
    padding: '6px 8px',
    borderBottom: '1px solid #21262d',
    color: '#e6edf3',
  },
  badge: {
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 600,
  },
  badgeAllow: {
    background: '#238636',
    color: '#fff',
  },
  badgeDeny: {
    background: '#da3633',
    color: '#fff',
  },
  badgeAsk: {
    background: '#9e6a03',
    color: '#fff',
  },
  badgeWarn: {
    background: '#6e7681',
    color: '#fff',
  },
  toggle: {
    width: '36px',
    height: '20px',
    borderRadius: '10px',
    background: '#21262d',
    border: '1px solid #30363d',
    cursor: 'pointer',
    position: 'relative',
  },
  toggleEnabled: {
    background: '#238636',
    borderColor: '#238636',
  },
  toggleKnob: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    background: '#e6edf3',
    position: 'absolute',
    top: '1px',
    left: '1px',
    transition: 'left 0.15s',
  },
  toggleKnobEnabled: {
    left: '17px',
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: '#7ee787',
  },
  empty: {
    color: '#6e7681',
    textAlign: 'center',
    padding: '24px',
  },
  refreshBtn: {
    marginLeft: 'auto',
    padding: '4px 8px',
    background: '#21262d',
    border: '1px solid #30363d',
    borderRadius: '6px',
    color: '#8b949e',
    cursor: 'pointer',
    fontSize: '11px',
  },
};

function Badge({ action }) {
  const badgeStyle = {
    ...styles.badge,
    ...(action === 'allow' ? styles.badgeAllow : {}),
    ...(action === 'deny' ? styles.badgeDeny : {}),
    ...(action === 'ask' ? styles.badgeAsk : {}),
    ...(action === 'warn' ? styles.badgeWarn : {}),
  };
  return <span style={badgeStyle}>{action}</span>;
}

function Toggle({ enabled }) {
  const toggleStyle = {
    ...styles.toggle,
    ...(enabled ? styles.toggleEnabled : {}),
  };
  const knobStyle = {
    ...styles.toggleKnob,
    ...(enabled ? styles.toggleKnobEnabled : {}),
  };
  return (
    <div style={toggleStyle}>
      <div style={knobStyle} />
    </div>
  );
}

function RulesTable() {
  if (rules.value.length === 0) {
    return <div style={styles.empty}>No policy rules configured</div>;
  }
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Enabled</th>
          <th style={styles.th}>Type</th>
          <th style={styles.th}>Pattern</th>
          <th style={styles.th}>Tool</th>
          <th style={styles.th}>Action</th>
          <th style={styles.th}>Priority</th>
        </tr>
      </thead>
      <tbody>
        {rules.value.map((rule) => (
          <tr key={rule.id}>
            <td style={styles.td}><Toggle enabled={rule.enabled} /></td>
            <td style={styles.td}>{rule.rule_type}</td>
            <td style={styles.td}><code style={styles.mono}>{rule.pattern}</code></td>
            <td style={styles.td}><code style={styles.mono}>{rule.tool_matcher}</code></td>
            <td style={styles.td}><Badge action={rule.action} /></td>
            <td style={styles.td}>{rule.priority}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PatternsTable() {
  if (patterns.value.length === 0) {
    return <div style={styles.empty}>No sensitive patterns configured</div>;
  }
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Enabled</th>
          <th style={styles.th}>Pattern</th>
          <th style={styles.th}>Category</th>
          <th style={styles.th}>Description</th>
          <th style={styles.th}>Action</th>
        </tr>
      </thead>
      <tbody>
        {patterns.value.map((p) => (
          <tr key={p.id}>
            <td style={styles.td}><Toggle enabled={p.enabled} /></td>
            <td style={styles.td}><code style={styles.mono}>{p.pattern}</code></td>
            <td style={styles.td}>{p.category || '-'}</td>
            <td style={styles.td}>{p.description || '-'}</td>
            <td style={styles.td}><Badge action={p.action} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AuditTable() {
  if (decisions.value.length === 0) {
    return <div style={styles.empty}>No policy decisions recorded yet</div>;
  }
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Time</th>
          <th style={styles.th}>Tool</th>
          <th style={styles.th}>Decision</th>
          <th style={styles.th}>Pattern</th>
          <th style={styles.th}>Reason</th>
        </tr>
      </thead>
      <tbody>
        {decisions.value.map((d) => (
          <tr key={d.id}>
            <td style={styles.td}>{formatTime(d.created_at)}</td>
            <td style={styles.td}><code style={styles.mono}>{d.tool_name}</code></td>
            <td style={styles.td}><Badge action={d.decision} /></td>
            <td style={styles.td}>
              {d.matched_pattern ? <code style={styles.mono}>{d.matched_pattern}</code> : '-'}
            </td>
            <td style={styles.td}>{d.reason || '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleTimeString();
}

async function fetchData() {
  loading.value = true;
  try {
    const [rulesRes, patternsRes, decisionsRes] = await Promise.all([
      fetch('/policy/rules'),
      fetch('/policy/patterns'),
      fetch('/policy/decisions?limit=100'),
    ]);
    rules.value = await rulesRes.json();
    patterns.value = await patternsRes.json();
    decisions.value = await decisionsRes.json();
  } catch (err) {
    console.error('Failed to fetch policy data:', err);
  } finally {
    loading.value = false;
  }
}

export function PolicyPanel({ expanded, onToggle }) {
  useEffect(() => {
    if (expanded) {
      fetchData();
    }
  }, [expanded]);

  if (!expanded) {
    return (
      <div
        style={{
          background: '#161b22',
          borderTop: '1px solid #30363d',
          padding: '8px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
        }}
        onClick={onToggle}
      >
        <span style={styles.title}>Policy Panel</span>
        <span style={{ color: '#6e7681', marginLeft: '8px', fontSize: '12px' }}>
          Click to expand
        </span>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title} onClick={onToggle}>Policy Panel</span>
        <div style={styles.tabs}>
          {['rules', 'patterns', 'audit'].map((tab) => (
            <button
              key={tab}
              style={{
                ...styles.tab,
                ...(activeTab.value === tab ? styles.tabActive : {}),
              }}
              onClick={() => { activeTab.value = tab; }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <button style={styles.refreshBtn} onClick={fetchData}>
          {loading.value ? 'Loading...' : 'Refresh'}
        </button>
        <button
          style={{ ...styles.refreshBtn, marginLeft: '4px' }}
          onClick={onToggle}
        >
          Collapse
        </button>
      </div>
      <div style={styles.content}>
        {activeTab.value === 'rules' && <RulesTable />}
        {activeTab.value === 'patterns' && <PatternsTable />}
        {activeTab.value === 'audit' && <AuditTable />}
      </div>
    </div>
  );
}
