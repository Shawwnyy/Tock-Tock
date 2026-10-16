// Dialogue avec le relais de discussion (même adresse que la page). Aucune clé de compte : seulement la clé secrète de CET appareil.
import { useSyncExternalStore } from 'react';
import { applyIncoming, buildSnapshot, cleanName, contactOf, pushMsg, type Incoming } from './chat';
import { getState, randomHandle, update, type Snapshot } from './store';

declare const __TOCK_CHAT__: boolean | undefined;
export const chatAvailable: boolean = typeof __TOCK_CHAT__ !== 'undefined' && !!__TOCK_CHAT__;

type Res = { ok: boolean; status: number; json: Record<string, unknown> };
async function post(route: string, body: unknown): Promise<Res> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
  try {
    const r = await fetch(`/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl?.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    let json: Record<string, unknown> = {};
    try { json = (await r.json()) as Record<string, unknown>; } catch { /* corps vide */ }
    return { ok: r.ok && json.ok !== false, status: r.status, json };
  } catch { return { ok: false, status: 0, json: { error: 'network' } }; } finally { if (timer) clearTimeout(timer); }
}

// État de connexion, observable par l'interface.
export type ChatStatus = 'idle' | 'online' | 'offline' | 'error';
let status: ChatStatus = 'idle';
const subs = new Set<() => void>();
const setStatus = (s: ChatStatus) => { if (s !== status) { status = s; subs.forEach((f) => f()); } };
export const useChatStatus = (): ChatStatus => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => status);

export function randomToken(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function explain(r: Res): string {
  const e = String(r.json.error ?? '');
  if (r.status === 0) return 'Le serveur de discussion est injoignable. Vérifie qu\'il tourne et que tu es sur le même réseau.';
  if (e === 'unknown_recipient') return 'Personne ne correspond à ce nom#. Vérifie l\'orthographe et le numéro, et que cette personne a activé la discussion.';
  if (e === 'rate_limit') return 'Trop de messages ou de demandes en peu de temps. Patiente un peu.';
  if (e === 'too_long' || e === 'too_big') return 'Ce message est trop long.';
  if (e === 'empty') return 'Le message est vide.';
  return 'L\'envoi n\'a pas pu aboutir. Réessaie dans un instant.';
}

/** Réserve (ou retrouve) mon numéro auprès du relais. Si un autre appareil l'a déjà pris, un autre numéro est tiré. */
export async function claim(): Promise<{ ok: boolean; message?: string }> {
  for (let i = 0; i < 6; i++) {
    const s = getState();
    const r = await post('hello', { num: s.settings.handle, name: cleanName(s.settings.name), token: s.chat.token });
    if (r.ok) { update((n) => { n.chat.epoch = String(r.json.epoch ?? ''); }); setStatus('online'); return { ok: true }; }
    if (r.status === 409) { update((n) => { n.settings.handle = randomHandle(); }); continue; }
    setStatus(r.status === 0 ? 'offline' : 'error');
    return { ok: false, message: explain(r) };
  }
  return { ok: false, message: 'Impossible de réserver un numéro libre. Réessaie.' };
}

export async function enableChat(): Promise<{ ok: boolean; message?: string }> {
  update((n) => { n.chat.token ??= randomToken(); });
  const r = await claim();
  if (r.ok) update((n) => { n.chat.enabled = true; n.chat.adult_ack = true; });
  return r;
}

async function sendRaw(to: { num: string; name: string }, type: string, extra: { text?: string; payload?: unknown } = {}): Promise<{ ok: boolean; message?: string }> {
  const go = () => { const s = getState(); return post('send', { num: s.settings.handle, token: s.chat.token, to, type, ...extra }); };
  let r = await go();
  if (r.status === 401) { const c = await claim(); if (c.ok) r = await go(); }
  return r.ok ? { ok: true } : { ok: false, message: explain(r) };
}

export async function sendText(to: { num: string; name: string }, text: string) {
  const r = await sendRaw(to, 'msg', { text });
  if (r.ok) update((n) => { const c = contactOf(n, to.num, to.name); c.last_ts = new Date().toISOString(); pushMsg(n, to.num, { t: 'msg', dir: 'out', text, ts: c.last_ts }); });
  return r;
}

export async function requestBilan(to: { num: string; name: string }) {
  const r = await sendRaw(to, 'request');
  if (r.ok) update((n) => { pushMsg(n, to.num, { t: 'system', dir: 'out', text: 'Tu as demandé à voir son bilan du jour. Il faut qu\'elle ou il l\'autorise.', ts: new Date().toISOString() }); });
  return r;
}

export async function sendSnapshot(to: { num: string; name: string }, opts: { pain: boolean; note: boolean }) {
  const snap: Snapshot = buildSnapshot(getState(), opts);
  const r = await sendRaw(to, 'snapshot', { payload: snap });
  if (r.ok) update((n) => { pushMsg(n, to.num, { t: 'snapshot', dir: 'out', payload: snap, ts: new Date().toISOString() }); });
  return r;
}

export async function refuseRequest(to: { num: string; name: string }) {
  return sendRaw(to, 'response', { text: 'n\'a pas autorisé la consultation de son bilan pour l\'instant.' });
}

export async function blockContact(num: string) {
  const s = getState();
  update((n) => { const c = n.chat.contacts.find((x) => x.num === num); if (c) { c.blocked = true; c.always_allow = false; } });
  await post('block', { num: s.settings.handle, token: s.chat.token, target: num });
}

let polling = false;
export async function pollOnce(): Promise<void> {
  const s0 = getState();
  if (!chatAvailable || !s0.chat.enabled || !s0.chat.token || polling) return;
  polling = true;
  try {
    const r = await post('poll', { num: s0.settings.handle, token: s0.chat.token, after: s0.chat.last_id, epoch: s0.chat.epoch });
    if (r.status === 401 || r.status === 403) { await claim(); return; } // le relais a redémarré : on se ré-annonce
    if (!r.ok) { setStatus(r.status === 0 ? 'offline' : 'error'); return; }
    setStatus('online');
    const msgs = (Array.isArray(r.json.messages) ? r.json.messages : []) as Incoming[];
    const newEpoch = String(r.json.epoch ?? '');
    let auto: string[] = [];
    if (msgs.length || newEpoch !== s0.chat.epoch) {
      update((n) => { if (n.chat.epoch !== newEpoch) { n.chat.epoch = newEpoch; n.chat.last_id = 0; } auto = applyIncoming(n, msgs).autoReply; });
    }
    for (const num of auto) { const c = getState().chat.contacts.find((x) => x.num === num); if (c) await sendSnapshot({ num: c.num, name: c.name }, { pain: false, note: false }); }
  } finally { polling = false; }
}
