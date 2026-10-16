// Serveur de discussion Tock Tock : sert la page « Tock Tock.html » ET le relais, sur le même adresse (pas de CORS, pas de compte).
// Lancer :  node serveur.mjs        (Node.js 18 ou plus)         Variables : PORT (8787), HOST (0.0.0.0), PAGE (chemin du html)
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay } from './relay.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const candidates = [process.env.PAGE, resolve(here, 'Tock Tock.html'), resolve(here, '..', 'Tock Tock (discussion).html')].filter(Boolean);
const pagePath = candidates.find((p) => existsSync(p));
if (!pagePath) { console.error('Page introuvable : place « Tock Tock.html » (version discussion) à côté de serveur.mjs.'); process.exit(1); }
const relay = createRelay();
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SEC }); return res.end(readFileSync(pagePath));
  }
  if (req.method === 'POST' && url.startsWith('/api/')) {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 65536) { res.writeHead(413, SEC); res.end(); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (res.writableEnded) return;
      let body = {};
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { res.writeHead(400, { 'Content-Type': 'application/json', ...SEC }); return res.end('{"ok":false,"error":"bad_json"}'); }
      const out = relay.api(url.slice(5), body, { ip: req.socket.remoteAddress });
      res.writeHead(out.status, { 'Content-Type': 'application/json', ...SEC }); res.end(JSON.stringify(out.json));
    });
    return;
  }
  res.writeHead(404, SEC); res.end('Introuvable');
});
server.listen(PORT, HOST, () => {
  console.log('\nTock Tock - discussion en marche. Ouvre :');
  console.log(`  sur cet ordinateur : http://localhost:${PORT}/`);
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) console.log(`  sur ton réseau Wi-Fi : http://${i.address}:${PORT}/`);
  console.log('\nRappels : les messages ne sont gardés qu\'en mémoire et ne sont PAS chiffrés de bout en bout ; HTTP simple : à utiliser entre personnes de confiance, sur un réseau de confiance.');
  console.log('Arrêt : Ctrl + C\n');
});
