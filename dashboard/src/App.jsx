import { useEffect } from 'preact/hooks';
import { connect, sessions, events, activeSessionId, connected, switchSession } from './ws.js';
import { SessionList } from './components/SessionList.jsx';
import { CallGraph } from './components/CallGraph.jsx';
import { EventDetail } from './components/EventDetail.jsx';
import { Header } from './components/Header.jsx';
import { signal } from '@preact/signals';

export const selectedEvent = signal(null);

export function App() {
  useEffect(() => { connect(); }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header
        sessionId={activeSessionId.value}
        callCount={sessions.value.find(s => s.id === activeSessionId.value)?.total_calls ?? 0}
        live={connected.value}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <SessionList
          sessions={sessions.value}
          activeId={activeSessionId.value}
          onSelect={switchSession}
        />
        <CallGraph
          events={events.value}
          onSelect={(e) => { selectedEvent.value = e; }}
        />
      </div>
      <EventDetail event={selectedEvent.value} />
    </div>
  );
}
