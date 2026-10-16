// Logique pure de la discussion (sans réseau, testable) : nom#, validation de ce qui arrive, bilan partagé, boîte de réception.
import { computeCheckinStats } from '../../supabase/functions/_shared/stats.ts';
import { today, type ChatContact, type ChatMsg, type Snapshot, type Store } from './store';

export const MAX_TEXT = 1000;
const ctrl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export const cleanName = (n: string): string => String(n ?? '').replace(/[\u0000-\u001f\u007f#]/g, '').trim().slice(0, 24) || 'Anonyme';
export const myTag = (s: Store): string => `${cleanName(s.settings.name)}#${s.settings.handle}`;
export const cleanText = (t: unknown, max = MAX_TEXT): string => String(t ?? '').replace(ctrl, '').slice(0, max);

/** « Léo#18428 » -> { name: 'Léo', num: '18428' }. Le nom ET le numéro sont exigés : le nom sert de seconde vérification. */
export function parseTag(raw: string): { name: string; num: string } | null {
  const m = raw.trim().match(/^(.{1,24}?)\s*#\s*(\d{5})$/u);
  return m && m[1].trim() ? { name: cleanName(m[1]), num: m[2] } : null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : null);

/** Un bilan reçu est une donnée NON FIABLE : on ne garde que des nombres bornés et des textes courts. */
export function sanitizeSnapshot(p: unknown): Snapshot | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
  if (!date) return null;
  const cats = Array.isArray(o.categories) ? o.categories.slice(0, 10).map((c) => ({ name: cleanText((c as { name?: unknown })?.name, 40) || '—', avg: num((c as { avg?: unknown })?.avg) })) : [];
  const out: Snapshot = { date, general: num(o.general), categories: cats };
  if (o.empty === true) out.empty = true;
  const pain = o.pain as { score?: unknown; zone?: unknown } | undefined;
  if (pain && typeof pain === 'object') out.pain = { score: num(pain.score), zone: typeof pain.zone === 'string' ? cleanText(pain.zone, 40) : null };
  if (typeof o.note === 'string' && o.note.trim()) out.note = cleanText(o.note, 500);
  return out;
}

/** Bilan du jour à partager : moyennes seulement. Douleur et note n'y figurent que si la personne les a cochées. */
export function buildSnapshot(s: Store, opts: { pain: boolean; note: boolean }): Snapshot {
  const t = today(s);
  const c = s.checkins[t];
  if (!c) return { date: t, general: null, categories: [], empty: true };
  const st = computeCheckinStats(c.answers);
  const snap: Snapshot = { date: t, general: st.general, categories: st.categories.map((x) => ({ name: x.name, avg: x.average })) };
  if (opts.pain && c.pain_score !== null && c.pain_score !== undefined) snap.pain = { score: c.pain_score, zone: c.pain_zone ?? null };
  if (opts.note && c.day_note) snap.note = c.day_note.slice(0, 500);
  return snap;
}

export interface Incoming { id: number; type: string; from: { num: string; name: string }; text?: string; payload?: unknown; ts: string }

export function contactOf(s: Store, n: string, name: string): ChatContact {
  let c = s.chat.contacts.find((x) => x.num === n);
  if (!c) { c = { num: n, name: cleanName(name), last_ts: new Date().toISOString(), unread: 0, blocked: false, always_allow: false }; s.chat.contacts.push(c); }
  return c;
}

export function pushMsg(s: Store, n: string, m: Omit<ChatMsg, 'id'> & { id?: string }): ChatMsg {
  const msg: ChatMsg = { ...m, id: m.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` };
  const th = (s.chat.threads[n] ??= []);
  th.push(msg);
  if (th.length > 300) th.splice(0, th.length - 300);
  return msg;
}

/** Range les messages reçus. Renvoie les numéros à qui répondre automatiquement par un bilan (autorisation permanente). */
export function applyIncoming(s: Store, msgs: Incoming[]): { autoReply: string[] } {
  const autoReply: string[] = [];
  for (const m of msgs) {
    s.chat.last_id = Math.max(s.chat.last_id, Number(m.id) || 0);
    if (!/^\d{5}$/.test(String(m.from?.num))) continue;
    const c = contactOf(s, m.from.num, m.from.name);
    if (c.blocked) continue;
    c.name = cleanName(m.from.name);
    const ts = typeof m.ts === 'string' ? m.ts : new Date().toISOString();
    c.last_ts = ts;
    if (m.type === 'msg') { pushMsg(s, c.num, { t: 'msg', dir: 'in', text: cleanText(m.text), ts }); c.unread++; }
    else if (m.type === 'request') {
      if (c.always_allow) { pushMsg(s, c.num, { t: 'system', dir: 'in', text: `${c.name}#${c.num} a demandé ton bilan : autorisation permanente, il a été envoyé.`, ts }); autoReply.push(c.num); }
      else { pushMsg(s, c.num, { t: 'request', dir: 'in', ts, state: 'pending' }); c.unread++; }
    } else if (m.type === 'snapshot') {
      const snap = sanitizeSnapshot(m.payload);
      if (snap) { pushMsg(s, c.num, { t: 'snapshot', dir: 'in', payload: snap, ts }); c.unread++; }
    } else if (m.type === 'response') { pushMsg(s, c.num, { t: 'response', dir: 'in', text: cleanText(m.text, 300), ts }); c.unread++; }
  }
  return { autoReply };
}

export const unreadTotal = (s: Store): number => s.chat.contacts.reduce((n, c) => n + (c.blocked ? 0 : c.unread), 0);
