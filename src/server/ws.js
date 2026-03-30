import { WebSocketServer } from 'ws';

export function createWsServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });

  function broadcast(message) {
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(message);
      }
    }
  }

  wss.on('connection', (ws) => {
    ws.on('error', () => {}); // ignore client errors
  });

  return { wss, broadcast };
}
