import { signal } from '@preact/signals';

export const events = signal([]);
export const sessions = signal([]);
export const activeSessionId = signal(null);
export const connected = signal(false);

let ws = null;
let reconnectTimer = null;

async function fetchSessions() {
  try {
    const res = await fetch('/sessions');
    const data = await res.json();
    sessions.value = data;
    if (!activeSessionId.value && data.length > 0) {
      activeSessionId.value = data[0].id;
      fetchSessionEvents(data[0].id);
    }
  } catch {}
}

async function fetchSessionEvents(sessionId) {
  try {
    const res = await fetch(`/sessions/${sessionId}/events`);
    const data = await res.json();
    events.value = data;
  } catch {}
}

export function switchSession(sessionId) {
  activeSessionId.value = sessionId;
  fetchSessionEvents(sessionId);
}

export function connect() {
  if (ws) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    connected.value = true;
    clearTimeout(reconnectTimer);
    fetchSessions();
  };

  ws.onmessage = (msg) => {
    try {
      const { type, data } = JSON.parse(msg.data);
      if (type === 'event') {
        if (data.session_id === activeSessionId.value) {
          events.value = [...events.value, data];
        }
        fetchSessions();
      }
    } catch {}
  };

  ws.onclose = () => {
    connected.value = false;
    ws = null;
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = () => { ws?.close(); };
}
