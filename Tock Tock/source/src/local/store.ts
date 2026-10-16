// Stockage LOCAL de Tock Tock (version « un seul fichier ») : tout reste dans le navigateur de la personne
// (localStorage). Aucune donnée n'est envoyée nulle part : la page est même bloquée en réseau par sa politique CSP.
import { useSyncExternalStore } from 'react';
import type { Answer, AnswerSnapshot, Checkin, Choice, Chronicle, GoalLite } from '../../supabase/functions/_shared/types.ts';
import { answerToTen, addDays, buildDailySeries, computeCheckinStats, periodGeneralAverage, toEpochDay } from '../../supabase/functions/_shared/stats.ts';
import { buildTemplateChronicle } from '../../supabase/functions/_shared/chronicle.ts';
import { countryFromTimezone } from '../../supabase/functions/_shared/crisis.ts';
import { browserTimezone, todayIn } from '../lib/format';
import { CATEGORIES, INDICATORS } from './data';

export { RULES_VERSION } from './rules';
const KEY = 'tocktock.v1';

export interface Category { id: string; name: string; sort_order: number; template_key: string | null }
export interface Indicator {
  id: string; category_id: string; name: string; description: string;
  response_type: 'scale' | 'text' | 'choice' | 'boolean';
  scale_min: number | null; scale_max: number | null; choices: Choice[] | null;
  include_in_average: boolean; active: boolean; sort_order: number; template_key: string | null;
}
export interface Step { id: string; title: string; done: boolean; done_at: string | null }
export interface Goal { id: string; title: string; status: GoalLite['status']; due_date: string | null; steps: Step[]; created_at: string }
export interface Victory { id: string; date: string; text: string }
export type LocalCheckin = Checkin & { tags: string[]; updated_at: string };
export interface TicketMsg { id: string; at: string; who: 'me' | 'support'; text: string }
export interface Ticket {
  id: string; ref: string; category: string; subject: string; priority: 'normal' | 'important';
  status: 'open' | 'sent' | 'resolved'; created_at: string; updated_at: string; messages: TicketMsg[]; diagnostic: string | null;
}
export interface Draft { vals: Record<string, { num?: number | null; text?: string; choice?: string | null }>; events: string; note: string; pain: number | null; zone: string; painNote: string; tags: string[]; at: string }
export interface Settings {
  name: string; theme: 'auto' | 'light' | 'dark'; country: string; timezone: string;
  onboarded: boolean; rules_accepted_version: string | null; rules_accepted_at: string | null;
  quickMode: boolean; lastBackupAt: string | null; supportEmail: string;
  chronicle_auto: boolean; includeNotes: boolean; includeGoals: boolean; includePain: boolean; includeHistory: boolean; pdfSensitive: boolean;
  pinHash: string | null; pinSalt: string | null;
  /** Écran d'accueil (connexion ou « sans compte ») déjà passé. */
  welcome_done: boolean;
  /** Numéro ALÉATOIRE de 5 chiffres, propre à cet appareil (affiché « #48213 ») : un pseudonyme, sans lien avec ton nom, ton e-mail ou ton numéro. */
  handle: string;
  /** Identifiant CONFIRMÉ par un code : on ne garde que sa version masquée, jamais l'adresse ni le numéro, ni aucun jeton. */
  account: { kind: 'email' | 'phone'; masked: string; verified_at: string } | null;
}
/** Bilan partagé avec quelqu'un : uniquement des MOYENNES du jour (jamais de zéro inventé : null = indisponible), douleur et note seulement si autorisées. */
export interface Snapshot { date: string; general: number | null; categories: { name: string; avg: number | null }[]; pain?: { score: number | null; zone: string | null }; note?: string; empty?: boolean }
export interface ChatMsg { id: string; t: 'msg' | 'request' | 'snapshot' | 'response' | 'system'; dir: 'in' | 'out'; text?: string; payload?: Snapshot | null; ts: string; state?: 'pending' | 'allowed' | 'refused' }
export interface ChatContact { num: string; name: string; last_ts: string; unread: number; blocked: boolean; always_allow: boolean }
export interface ChatState { enabled: boolean; adult_ack: boolean; token: string | null; epoch: string | null; last_id: number; contacts: ChatContact[]; threads: Record<string, ChatMsg[]> }
export interface ExLog { date: string; id: string; text?: string }

export interface Store {
  v: 1; settings: Settings; categories: Category[]; indicators: Indicator[];
  checkins: Record<string, LocalCheckin>; goals: Goal[]; chronicles: Record<string, Chronicle>; victories: Victory[]; read: string[];
  tickets: Ticket[]; drafts: Record<string, Draft>;
  chat: ChatState; exlog: ExLog[];
}

