import { describe, it, expect } from 'bun:test';
import { produceChronicle, loadChronicleInput, optionsFor } from '../supabase/functions/_shared/chronicle_service.ts';
import { sendEmail, chronicleNotifyEmail, chroniclePdfEmail, escapeHtml, emailConfigured } from '../supabase/functions/_shared/email.ts';

// Faux client Supabase minimal : table -> lignes, filtres eq/lt/in/gte, order/limit, maybeSingle.
function fakeDb(tables: Record<string, any[]>) {
  const from = (name: string) => {
    let rows = [...(tables[name] ?? [])];
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
      lt: (c: string, v: any) => ((rows = rows.filter((r) => r[c] < v)), q),
      gte: (c: string, v: any) => ((rows = rows.filter((r) => r[c] >= v)), q),
      in: (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), q),
      order: (c: string, o?: { ascending?: boolean }) => ((rows.sort((a, b) => (a[c] < b[c] ? -1 : 1) * (o?.ascending === false ? -1 : 1))), q),
      limit: () => q,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (res: any) => res({ data: rows, error: null }),
    };
    return q;
  };
  return { from } as any;
}
const snap = (cat: string, name: string) => ({ indicator_id: name, name, category_id: cat, category_name: cat, response_type: 'scale', scale_min: 0, scale_max: 10, choices: null, include_in_average: true });
const settings = { timezone: 'Europe/Paris', track_pain: false, ai_consent: false, ai_use_history: false };
const tables = () => ({
  checkins: [{ user_id: 'u1', checkin_date: '2026-10-16', pain_score: 8, events_note: 'RDV', checkin_answers: [{ snapshot: snap('A', 'Joie'), value_num: '8', value_text: null, value_choice: null }] }],
  goals: [], goal_steps: [],
});

describe('service chronique', () => {
  it('lit les données (numeric -> number) sans la douleur quand elle n\'est pas suivie', async () => {
    const r = await produceChronicle({ db: fakeDb(tables()), userId: 'u1', date: '2026-10-16', settings, useAi: false, aiEnv: {} });
    expect(r.chronicle.source).toBe('template');
    expect(r.chronicle.stats!.general).toBe(8);
    expect(r.chronicle.sections.pain).toBeUndefined();
    expect(r.ai).toEqual({ requested: false, used: false, reason: 'not_requested' });
  });
  it('IA demandée mais sans consentement / non configurée / sans donnée : repli explicite', async () => {
    const base = { db: fakeDb(tables()), userId: 'u1', date: '2026-10-16', useAi: true };
    expect((await produceChronicle({ ...base, settings, aiEnv: {} })).ai.reason).toBe('no_consent');
    expect((await produceChronicle({ ...base, settings: { ...settings, ai_consent: true }, aiEnv: {} })).ai.reason).toBe('not_configured');
    const none = await produceChronicle({ ...base, db: fakeDb({ checkins: [], goals: [], goal_steps: [] }), settings: { ...settings, ai_consent: true }, aiEnv: { AI_PROVIDER: 'openai', AI_API_KEY: 'k', AI_MODEL: 'm' } });
    expect(none.ai.reason).toBe('insufficient_data');
    expect(none.chronicle.insufficient).toBe(true);
  });
  it('IA : sortie fidèle acceptée ; sortie avec chiffre inventé rejetée => gabarit', async () => {
    const aiEnv = { AI_PROVIDER: 'openai', AI_API_KEY: 'k', AI_MODEL: 'm' };
    const s = { ...settings, ai_consent: true };
    const mk = (content: string) => (async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }), text: async () => '' })) as any;
    const good = await produceChronicle({ db: fakeDb(tables()), userId: 'u1', date: '2026-10-16', settings: s, useAi: true, aiEnv, fetchImpl: mk('{"summary":"Ta moyenne est de 8,0/10."}') });
    expect(good.ai.used).toBe(true);
    expect(good.chronicle.source).toBe('ai');
    const bad = await produceChronicle({ db: fakeDb(tables()), userId: 'u1', date: '2026-10-16', settings: s, useAi: true, aiEnv, fetchImpl: mk('{"summary":"Ta moyenne est de 3,0/10."}') });
    expect(bad.ai).toMatchObject({ used: false, reason: 'ai_output_rejected' });
    expect(bad.chronicle.source).toBe('template');
    const limited = await produceChronicle({ db: fakeDb(tables()), userId: 'u1', date: '2026-10-16', settings: s, useAi: true, aiEnv, allowAiCall: async () => false, fetchImpl: mk('{}') });
    expect(limited.ai.reason).toBe('daily_limit');
  });
  it('options IA : douleur seulement si suivie ET autorisée pour l\'assistant', () => {
    expect(optionsFor({ ...settings, track_pain: true }, false).includePain).toBe(true);
    expect(optionsFor({ ...settings, track_pain: true }, true).includePain).toBe(false);
    expect(optionsFor({ ...settings, track_pain: true, chatbot_access: { pain: true } }, true).includePain).toBe(true);
  });
  it('objectif : étape validée aujourd\'hui (fuseau de la personne) seulement', async () => {
    const t = tables() as any;
    t.goals = [{ id: 'g1', user_id: 'u1', title: 'Marcher', status: 'in_progress' }];
    t.goal_steps = [
      { goal_id: 'g1', user_id: 'u1', title: 'A', done: true, done_at: '2026-10-16T09:00:00Z', sort_order: 1 },
      { goal_id: 'g1', user_id: 'u1', title: 'B', done: true, done_at: '2026-10-15T09:00:00Z', sort_order: 2 },
      { goal_id: 'g1', user_id: 'u1', title: 'C', done: false, done_at: null, sort_order: 3 },
    ];
    const input = await loadChronicleInput(fakeDb(t), 'u1', '2026-10-16', settings, false);
    expect(input.goals![0].stepsDoneToday).toEqual(['A']);
    expect(input.goals![0].nextStep).toBe('C');
  });
});

