// Telegram relay - runs on the HOST (Windows) and forwards Bot API requests to api.telegram.org.
// Use it when Windows can reach Telegram (e.g. through a VPN) but Docker containers cannot.
//   node tools/telegram-relay.js
// then in .env:  TELEGRAM_API_BASE=http://host.docker.internal:8081
// No dependencies. Listens on 127.0.0.1 only (Docker Desktop forwards host.docker.internal to it).
const http = require('http');
const https = require('https');

const PORT = Number(process.env.RELAY_PORT || 8081);
const HOST = process.env.RELAY_HOST || '127.0.0.1';
const TARGET = 'api.telegram.org';

const server = http.createServer((req, res) => {
  if (!/^\/(bot|file\/bot)[^/]+\//.test(req.url || '')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, description: 'relay: only Bot API paths are forwarded' }));
  }
  const headers = { ...req.headers, host: TARGET };
  delete headers.connection;
  const upstream = https.request({ host: TARGET, port: 443, method: req.method, path: req.url, headers, timeout: 30000 }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
  upstream.on('error', (err) => {
    console.error(new Date().toISOString(), 'relay error:', err.message);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, description: `relay: ${err.message}` }));
  });
  req.pipe(upstream);
  const method = (req.url || '').split('/').pop();
  console.log(new Date().toISOString(), req.method, method);
});

server.listen(PORT, HOST, () => console.log(`Telegram relay listening on http://${HOST}:${PORT} -> https://${TARGET}`));
