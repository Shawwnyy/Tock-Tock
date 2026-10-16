// Client d'authentification de la version locale : requêtes envoyées, erreurs traduites, jamais de jeton conservé.
import { describe, expect, test } from 'bun:test';
import { sendCode, verifyCode } from '../src/local/gotrue.ts';
import { PRINCIPLES, RULE_SECTIONS, RULES_VERSION, rulesAsText } from '../src/local/rules.ts';

const srv = { url: 'https://abcd.supabase.co/', key: 'public-anon-key' };
type Call = { url: string; init: RequestInit };
function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }) as unknown as typeof fetch;
}

describe('envoi du code', () => {
  test('e-mail : bonne route, bon corps, clé publique, aucun cookie', async () => {
    const calls: Call[] = [];
    const r = await sendCode(srv, 'email', 'a@b.fr', fakeFetch(200, {}, calls));
    expect(r).toEqual({ ok: true });
    expect(calls[0].url).toBe('https://abcd.supabase.co/auth/v1/otp');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: 'a@b.fr', create_user: true });
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.apikey).toBe('public-anon-key');
    expect(calls[0].init.credentials).toBe('omit');
  });
  test('téléphone : numéro E.164 et canal SMS', async () => {
    const calls: Call[] = [];
    await sendCode(srv, 'phone', '+33612345678', fakeFetch(200, {}, calls));
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ phone: '+33612345678', create_user: true, channel: 'sms' });
  });
  test('limitation (429) et SMS indisponible : messages clairs, sans fuite de détail serveur', async () => {
    const a = await sendCode(srv, 'phone', '+33612345678', fakeFetch(429, { code: 429, error_code: 'over_sms_send_rate_limit', msg: 'SMS rate limit exceeded' }));
    expect(a).toEqual({ ok: false, message: expect.stringContaining('Trop de demandes') });
    const b = await sendCode(srv, 'phone', '+33612345678', fakeFetch(500, { error_code: 'sms_send_failed', msg: 'Twilio error 21608 token abc' }));
    expect((b as { message: string }).message).toContain('SMS n\'est pas disponible');
    expect((b as { message: string }).message).not.toContain('Twilio');
  });
  test('réseau coupé : message de connexion', async () => {
    const r = await sendCode(srv, 'email', 'a@b.fr', (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    expect((r as { message: string }).message).toContain('Connexion impossible');
  });
});

describe('vérification du code', () => {
  test('e-mail et SMS : type et champs attendus ; succès = ok sans jeton conservé', async () => {
    const calls: Call[] = [];
    const ok = await verifyCode(srv, 'email', 'a@b.fr', '123456', fakeFetch(200, { access_token: 'SECRET.JWT', refresh_token: 'R', user: { id: 'u' } }, calls));
    expect(ok).toEqual({ ok: true });
    expect(JSON.stringify(ok)).not.toContain('SECRET');
    expect(calls[0].url).toBe('https://abcd.supabase.co/auth/v1/verify');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ type: 'email', email: 'a@b.fr', token: '123456' });
    await verifyCode(srv, 'phone', '+33612345678', '654321', fakeFetch(200, {}, calls));
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ type: 'sms', phone: '+33612345678', token: '654321' });
  });
  test('code faux ou expiré : refus générique', async () => {
    const r = await verifyCode(srv, 'email', 'a@b.fr', '000000', fakeFetch(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }));
    expect(r).toEqual({ ok: false, message: expect.stringContaining('incorrect ou expiré') });
  });
});

describe('règles : structure et principes', () => {
  test('chaque règle a une raison, un principe connu ; chaque principe est utilisé', () => {
    const ids = new Set(PRINCIPLES.map((p) => p.id));
    const used = new Set<string>();
    let n = 0;
    for (const s of RULE_SECTIONS) for (const r of s.rules) { n++; expect(r.rule.length).toBeGreaterThan(10); expect(r.why.length).toBeGreaterThan(10); expect(ids.has(r.p)).toBe(true); used.add(r.p); }
    expect(used.size).toBe(PRINCIPLES.length);
    expect(n).toBeGreaterThanOrEqual(55);
  });
  test('texte exportable : principes, sections « compte » et « droits », version', () => {
    const t = rulesAsText();
    expect(t).toContain('LES 5 PRINCIPES');
    expect(t).toContain('Compte, e-mail, téléphone et code de connexion');
    expect(t).toContain('Tes droits');
    expect(t).toContain('ne le simule jamais');
    expect(RULES_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
  test('l\'exemple chiffré de la règle des moyennes est juste : (7 + 4) / 2 = 5,5 et non 6', () => {
    const rule = RULE_SECTIONS.find((s) => s.id === 'calcul')!.rules.find((r) => r.rule.includes('moyenne générale'))!;
    expect(rule.why).toContain('(7 + 4) ÷ 2 = 5,5');
    expect((((8 + 6) / 2) + 4) / 2).toBe(5.5);
  });
});