/** 5 chiffres tirés au hasard (aléa du navigateur). Pas un identifiant unique au monde : un simple repère local. */
export function randomHandle(): string {
  const a = new Uint32Array(1);
  try { crypto.getRandomValues(a); } catch { a[0] = Math.floor(Math.random() * 0x100000000); }
  return String(a[0] % 100000).padStart(5, '0');
}

export function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* contexte non sécurisé */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function seed(): Store {
  const tz = browserTimezone();
  const categories: Category[] = CATEGORIES.map((c) => ({ id: uid(), name: c.label, sort_order: c.order, template_key: c.key }));
  const indicators: Indicator[] = INDICATORS.map((t) => ({
    id: uid(), category_id: categories.find((c) => c.template_key === t.cat)!.id, name: t.name, description: t.desc,
    response_type: 'scale', scale_min: 0, scale_max: 10, choices: null, include_in_average: true, active: true, sort_order: t.order, template_key: t.key,
  }));
  return {
    v: 1, categories, indicators, checkins: {}, goals: [], chronicles: {}, victories: [], read: [], tickets: [], drafts: {}, exlog: [],
    chat: { enabled: false, adult_ack: false, token: null, epoch: null, last_id: 0, contacts: [], threads: {} },
    settings: {
      name: '', theme: 'auto', country: countryFromTimezone(tz), timezone: tz, onboarded: false, rules_accepted_version: null, rules_accepted_at: null, quickMode: false, lastBackupAt: null, supportEmail: '',
      chronicle_auto: true, includeNotes: true, includeGoals: true, includePain: false, includeHistory: true, pdfSensitive: false,
      pinHash: null, pinSalt: null, welcome_done: false, account: null, handle: randomHandle(),
    },
  };
}

/** Ajoute les catégories / indicateurs modèles manquants (n'écrase rien). */
export function restoreDefaults(s: Store): void {
  for (const c of CATEGORIES) {
    if (!s.categories.some((x) => x.template_key === c.key)) s.categories.push({ id: uid(), name: c.label, sort_order: c.order, template_key: c.key });
  }
  for (const t of INDICATORS) {
    if (s.indicators.some((i) => i.template_key === t.key)) continue;
    const cat = s.categories.find((c) => c.template_key === t.cat)!;
    s.indicators.push({ id: uid(), category_id: cat.id, name: t.name, description: t.desc, response_type: 'scale', scale_min: 0, scale_max: 10, choices: null, include_in_average: true, active: true, sort_order: t.order, template_key: t.key });
  }
}

let persistOk = true;

/** Valide et complète des données venant du stockage ou d'une sauvegarde. Lève une erreur si la structure est invalide. */
export function normalizeStore(p: unknown): Store {
  const o = p as Partial<Store> | null;
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(o) || o.v !== 1 || !isObj(o.settings) || !Array.isArray(o.indicators) || !Array.isArray(o.categories) || !isObj(o.checkins)) throw new Error('format');
  for (const [d, c] of Object.entries(o.checkins as Record<string, LocalCheckin>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isObj(c) || !Array.isArray(c.answers)) throw new Error('format');
    if (!Array.isArray(c.tags)) c.tags = [];
  }
  const base = seed();
  return {
    ...base, ...(o as Store),
    settings: { ...base.settings, ...(o.settings as Settings), handle: /^\d{5}$/.test(String((o.settings as Settings | undefined)?.handle)) ? String((o.settings as Settings).handle) : base.settings.handle },
    goals: Array.isArray(o.goals) ? o.goals : [], victories: Array.isArray(o.victories) ? o.victories : [], read: Array.isArray(o.read) ? o.read : [],
    chronicles: isObj(o.chronicles) ? (o.chronicles as Store['chronicles']) : {}, tickets: Array.isArray(o.tickets) ? o.tickets : [], drafts: isObj(o.drafts) ? (o.drafts as Store['drafts']) : {},
    exlog: Array.isArray(o.exlog) ? (o.exlog as Store['exlog']).slice(-500) : [],
    chat: isObj(o.chat) ? { ...base.chat, ...(o.chat as ChatState), contacts: Array.isArray((o.chat as ChatState).contacts) ? (o.chat as ChatState).contacts : [], threads: isObj((o.chat as ChatState).threads) ? (o.chat as ChatState).threads : {} } : base.chat,
  };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeStore(JSON.parse(raw));
  } catch { /* stockage indisponible ou corrompu : on repart d'un état neuf (les données corrompues ne sont PAS effacées) */ }
  return seed();
}
let state: Store = load();
const subs = new Set<() => void>();
function persist(): void {
  try { localStorage.setItem(KEY, JSON.stringify(state)); persistOk = true; } catch { persistOk = false; }
}
persist();

