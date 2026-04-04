const http = require('http');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8080;
const MAX_SESSIONS = 20;
const MAX_BODY_SIZE = 1024 * 1024; // 1MB
const HEARTBEAT_MS = 30000;

const sessions = new Map();

// Nunca crashea por excepciones no capturadas
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err.message));
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

// Graceful shutdown cuando Railway para el contenedor
const shutdown = () => {
  console.log(`Shutting down. Active sessions: ${sessions.size}`);
  server.close();
  for (const [id, s] of sessions) {
    try { s.child.kill(); } catch {}
    console.log(`[${id}] Killed on shutdown`);
  }
  setTimeout(() => process.exit(0), 5000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // Health check con info de sesiones activas
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', sessions: sessions.size, maxSessions: MAX_SESSIONS }));
  }

  if (req.method === 'GET' && url.pathname === '/sse') {
    // Limite de sesiones simultaneas
    if (sessions.size >= MAX_SESSIONS) {
      res.writeHead(503); return res.end('Max sessions reached');
    }

    const sessionId = Math.random().toString(36).slice(2);
    console.log(`[${sessionId}] New connection. Active: ${sessions.size + 1}`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    res.write(`event: endpoint\ndata: /message?sessionId=${sessionId}\n\n`);

    const child = spawn('railway-mcp', [], {
      env: { ...process.env },
    });

    // Heartbeat para mantener conexion SSE activa
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
    }, HEARTBEAT_MS);

    sessions.set(sessionId, { child, res });

    // Buffer para mensajes que llegan en multiples chunks TCP
    let buffer = '';
    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.filter(Boolean).forEach(line => {
        try { res.write(`data: ${line}\n\n`); } catch {}
      });
    });

    child.stderr.on('data', (d) => process.stderr.write(d));

    // Flag para evitar doble cleanup
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      const s = sessions.get(sessionId);
      if (s) { try { s.child.kill(); } catch {} sessions.delete(sessionId); }
      console.log(`[${sessionId}] Cleaned. Active: ${sessions.size}`);
    };

    child.on('exit', (code) => { cleanup(); try { res.end(); } catch {} });
    child.on('error', (err) => { console.error(`[${sessionId}] Child error:`, err.message); cleanup(); try { res.end(); } catch {} });
    req.on('close', () => cleanup());

    return;
  }

  if (req.method === 'POST' && url.pathname === '/message') {
    const session = sessions.get(url.searchParams.get('sessionId'));

    if (!session || session.child.killed) {
      res.writeHead(400); return res.end('Session not found');
    }

    // Limite de tamano de request
    let body = '', size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_SIZE) { res.writeHead(413); res.end('Payload too large'); req.destroy(); return; }
      body += c;
    });
    req.on('end', () => {
      try {
        session.child.stdin.write(body + '\n');
        res.writeHead(202); res.end('accepted');
      } catch (e) {
        console.error('Write failed:', e.message);
        res.writeHead(500); res.end('Write failed');
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Railway MCP SSE on port ${PORT} | Max: ${MAX_SESSIONS} sessions | Heartbeat: ${HEARTBEAT_MS / 1000}s`);
});
