// Relais de discussion de Tock Tock : SANS compte, SANS base de données, SANS dépendance.
//  - Chaque appareil a un nom# (ex. Léo#18428) et une clé secrète aléatoire gardée sur l'appareil. Le relais retient la
//    PREMIÈRE clé vue pour un numéro (« premier arrivé, premier servi ») : personne d'autre ne peut écrire ni lire à sa place.
//  - Les messages ne sont conservés qu'EN MÉMOIRE (24 h au plus, effacés dès que le destinataire les a reçus, perdus au redémarrage).
//  - Il n'y a ni annuaire, ni salon public : on ne peut écrire qu'à quelqu'un dont on connaît le nom#.
//  - Ce n'est PAS du chiffrement de bout en bout : celui qui fait tourner le relais pourrait lire les messages en transit.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const NUM = /^\d{5}$/;
const TYPES = new Set(['msg', 'request', 'snapshot', 'response']);
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f#]/g, '').trim().slice(0, 24);
const sha = (t) => createHash('sha256').update(String(t)).digest();

export function createRelay({ now = () => Date.now(), limits = {} } = {}) {
  const L = { msgPerMin: 30, requestsPerHour: 10, helloPerHour: 20, maxText: 1000, maxPayload: 20000, queueMax: 500, ttlMs: 86400000, maxUsers: 5000, ...limits };
  const epoch = randomBytes(6).toString('hex'); // change à chaque redémarrage : les clients repartent alors de zéro
  let seq = 0;
  const users = new Map(); // num -> { name, hash }
  const queues = new Map(); // num -> messages en attente
  const blocks = new Map(); // num -> Set(num bloqués)
  const rate = new Map();

  const hit = (key, max, windowMs) => {
    const t = now();
    const arr = (rate.get(key) ?? []).filter((x) => t - x < windowMs);
    if (arr.length >= max) { rate.set(key, arr); return false; }
    arr.push(t); rate.set(key, arr); return true;
  };
  const err = (status, error) => ({ status, json: { ok: false, error } });
  const ok = (extra = {}) => ({ status: 200, json: { ok: true, ...extra } });
  const auth = (num, token) => {
    if (!NUM.test(String(num))) return { e: err(400, 'bad_number') };
    const u = users.get(String(num));
    if (!u) return { e: err(401, 'unknown_user') };
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) return { e: err(403, 'bad_token') };
    const h = sha(token);
    if (h.length !== u.hash.length || !timingSafeEqual(h, u.hash)) return { e: err(403, 'bad_token') };
    return { u, num: String(num) };
  };

  function api(route, body = {}, ctx = {}) {
    const b = body && typeof body === 'object' ? body : {};
    switch (route) {
      case 'ping': return ok({ epoch, users: users.size });
      case 'hello': {
        const num = String(b.num ?? '');
        if (!NUM.test(num)) return err(400, 'bad_number');
        if (typeof b.token !== 'string' || b.token.length < 16 || b.token.length > 128) return err(400, 'bad_token');
        if (!hit(`hello:${ctx.ip ?? '-'}`, L.helloPerHour, 3600000)) return err(429, 'rate_limit');
        const name = cleanName(b.name) || 'Anonyme';
        const u = users.get(num);
        if (u) {
          if (!timingSafeEqual(sha(b.token), u.hash)) return err(409, 'taken'); // ce numéro appartient déjà à un autre appareil
          u.name = name; return ok({ epoch });
        }
        if (users.size >= L.maxUsers) return err(503, 'full');
        users.set(num, { name, hash: sha(b.token) });
        return ok({ epoch });
      }
      case 'send': {
        const a = auth(b.num, b.token); if (a.e) return a.e;
        if (!TYPES.has(b.type)) return err(400, 'bad_type');
        const to = b.to && typeof b.to === 'object' ? b.to : {};
        const dest = users.get(String(to.num ?? ''));
        // Même réponse que le numéro n'existe pas ou que le nom ne correspond pas : on ne révèle rien sur les comptes.
        if (!dest || norm(dest.name) !== norm(to.name) || String(to.num) === a.num) return err(404, 'unknown_recipient');
        let text; let payload;
        if (b.type === 'msg' || b.type === 'response') {
          text = String(b.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
          if (b.type === 'msg' && !text) return err(400, 'empty');
          if (text.length > L.maxText) return err(413, 'too_long');
        }
        if (b.type === 'snapshot' || b.type === 'response') {
          if (b.payload !== undefined && b.payload !== null) {
            const raw = JSON.stringify(b.payload);
            if (raw.length > L.maxPayload) return err(413, 'too_big');
            payload = JSON.parse(raw);
          }
        }
        if (b.type === 'request' ? !hit(`req:${a.num}`, L.requestsPerHour, 3600000) : !hit(`msg:${a.num}`, L.msgPerMin, 60000)) return err(429, 'rate_limit');
        if (blocks.get(String(to.num))?.has(a.num)) return ok(); // bloqué : abandon silencieux (l'expéditeur ne le sait pas)
        const q = queues.get(String(to.num)) ?? [];
        q.push({ id: ++seq, type: b.type, from: { num: a.num, name: a.u.name }, text, payload, ts: new Date(now()).toISOString(), at: now() });
        while (q.length > L.queueMax) q.shift();
        queues.set(String(to.num), q);
        return ok({ id: seq });
      }
      case 'poll': {
        const a = auth(b.num, b.token); if (a.e) return a.e;
        const after = b.epoch === epoch ? Number(b.after) || 0 : 0;
        const t = now();
        const q = (queues.get(a.num) ?? []).filter((m) => m.id > after && t - m.at < L.ttlMs);
        queues.set(a.num, q); // tout ce qui a déjà été reçu (id <= after) est effacé du relais
        return ok({ epoch, messages: q.map(({ at, ...m }) => m) });
      }
      case 'block': {
        const a = auth(b.num, b.token); if (a.e) return a.e;
        if (!NUM.test(String(b.target))) return err(400, 'bad_number');
        const set = blocks.get(a.num) ?? new Set(); set.add(String(b.target)); blocks.set(a.num, set);
        queues.set(a.num, (queues.get(a.num) ?? []).filter((m) => m.from.num !== String(b.target)));
        return ok();
      }
      default: return err(404, 'not_found');
    }
  }
  return { api, epoch };
}
