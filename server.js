const http = require('http');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8080;
const sessions = new Map();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200); return res.end('ok');
  }

  if (req.method === 'GET' && url.pathname === '/sse') {
    const sessionId = Math.random().toString(36).slice(2);
    console.log(`[${sessionId}] New SSE connection`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    res.write(`event: endpoint\ndata: /message?sessionId=${sessionId}\n\n`);

    const child = spawn('railway-mcp', [], {
      env: { ...process.env },
    });

    sessions.set(sessionId, { child, res });

    // Heartbeat every 30s to keep SSE connection alive
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
    }, 30000);

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

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      const s = sessions.get(sessionId);
      if (s) { s.child.kill(); sessions.delete(sessionId); }
    };

    child.on('exit', (code) => {
      console.log(`[${sessionId}] Child exited (code ${code})`);
      cleanup();
      try { res.end(); } catch {}
    });

    req.on('close', () => {
      console.log(`[${sessionId}] Client disconnected`);
      cleanup();
    });

    return;
  }

  if (req.method === 'POST' && url.pathname === '/message') {
    const sessionId = url.searchParams.get('sessionId');
    const session = sessions.get(sessionId);

    if (!session || session.child.killed) {
      res.writeHead(400); return res.end('Session not found');
    }

    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        session.child.stdin.write(body + '\n');
        res.writeHead(202); res.end('accepted');
      } catch (e) {
        res.writeHead(500); res.end('Write failed');
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Railway MCP SSE server on port ${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