export const storageWorks = (): boolean => persistOk;
export const getState = (): Store => state;
export function update(fn: (s: Store) => void): void {
  const next = structuredClone(state);
  fn(next);
  state = next;
  persist();
  subs.forEach((f) => f());
}
export function markBackupDone(): void {
  update((n) => { n.settings.lastBackupAt = new Date().toISOString(); });
}
export function replaceAll(s: Store): void {
  state = s;
  persist();
  subs.forEach((f) => f());
}
export function useStore(): Store {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => state);
}

export const today = (s: Store = state): string => todayIn(s.settings.timezone || browserTimezone());

// ---------------------------------------------------------------------------
// Indicateurs, bilans
// ---------------------------------------------------------------------------
export function activeIndicators(s: Store): Indicator[] {
  const order = new Map(s.categories.map((c) => [c.id, c.sort_order]));
  return s.indicators.filter((i) => i.active).sort((a, b) => (order.get(a.category_id) ?? 99) - (order.get(b.category_id) ?? 99) || a.sort_order - b.sort_order);
}

export function snapshotOf(s: Store, ind: Indicator): AnswerSnapshot {
  const cat = s.categories.find((c) => c.id === ind.category_id);
  return {
    indicator_id: ind.id, name: ind.name, description: ind.description, category_id: ind.category_id, category_name: cat?.name ?? null,
    response_type: ind.response_type, scale_min: ind.scale_min, scale_max: ind.scale_max, choices: ind.choices,
    include_in_average: ind.include_in_average && (ind.response_type === 'scale' || ind.response_type === 'choice'), template_key: ind.template_key,
  };
}

export const checkinsSorted = (s: Store): LocalCheckin[] => Object.values(s.checkins).sort((a, b) => (a.checkin_date < b.checkin_date ? -1 : 1));

/** Série de jours de bilan : en cours (jusqu'à aujourd'hui, ou hier si aujourd'hui n'est pas encore fait) et meilleure. */
export function streaks(dates: string[], todayStr: string): { current: number; best: number; total: number } {
  const set = new Set(dates);
  let cursor = set.has(todayStr) ? todayStr : addDays(todayStr, -1);
  let current = 0;
  while (set.has(cursor)) { current++; cursor = addDays(cursor, -1); }
  const sorted = [...set].sort();
  let best = 0, run = 0, prev: string | null = null;
  for (const d of sorted) {
    run = prev && toEpochDay(d) - toEpochDay(prev) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best, total: set.size };
}

// ---------------------------------------------------------------------------
// Chroniques (modèle sans IA : uniquement ce qui a été saisi)
// ---------------------------------------------------------------------------
export function goalsLite(s: Store, date: string): GoalLite[] {
  return s.goals.filter((g) => g.status !== 'archived').map((g) => {
    const done = g.steps.filter((x) => x.done).length;
    return {
      title: g.title, status: g.status, progress: g.steps.length ? Math.round((done / g.steps.length) * 100) : null, due_date: g.due_date,
      stepsDoneToday: g.steps.filter((x) => x.done_at === date).map((x) => x.title), nextStep: g.steps.find((x) => !x.done)?.title ?? null,
    };
  });
}

export function makeChronicle(s: Store, date: string): Chronicle {
  const checkin = s.checkins[date] ?? null;
  const prev = s.settings.includeHistory ? checkinsSorted(s).filter((c) => c.checkin_date < date).pop() ?? null : null;
  return buildTemplateChronicle({
    date, checkin, goals: s.settings.includeGoals ? goalsLite(s, date) : [], previousCheckin: prev,
    options: { includeNotes: s.settings.includeNotes, includeGoals: s.settings.includeGoals, includePain: s.settings.includePain, includeHistory: s.settings.includeHistory },
  });
}

/** « Chronique de minuit » : à l'ouverture, les jours PASSÉS ayant un bilan mais pas de chronique sont rattrapés (14 jours max). */
export function ensureChronicles(): number {
  const s = state;
  if (!s.settings.onboarded || !s.settings.chronicle_auto) return 0;
  const t = today(s);
  const missing = Object.keys(s.checkins).filter((d) => d < t && d >= addDays(t, -14) && !s.chronicles[d]);
  const made: [string, Chronicle][] = [];
  for (const d of missing) {
    const c = makeChronicle(s, d);
    if (!c.insufficient) made.push([d, c]);
  }
  if (made.length) update((n) => { for (const [d, c] of made) n.chronicles[d] = c; });
  return made.length;
}

// ---------------------------------------------------------------------------
// Observations (prudentes : ce sont des liens observés, jamais des causes)
// ---------------------------------------------------------------------------
const mean = (v: number[]): number | null => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 10 || n !== ys.length) return null;
  const mx = mean(xs)!, my = mean(ys)!;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export interface Insights {
  days: number;
  trend: { recent: number | null; previous: number | null; diff: number | null; recentDays: number; previousDays: number };
  weekdays: { label: string; value: number | null; days: number }[];
  indicators: { name: string; value: number; n: number }[];
  tags: { tag: string; withAvg: number; withoutAvg: number; withDays: number; withoutDays: number; diff: number }[];
  sleepMood: { r: number; n: number } | null;
}

