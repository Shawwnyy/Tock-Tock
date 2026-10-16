// Fabrique « Tock Tock.html » : UN SEUL fichier (HTML + CSS + JS), qui s'ouvre par double-clic, sans serveur ni installation.
// Usage : node scripts/build-standalone.mjs [sortie.html]   (nécessite le paquet `esbuild`, installé avec Vite)
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url))); // fileURLToPath : le chemin peut contenir des espaces (« Tock Tock/source »)
// Version « discussion » (TOCK_CHAT=1) : à servir par chat/serveur.mjs. La page ne parle alors qu'à sa propre adresse (CSP « connect-src 'self' »).
const chat = process.env.TOCK_CHAT === '1';
const out = process.argv[2] ?? resolve(root, 'Tock Tock.html');

// Connexion par code (facultatif) : TOCK_AUTH_URL=https://xxxx.supabase.co TOCK_AUTH_KEY=<clé PUBLIQUE « anon » ou « publishable »>.
// Sans ces deux variables (cas par défaut) le fichier est strictement hors ligne : CSP « connect-src 'none' ».
const authUrl = (process.env.TOCK_AUTH_URL ?? '').trim().replace(/\/$/, '');
const authKey = (process.env.TOCK_AUTH_KEY ?? '').trim();
let auth = null;
if (authUrl || authKey) {
  if (!authUrl || !authKey) throw new Error('TOCK_AUTH_URL et TOCK_AUTH_KEY doivent être renseignées ensemble.');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(authUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(authUrl)) throw new Error('TOCK_AUTH_URL : attendu https://<projet>.supabase.co (ou http://127.0.0.1:<port> pour un essai local).');
  // Garde-fou : une clé secrète ne doit JAMAIS finir dans un fichier distribué.
  const secretLike = authKey.startsWith('sb_secret_') || (() => { try { return JSON.parse(Buffer.from(authKey.split('.')[1] ?? '', 'base64url').toString('utf8')).role === 'service_role'; } catch { return false; } })();
  if (secretLike) throw new Error('TOCK_AUTH_KEY est une clé SECRÈTE (service_role / sb_secret_) : refusé. Utilise la clé publique « anon » ou « publishable ».');
  auth = { url: authUrl, key: authKey };
}
const js = await build({
  entryPoints: [resolve(root, 'src/local/main.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
  minify: true, jsx: 'automatic', legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"', __TOCK_AUTH__: JSON.stringify(auth), __TOCK_CHAT__: JSON.stringify(chat) }, loader: { '.ts': 'ts', '.tsx': 'tsx' },
});
const css = await transform(readFileSync(resolve(root, 'src/styles.css'), 'utf8') + '\n' + readFileSync(resolve(root, 'src/local/local.css'), 'utf8'), { loader: 'css', minify: true });
const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src ${[chat ? "'self'" : '', auth ? auth.url : ''].filter(Boolean).join(' ') || "'none'"}; base-uri 'none'; form-action 'none'; object-src 'none'">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#2c5282">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%232c5282'/%3E%3Cpath d='M16 8v8l5 3' stroke='white' stroke-width='3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E">
<title>Tock Tock</title>
<style>${css.code}</style>
</head>
<body>
<div id="root"></div>
<noscript>Tock Tock a besoin de JavaScript pour fonctionner.</noscript>
<script>${script}</script>
</body>
</html>
`;
writeFileSync(out, html);
console.log(`OK : ${out} (${(html.length / 1024).toFixed(0)} Ko)${auth ? ` - connexion par code reliée à ${auth.url}` : ' - hors ligne'}${chat ? ' - version discussion' : ''}`);
