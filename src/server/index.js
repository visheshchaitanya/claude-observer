import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDb,
  getDbPath,
  upsertSession,
  insertEvent,
  getAllSessions,
  getEventsBySession,
  insertPolicyDecision,
  seedDefaultSensitivePatterns,
  getPolicyRules,
  getSensitivePatterns,
  getPolicyDecisions,
} from './db.js';
import { evaluateToolCall, buildHookResponse } from './policy.js';
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
  seedDefaultSensitivePatterns(db);

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

    // Policy: POST /policy/evaluate (Claude Code PreToolUse hook)
    if (req.method === 'POST' && url.pathname === '/policy/evaluate') {
      const MAX_BODY = 1_048_576;
      let body = '';
      let bodySize = 0;
      req.on('data', chunk => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY) {
          req.destroy();
          return;
        }
        body += chunk;
      });
      req.on('end', () => {
        try {
          const raw = JSON.parse(body);
          if (typeof raw.tool_name !== 'string' || raw.tool_name.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'tool_name required' }));
            return;
          }
          const toolInputJson = JSON.stringify(raw.tool_input ?? {});
          const result = evaluateToolCall(db, raw);
          insertPolicyDecision(db, {
            event_id: null,
            session_id: typeof raw.session_id === 'string' ? raw.session_id : null,
            rule_id: result.ruleId,
            tool_name: raw.tool_name,
            tool_input: toolInputJson,
            matched_pattern: result.matchedPattern,
            decision: result.decision,
            reason: result.reason,
          });
          const response = buildHookResponse(result);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
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

    // REST: GET /policy/rules
    if (req.method === 'GET' && url.pathname === '/policy/rules') {
      const rules = getPolicyRules(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rules));
      return;
    }

    // REST: GET /policy/patterns
    if (req.method === 'GET' && url.pathname === '/policy/patterns') {
      const patterns = getSensitivePatterns(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(patterns));
      return;
    }

    // REST: GET /policy/decisions
    if (req.method === 'GET' && url.pathname === '/policy/decisions') {
      const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
      const allDecisions = getPolicyDecisions(db);
      const decisions = allDecisions.slice(0, limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(decisions));
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
      httpServer.listen(port, '127.0.0.1', () => {
        const addr = httpServer.address();
        const actual = typeof addr === 'object' && addr ? addr.port : port;
        resolve(actual);
      });
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
