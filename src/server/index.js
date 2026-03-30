import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, getDbPath, upsertSession, insertEvent, getAllSessions, getEventsBySession } from './db.js';
import { createWsServer } from './ws.js';
import { createEventProcessor } from './events.js';
import { printEvent, printSessionStart } from './stream.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DASHBOARD_DIR = resolve(__dirname, '../../dashboard/dist');

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

export function createObserverServer(port = 4242) {
  const db = createDb(getDbPath());

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // Event ingestion endpoint
    if (req.method === 'POST' && url.pathname === '/event') {
      const phase = url.searchParams.get('phase') ?? 'pre';
      const ppid = url.searchParams.get('ppid') ?? null;
      const MAX_BODY = 1_048_576; // 1MB
      let body = '';
      let bodySize = 0;
      req.on('data', chunk => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY) { req.destroy(); return; }
        body += chunk;
      });
      req.on('end', () => {
        try {
          const raw = JSON.parse(body);
          if (typeof raw.session_id === 'string' && typeof raw.tool_name === 'string') {
            processor.handle({ ...raw, phase, ppid });
          }
        } catch {
          // Malformed hook payload — ignore silently, never block Claude
        }
        res.writeHead(204).end();
      });
      return;
    }

    // REST: GET /sessions
    if (req.method === 'GET' && url.pathname === '/sessions') {
      const sessions = getAllSessions(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
      return;
    }

    // REST: GET /sessions/:id/events
    const eventsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/events$/);
    if (req.method === 'GET' && eventsMatch) {
      const events = getEventsBySession(db, eventsMatch[1]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(events));
      return;
    }

    // Static dashboard files
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    const fullPath = resolve(join(DASHBOARD_DIR, filePath));
    if (!fullPath.startsWith(DASHBOARD_DIR)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (existsSync(fullPath)) {
      const ext = extname(fullPath);
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(readFileSync(fullPath));
    } else {
      // SPA fallback
      const indexPath = join(DASHBOARD_DIR, 'index.html');
      if (existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(readFileSync(indexPath));
      } else {
        res.writeHead(404).end('Dashboard not built yet');
      }
    }
  });

  const { wss, broadcast } = createWsServer(httpServer);

  let processor;
  processor = createEventProcessor({
    upsertSession: (sessionId) => upsertSession(db, sessionId),
    insertEvent: (event) => insertEvent(db, event),
    broadcast,
    printEvent,
  });

  function start() {
    return new Promise((resolve, reject) => {
      httpServer.listen(port, '127.0.0.1', () => resolve(port));
      httpServer.on('error', reject);
    });
  }

  function stop() {
    return new Promise((resolve) => {
      // Close all WebSocket connections immediately
      for (const client of wss.clients) {
        client.terminate();
      }
      // Close HTTP server with a 1s timeout fallback
      const timeout = setTimeout(() => {
        db.close();
        resolve();
      }, 1000);
      httpServer.close(() => {
        clearTimeout(timeout);
        db.close();
        resolve();
      });
    });
  }

  return { start, stop, db };
}