describe('e-mails', () => {
  it('pas de configuration => échec non réessayable, aucun appel', async () => {
    expect(emailConfigured({})).toBe(false);
    expect(await sendEmail({}, chronicleNotifyEmail('a@b.fr', 'https://x'))).toEqual({ ok: false, error: 'email_not_configured', retryable: false });
  });
  it('envoi OK, 429/5xx réessayables, 4xx non, réseau réessayable', async () => {
    const env = { RESEND_API_KEY: 'k', EMAIL_FROM: 'T <a@b.fr>' };
    const f = (status: number, body: any = { id: 'm1' }) => (async () => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })) as any;
    expect(await sendEmail(env, chronicleNotifyEmail('a@b.fr', 'https://x'), f(200))).toEqual({ ok: true, id: 'm1' });
    expect(await sendEmail(env, chronicleNotifyEmail('a@b.fr', 'https://x'), f(429, {}))).toMatchObject({ ok: false, retryable: true });
    expect(await sendEmail(env, chronicleNotifyEmail('a@b.fr', 'https://x'), f(503, {}))).toMatchObject({ ok: false, retryable: true });
    expect(await sendEmail(env, chronicleNotifyEmail('a@b.fr', 'https://x'), f(422, {}))).toMatchObject({ ok: false, retryable: false });
    expect(await sendEmail(env, chronicleNotifyEmail('a@b.fr', 'https://x'), (async () => { throw new Error('boom'); }) as any)).toMatchObject({ ok: false, retryable: true });
  });
  it('l\'e-mail « notify » ne contient aucune donnée ; le PDF est joint en base64', async () => {
    const m = chronicleNotifyEmail('a@b.fr', 'https://x.github.io/tock/');
    expect(m.text + m.html).not.toMatch(/\d\/10|moyenne|douleur/i);
    expect(m.text).toContain('https://x.github.io/tock/#/historique');
    let sent: any;
    await sendEmail({ RESEND_API_KEY: 'k', EMAIL_FROM: 'f' }, chroniclePdfEmail('a@b.fr', 'x', new Uint8Array([1, 2, 3]), 'c.pdf'), (async (_u: string, init: any) => { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; }) as any, 'key-1');
    expect(sent.attachments[0]).toEqual({ filename: 'c.pdf', content: 'AQID' });
    expect(escapeHtml('<b>"x"</b>')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
  });
});
