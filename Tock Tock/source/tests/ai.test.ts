import { describe, it, expect } from 'bun:test';
import { aiConfigured, callAi, parseAiChronicle, numbersAreGrounded, buildAssistantContext, guidedReply, buildChroniclePromptData, allowedScoresFor } from '../supabase/functions/_shared/ai.ts';
import { buildTemplateChronicle } from '../supabase/functions/_shared/chronicle.ts';
import type { Answer } from '../supabase/functions/_shared/types.ts';

const mockFetch = (status: number, body: unknown) => async () => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const sc = (cat: string, name: string, v: number): Answer => ({ snapshot: { indicator_id: name, name, category_id: cat, category_name: cat, response_type: 'scale', scale_min: 0, scale_max: 10, choices: null, include_in_average: true }, value_num: v, value_text: null, value_choice: null });

describe('adaptateur IA', () => {
  it('non configurée => not_configured, sans appel réseau', async () => {
    let called = false;
    const r = await callAi({}, 's', [{ role: 'user', content: 'x' }], { fetchImpl: (async () => { called = true; return {} as any; }) as any });
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
    expect(called).toBe(false);
    expect(aiConfigured({ AI_PROVIDER: 'anthropic', AI_API_KEY: 'k', AI_MODEL: 'm' })).toBe(true);
  });
  it('Anthropic et compatible OpenAI : bonnes requêtes et lecture de réponse', async () => {
    let seen: any;
    const spy = (resp: unknown) => async (url: string, init: any) => { seen = { url, init }; return { ok: true, status: 200, json: async () => resp, text: async () => '' }; };
    const a = await callAi({ AI_PROVIDER: 'anthropic', AI_API_KEY: 'k', AI_MODEL: 'm' }, 'sys', [{ role: 'user', content: 'salut' }], { fetchImpl: spy({ content: [{ type: 'text', text: 'bonjour' }] }) as any });
    expect(a).toMatchObject({ ok: true, text: 'bonjour' });
    expect(seen.url).toContain('/v1/messages');
    expect(seen.init.headers['x-api-key']).toBe('k');
    expect(JSON.parse(seen.init.body).system).toBe('sys');
    const o = await callAi({ AI_PROVIDER: 'openai', AI_API_KEY: 'k', AI_MODEL: 'm' }, 'sys', [{ role: 'user', content: 'salut' }], { fetchImpl: spy({ choices: [{ message: { content: 'hello' } }] }) as any });
    expect(o).toMatchObject({ ok: true, text: 'hello' });
    expect(seen.init.headers.authorization).toBe('Bearer k');
    expect(JSON.parse(seen.init.body).messages[0]).toEqual({ role: 'system', content: 'sys' });
  });
  it('erreurs HTTP, réponse vide, réseau, délai', async () => {
    const env = { AI_PROVIDER: 'openai', AI_API_KEY: 'k', AI_MODEL: 'm' };
    expect(await callAi(env, 's', [], { fetchImpl: mockFetch(500, {}) as any })).toMatchObject({ ok: false, reason: 'http_error' });
    expect(await callAi(env, 's', [], { fetchImpl: mockFetch(200, { choices: [] }) as any })).toMatchObject({ ok: false, reason: 'empty' });
    expect(await callAi(env, 's', [], { fetchImpl: (async () => { throw new Error('x'); }) as any })).toMatchObject({ ok: false, reason: 'network' });
    const slow = (async (_u: string, init: any) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))))) as any;
    expect(await callAi(env, 's', [], { fetchImpl: slow, timeoutMs: 20 })).toMatchObject({ ok: false, reason: 'timeout' });
  });
});

describe('garde-fous des chroniques IA', () => {
  const options = { includeNotes: true, includeGoals: true, includePain: false, includeHistory: false };
  const checkin = { checkin_date: '2026-10-16', pain_score: 7, answers: [sc('A', 'Joie', 8), sc('B', 'Calme', 4)] };
  const tpl = buildTemplateChronicle({ date: '2026-10-16', checkin, options });
  const allowed = allowedScoresFor(tpl);
  it('accepte un JSON fidèle aux données', () => {
    const raw = 'Voici : ```json\n{"summary":"Ta moyenne est de 6,0/10.","positives":"Joie à 8,0/10."}\n```';
    expect(parseAiChronicle(raw, { allowedScores: allowed, includePain: false, includeNotes: true })).toEqual({ summary: 'Ta moyenne est de 6,0/10.', positives: 'Joie à 8,0/10.' });
  });
  it('refuse un chiffre inventé, la douleur non autorisée, un JSON invalide ou des clés inconnues seules', () => {
    const p = (raw: string) => parseAiChronicle(raw, { allowedScores: allowed, includePain: false, includeNotes: true });
    expect(p('{"summary":"Ta moyenne est de 9,5/10."}')).toBeNull();
    expect(p('{"summary":"Ta douleur au dos était forte."}')).toBeNull();
    expect(p('pas du json')).toBeNull();
    expect(p('{"evil":"x"}')).toBeNull();
    expect(numbersAreGrounded('8/10 et 4,0 / 10', new Set(['8', '4,0']))).toBe(true);
  });
  it('les données envoyées à l\'IA excluent la douleur et les notes non autorisées', () => {
    const data = buildChroniclePromptData({ date: '2026-10-16', checkin: { ...checkin, events_note: 'secret' }, options: { ...options, includeNotes: false } }, tpl);
    expect(data).not.toContain('douleur');
    expect(data).not.toContain('secret');
    expect(data).toContain('Joie');
  });
});

describe('assistant', () => {
  const days = [{ date: '2026-10-16', general: 6, categories: [{ name: 'A', average: 8 }, { name: 'B', average: null }], pain: 7 }];
  it('contexte limité aux autorisations', () => {
    const none = buildAssistantContext({ access: { checkins: false, goals: false, chronicles: false, pain: false }, recentDays: days, goals: [{ title: 'Marcher', status: 'todo' }] });
    expect(none).not.toContain('2026-10-16');
    expect(none).not.toContain('Marcher');
    const some = buildAssistantContext({ access: { checkins: true, goals: false, chronicles: false, pain: false }, recentDays: days });
    expect(some).toContain('moyenne 6,0');
    expect(some).toContain('B indisponible');
    expect(some).not.toContain('douleur');
    expect(buildAssistantContext({ access: { checkins: true, goals: false, chronicles: false, pain: true }, recentDays: days })).toContain('douleur 7/10');
  });
  it('mode guidé : FAQ honnête, et crise prioritaire avec ressources', () => {
    expect(guidedReply('comment est calculée ma moyenne ?').text).toContain('jamais comptée comme zéro');
    expect(guidedReply('blabla').aiUnavailable).toBe(true);
    const c = guidedReply('je veux me suicider', 'FR');
    expect(c.mode).toBe('crisis');
    expect(c.resources!.map((r) => r.contact)).toContain('3114');
  });
});