const DOW = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export function computeInsights(s: Store, todayStr: string): Insights {
  const all = checkinsSorted(s);
  const from90 = addDays(todayStr, -89);
  const series = buildDailySeries(all, from90, todayStr);
  const daysWithData = series.filter((p) => p.general !== null);
  const last14 = series.slice(-14), prev14 = series.slice(-28, -14);
  const a = periodGeneralAverage(last14), b = periodGeneralAverage(prev14);
  const dowVals: number[][] = [[], [], [], [], [], [], []];
  for (const p of daysWithData) dowVals[(toEpochDay(p.date) + 3) % 7].push(p.general as number);
  const acc = new Map<string, { sum: number; n: number }>();
  for (const c of all) {
    if (c.checkin_date < addDays(todayStr, -29)) continue;
    for (const an of c.answers) {
      const v = answerToTen(an);
      if (v === null) continue;
      const e = acc.get(an.snapshot.name) ?? { sum: 0, n: 0 };
      e.sum += v; e.n++; acc.set(an.snapshot.name, e);
    }
  }
  const generalByDate = new Map(daysWithData.map((p) => [p.date, p.general as number]));
  const tagSet = new Set<string>();
  for (const c of all) c.tags?.forEach((t) => tagSet.add(t));
  const tags: Insights['tags'] = [];
  for (const tag of tagSet) {
    const w: number[] = [], wo: number[] = [];
    for (const [d, g] of generalByDate) (s.checkins[d]?.tags ?? []).includes(tag) ? w.push(g) : wo.push(g);
    if (w.length >= 3 && wo.length >= 3) tags.push({ tag, withAvg: mean(w)!, withoutAvg: mean(wo)!, withDays: w.length, withoutDays: wo.length, diff: mean(w)! - mean(wo)! });
  }
  tags.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  const sleepInd = s.indicators.find((i) => i.template_key === 'sleep'), moodInd = s.indicators.find((i) => i.template_key === 'mood');
  let sleepMood: Insights['sleepMood'] = null;
  if (sleepInd && moodInd) {
    const xs: number[] = [], ys: number[] = [];
    for (const c of all) {
      const sa = c.answers.find((x) => x.snapshot.indicator_id === sleepInd.id), ma = c.answers.find((x) => x.snapshot.indicator_id === moodInd.id);
      const sv = sa ? answerToTen(sa) : null, mv = ma ? answerToTen(ma) : null;
      if (sv !== null && mv !== null) { xs.push(sv); ys.push(mv); }
    }
    const r = pearson(xs, ys);
    if (r !== null) sleepMood = { r, n: xs.length };
  }
  return {
    days: daysWithData.length,
    trend: { recent: a.value, previous: b.value, diff: a.value !== null && b.value !== null && a.days >= 5 && b.days >= 5 ? a.value - b.value : null, recentDays: a.days, previousDays: b.days },
    weekdays: dowVals.map((v, i) => ({ label: DOW[i], value: mean(v), days: v.length })),
    indicators: [...acc.entries()].filter(([, e]) => e.n >= 3).map(([name, e]) => ({ name, value: e.sum / e.n, n: e.n })).sort((x, y) => y.value - x.value),
    tags: tags.filter((t) => Math.abs(t.diff) >= 0.5),
    sleepMood,
  };
}

// ---------------------------------------------------------------------------
// Code PIN (protège contre un regard de passage, PAS contre quelqu'un qui peut lire le stockage du navigateur)
// ---------------------------------------------------------------------------
export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* repli ci-dessous */ }
  let h = 2166136261;
  for (const b of data) { h ^= b; h = Math.imul(h, 16777619); }
  return `f${(h >>> 0).toString(16)}`;
}

// ---------------------------------------------------------------------------
// Sauvegarde / export
// ---------------------------------------------------------------------------
export function csvExport(s: Store): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['date', 'indicateur', 'categorie', 'valeur_sur_10', 'valeur_brute', 'texte_ou_choix'].map(esc).join(';')];
  for (const c of checkinsSorted(s)) {
    for (const a of c.answers) {
      const t = answerToTen(a);
      rows.push([c.checkin_date, a.snapshot.name, a.snapshot.category_name, t === null ? '' : t.toFixed(2), a.value_num ?? '', a.value_text ?? a.value_choice ?? ''].map(esc).join(';'));
    }
  }
  return `﻿${rows.join('\n')}`;
}

export function downloadBlob(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export { computeCheckinStats };
export type { Answer };
