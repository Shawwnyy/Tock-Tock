// Exécute le code RÉEL des Edge Functions (handlers) avec un faux Supabase en mémoire, un faux `fetch` (Resend / IA)
// et une horloge simulée. Ce n'est PAS un test sous Deno ni contre un vrai Supabase : il vérifie la logique de collage.
import { describe, it, expect, mock, beforeEach, afterEach, setSystemTime } from 'bun:test';
import { makeWorld, type World } from './helpers/fakeSupabase.ts';

let world: World;
mock.module('@supabase/supabase-js', () => ({ createClient: () => world.client }));

const envVars: Record<string, string | undefined> = {};
let captured: ((req: Request) => Promise<Response>) | null = null;
(globalThis as any).Deno = { env: { get: (k: string) => envVars[k] }, serve: (h: any) => { captured = h; } };

const handlers = new Map<string, (req: Request) => Promise<Response>>();
async function load(name: string) {
  if (!handlers.has(name)) {
    captured = null;
    await import(`../supabase/functions/${name}/index.ts`); // le module appelle Deno.serve(handler) une seule fois
    if (!captured) throw new Error(`Aucun handler pour ${name}`);
    handlers.set(name, captured);
  }
  return handlers.get(name)!;
}

const snap = (cat: string, name: string) => ({ indicator_id: name, name, category_id: cat, category_name: cat, response_type: 'scale', scale_min: 0, scale_max: 10, choices: null, include_in_average: true });
function baseWorld(over: Record<string, any[]> = {}) {
  const w = makeWorld({
    profiles: [{ id: 'u1', created_at: '2026-09-01T00:00:00Z', onboarded_at: '2026-09-01', deactivated_at: null }],
    profile_settings: [{ user_id: 'u1', timezone: 'Europe/Paris', age_band: '18_plus', chronicle_enabled: true, chronicle_time: '21:30:00', chronicle_email_enabled: true, chronicle_email_mode: 'notify', pdf_include_sensitive: false, no_data_behavior: 'nothing', reminder_enabled: false, reminder_time: '20:00:00', track_pain: false, ai_consent: false, ai_use_history: false, chatbot_memory_enabled: false, chatbot_access: { checkins: false, goals: false, chronicles: false, pain: false }, notification_prefs: {} }],
    checkins: [{ id: 'c1', user_id: 'u1', checkin_date: '2026-10-16', events_note: 'Rendez-vous', day_note: null, pain_score: 7 }],
    checkin_answers: [
      { id: 'a1', checkin_id: 'c1', snapshot: snap('Humeur', 'Joie'), value_num: '8', value_text: null, value_choice: null },
      { id: 'a2', checkin_id: 'c1', snapshot: snap('Corps', 'Sommeil'), value_num: '4', value_text: null, value_choice: null },
    ],
    goals: [{ id: 'g1', user_id: 'u1', title: 'Marcher', status: 'in_progress' }], goal_steps: [],
    ...over,
  });
  w.tokens.set('tok-u1', { id: 'u1', email: 'u1@example.com' });
  return w;
}
const req = (body: unknown, token: string | null = 'tok-u1', extra: Record<string, string> = {}) =>
  new Request('http://local/fn', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) });

let fetchCalls: { url: string; init: any }[] = [];
const deliveries = (d = '2026-10-16') => (world.tables.chronicle_deliveries ?? []).filter((x) => x.chronicle_date === d);
const AI_ENV = { AI_PROVIDER: 'openai', AI_API_KEY: 'k', AI_MODEL: 'm' };
const MAIL_ENV = { RESEND_API_KEY: 're_x', EMAIL_FROM: 'Tock <a@b.fr>', APP_URL: 'https://app.example/tock' };

beforeEach(() => {
  world = baseWorld();
  for (const k of Object.keys(envVars)) delete envVars[k];
  Object.assign(envVars, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', CRON_SECRET: 's3cret' });
  fetchCalls = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    fetchCalls.push({ url, init });
    const body = url.includes('resend') ? { id: 'email-1' } : { choices: [{ message: { content: JSON.stringify({ summary: 'Ta moyenne est de 6,0/10.' }) } }] };
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
});
afterEach(() => setSystemTime());

describe('assistant', () => {
  it('refuse sans jeton valide', async () => {
    const h = await load('assistant');
    expect((await h(req({ message: 'salut' }, null))).status).toBe(401);
    expect((await h(req({ message: 'salut' }, 'tok-inconnu'))).status).toBe(401);
  });
  it('crise : message fixe + ressources, AUCUN appel à l\'IA, même si elle est activée', async () => {
    Object.assign(envVars, AI_ENV);
    world.tables.profile_settings[0].ai_consent = true;
    const h = await load('assistant');
    const r = await h(req({ message: 'Je veux me suicider' }));
    const j = await r.json();
    expect(j.mode).toBe('crisis');
    expect(j.resources.map((x: any) => x.contact)).toContain('3114');
    expect(fetchCalls.length).toBe(0);
    expect(world.calls.rpc.some((c) => c.name === 'bump_usage')).toBe(false);
  });
  it('sans consentement : mode guidé annoncé, aucun appel externe', async () => {
    Object.assign(envVars, AI_ENV);
    const h = await load('assistant');
    const j = await (await h(req({ message: 'comment est calculée ma moyenne ?' }))).json();
    expect(j.mode).toBe('guided');
    expect(j.text).toContain('désactivée');
    expect(fetchCalls.length).toBe(0);
  });
  it('IA configurée mais pas de clé côté serveur : le dit clairement', async () => {
    world.tables.profile_settings[0].ai_consent = true;
    const h = await load('assistant');
    const j = await (await h(req({ message: 'bonjour' }))).json();
    expect(j.mode).toBe('guided');
    expect(j.text).toContain('pas configurée');
  });
  it('IA : le contexte envoyé respecte les autorisations (bilans oui, objectifs non)', async () => {
    Object.assign(envVars, AI_ENV);
    Object.assign(world.tables.profile_settings[0], { ai_consent: true, chatbot_access: { checkins: true, goals: false, chronicles: false, pain: false } });
    const h = await load('assistant');
    const j = await (await h(req({ message: 'Peux-tu relire ma semaine ?' }))).json();
    expect(j.mode).toBe('ai');
    const sent = JSON.stringify(JSON.parse(fetchCalls[0].init.body));
    expect(sent).toContain('2026-10-16');
    expect(sent).not.toContain('Marcher');
    expect(sent).not.toContain('Rendez-vous');
    expect(sent).not.toMatch(/douleur 7/);
    expect(fetchCalls[0].init.headers.authorization).toBe('Bearer k');
  });
  it('mémoire : rien n\'est enregistré tant qu\'elle est désactivée ; enregistré (2 messages) quand elle est activée', async () => {
    const h = await load('assistant');
    await h(req({ message: 'comment fonctionne le bilan' }));
    expect(world.tables.chat_messages ?? []).toHaveLength(0);
    world.tables.profile_settings[0].chatbot_memory_enabled = true;
    const j = await (await h(req({ message: 'comment fonctionne le bilan' }))).json();
    expect(world.tables.chat_messages).toHaveLength(2);
    expect(j.conversationId).toBeTruthy();
    expect(world.tables.chat_messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
  it('limite quotidienne => 429', async () => {
    world.rpcOverrides.bump_usage = () => false;
    const h = await load('assistant');
    expect((await h(req({ message: 'bonjour' }))).status).toBe(429);
  });
  it('message trop long ou vide => 400', async () => {
    const h = await load('assistant');
    expect((await h(req({ message: 'x'.repeat(2001) }))).status).toBe(400);
    expect((await h(req({ message: '   ' }))).status).toBe(400);
  });
});

describe('generate-chronicle', () => {
  it('jeton obligatoire ; requête invalide ; date future refusée', async () => {
    const h = await load('generate-chronicle');
    expect((await h(req({ date: '2026-10-16' }, null))).status).toBe(401);
    expect((await h(req({ date: 'hier' }))).status).toBe(400);
    setSystemTime(new Date('2026-10-16T10:00:00Z'));
    expect((await h(req({ date: '2026-10-20' }))).status).toBe(400);
  });
  it('crée la chronique, puis renvoie l\'existante ; modifiée => confirmation exigée', async () => {
    setSystemTime(new Date('2026-10-16T10:00:00Z'));
    const h = await load('generate-chronicle');
    const a = await (await h(req({ date: '2026-10-16' }))).json();
    expect(a.stored).toBe(true);
    expect(world.tables.chronicles).toHaveLength(1);
    expect(world.tables.chronicles[0]).toMatchObject({ user_id: 'u1', chronicle_date: '2026-10-16', source: 'template', status: 'ready' });
    expect(world.tables.chronicles[0].stats.general).toBe(6);
    expect(JSON.stringify(world.tables.chronicles[0].sections)).not.toContain('Rendez-vous'.slice(0, 0) + 'douleur'); // pas de douleur (non suivie)
    const b = await (await h(req({ date: '2026-10-16' }))).json();
    expect(b.existing).toBe(true);
    world.tables.chronicles[0].status = 'edited';
    expect((await h(req({ date: '2026-10-16', regenerate: true }))).status).toBe(409);
    expect((await h(req({ date: '2026-10-16', regenerate: true, confirmOverwrite: true }))).status).toBe(200);
    expect(world.tables.chronicles).toHaveLength(1);
  });
  it('aucune donnée => rien n\'est créé', async () => {
    setSystemTime(new Date('2026-10-16T10:00:00Z'));
    world.tables.checkins = []; world.tables.checkin_answers = [];
    const h = await load('generate-chronicle');
    const j = await (await h(req({ date: '2026-10-15' }))).json();
    expect(j.stored).toBe(false);
    expect(world.tables.chronicles ?? []).toHaveLength(0);
  });
  it('IA : utilisée seulement avec consentement + clé ; sinon repli signalé', async () => {
    setSystemTime(new Date('2026-10-16T10:00:00Z'));
    const h = await load('generate-chronicle');
    let j = await (await h(req({ date: '2026-10-16', useAi: true }))).json();
    expect(j.ai).toMatchObject({ requested: true, used: false, reason: 'no_consent' });
    expect(fetchCalls.length).toBe(0);
    Object.assign(envVars, AI_ENV);
    world.tables.profile_settings[0].ai_consent = true;
    j = await (await h(req({ date: '2026-10-16', useAi: true, regenerate: true }))).json();
    expect(j.ai.used).toBe(true);
    expect(j.chronicle.source).toBe('ai');
  });
});

describe('scheduled-chronicles', () => {
  const NOW = new Date('2026-10-16T19:40:00Z'); // 21:40 à Paris
  it('secret obligatoire', async () => {
    const h = await load('scheduled-chronicles');
    expect((await h(req({}, null))).status).toBe(401);
    expect((await h(req({}, null, { 'x-cron-secret': 'faux' }))).status).toBe(401);
  });
  it('crée la chronique, envoie UN e-mail sans donnée, et ne renvoie rien à la relance', async () => {
    Object.assign(envVars, MAIL_ENV);
    setSystemTime(NOW);
    const h = await load('scheduled-chronicles');
    const run = async () => (await h(req({}, null, { 'x-cron-secret': 's3cret' }))).json();
    const a = await run();
    expect(a).toMatchObject({ chronicles: 1, emailsSent: 1, userErrors: 0 });
    expect(world.tables.chronicles).toHaveLength(1);
    expect(deliveries()[0]).toMatchObject({ status: 'sent', channel: 'email', provider_message_id: 'email-1' });
    expect(deliveries('2026-10-15')[0].status).toBe('skipped'); // la veille (rattrapage) n'avait pas de bilan : ignorée, rien inventé
    const mail = fetchCalls.filter((c) => c.url.includes('resend'));
    expect(mail).toHaveLength(1);
    const body = JSON.parse(mail[0].init.body);
    expect(body.to).toEqual(['u1@example.com']);
    expect(JSON.stringify(body)).not.toMatch(/6,0|moyenne|Rendez-vous/i);
    expect(mail[0].init.headers['Idempotency-Key']).toBe('chronicle-u1-2026-10-16');
    expect(world.tables.notifications).toHaveLength(1);
    const b = await run();
    expect(b).toMatchObject({ chronicles: 0, emailsSent: 0 });
    expect(fetchCalls.filter((c) => c.url.includes('resend'))).toHaveLength(1);
  });
  it('avant l\'heure : rien', async () => {
    Object.assign(envVars, MAIL_ENV);
    setSystemTime(new Date('2026-10-16T19:00:00Z')); // 21:00
    world.tables.profiles[0].created_at = '2026-10-16T05:00:00Z';
    const h = await load('scheduled-chronicles');
    expect(await (await h(req({}, null, { 'x-cron-secret': 's3cret' }))).json()).toMatchObject({ chronicles: 0, emailsSent: 0 });
  });
  it('e-mail non configuré : la chronique est créée mais AUCUNE livraison n\'est marquée « envoyée »', async () => {
    setSystemTime(NOW);
    const h = await load('scheduled-chronicles');
    const j = await (await h(req({}, null, { 'x-cron-secret': 's3cret' }))).json();
    expect(j).toMatchObject({ chronicles: 1, emailsSent: 0 });
    expect(deliveries()).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
  });
  it('échec Resend : livraison « failed » (retentée plus tard), pas de doublon', async () => {
    Object.assign(envVars, MAIL_ENV);
    setSystemTime(NOW);
    (globalThis as any).fetch = async (url: string, init: any) => { fetchCalls.push({ url, init }); return { ok: false, status: 429, json: async () => ({}), text: async () => 'rate limit' }; };
    const h = await load('scheduled-chronicles');
    const j = await (await h(req({}, null, { 'x-cron-secret': 's3cret' }))).json();
    expect(j).toMatchObject({ emailsSent: 0, emailsFailed: 1 });
    expect(deliveries()[0]).toMatchObject({ status: 'failed', attempts: 1 });
    expect(world.tables.chronicles).toHaveLength(1);
  });
  it('mode PDF : un vrai PDF est joint ; la douleur n\'y figure pas par défaut', async () => {
    Object.assign(envVars, MAIL_ENV);
    setSystemTime(NOW);
    world.tables.profile_settings[0].chronicle_email_mode = 'pdf';
    world.tables.profile_settings[0].track_pain = true;
    const h = await load('scheduled-chronicles');
    await h(req({}, null, { 'x-cron-secret': 's3cret' }));
    const body = JSON.parse(fetchCalls.find((c) => c.url.includes('resend'))!.init.body);
    expect(body.attachments[0].filename).toBe('chronique-2026-10-16.pdf');
    const pdf = Buffer.from(body.attachments[0].content, 'base64');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(world.files.has('chronicles/u1/2026-10-16.pdf')).toBe(true);
  });
  it('sans bilan : « ne rien envoyer » => livraison ignorée, aucune chronique inventée', async () => {
    Object.assign(envVars, MAIL_ENV);
    setSystemTime(NOW);
    world.tables.checkins = []; world.tables.checkin_answers = [];
    const h = await load('scheduled-chronicles');
    const j = await (await h(req({}, null, { 'x-cron-secret': 's3cret' }))).json();
    expect(j).toMatchObject({ chronicles: 0, emailsSent: 0 });
    expect(j.skipped).toBeGreaterThanOrEqual(1);
    expect(world.tables.chronicles ?? []).toHaveLength(0);
    expect(deliveries()[0].status).toBe('skipped');
    expect(fetchCalls).toHaveLength(0);
  });
  it('compte désactivé ou non terminé : ignoré', async () => {
    Object.assign(envVars, MAIL_ENV);
    setSystemTime(NOW);
    world.tables.profiles[0].deactivated_at = '2026-10-01T00:00:00Z';
    const h = await load('scheduled-chronicles');
    expect(await (await h(req({}, null, { 'x-cron-secret': 's3cret' }))).json()).toMatchObject({ users: 0, chronicles: 0 });
  });
});

describe('médias', () => {
  const png = () => { const b = new Uint8Array(64); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
  const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  beforeEach(() => { world.tokens.set('tok-u1', { id: U, email: 'u1@example.com' }); world.tables.profiles[0].id = U; world.tables.profile_settings[0].user_id = U; });
  const media = (over: object = {}) => ({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', owner_id: U, kind: 'image', display_name: 'photo.png', bucket: 'temp-uploads', storage_path: `${U}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, declared_mime: 'image/png', size_bytes: 64, status: 'uploading', ...over });

  it('init : crée la fiche et une URL de dépôt ; refuse trop gros, sans extension, sous sanction, < 15 ans', async () => {
    const h = await load('media-upload-init');
    const ok = await (await h(req({ filename: 'a.png', size: 1000, mime: 'image/png', kind: 'image' }))).json();
    expect(ok.mediaId).toBeTruthy();
    expect(world.tables.media_assets[0]).toMatchObject({ owner_id: U, status: 'uploading', bucket: 'temp-uploads' });
    expect(world.tables.media_assets[0].storage_path).toBe(`${U}/${ok.mediaId}`); // nom serveur, pas le nom du fichier
    expect(world.calls.signed).toHaveLength(1);
    expect((await h(req({ filename: 'a.png', size: 6 * 1024 * 1024, mime: 'image/png', kind: 'image' }))).status).toBe(422);
    expect((await h(req({ filename: 'sans-extension', size: 10, kind: 'image' }))).status).toBe(422);
    world.tables.sanctions = [{ user_id: U, kind: 'ban', revoked_at: null, starts_at: '2026-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' }];
    expect((await h(req({ filename: 'a.png', size: 10, kind: 'image' }))).status).toBe(403);
    world.tables.sanctions = [];
    world.tables.profile_settings[0].age_band = 'under_15';
    expect((await h(req({ filename: 'a.png', size: 10, kind: 'image' }))).status).toBe(403);
  });
  it('finalize : vraie image => relecture humaine (jamais approuvée), déplacée vers le bucket communautaire privé', async () => {
    world.tables.media_assets = [media()];
    world.files.set(`temp-uploads/${U}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, png());
    const h = await load('media-upload-finalize');
    const j = await (await h(req({ mediaId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }))).json();
    expect(j.status).toBe('pending_review');
    const m = world.tables.media_assets[0];
    expect(m).toMatchObject({ status: 'pending_review', bucket: 'community-media', detected_mime: 'image/png' });
    expect(m.storage_path).toBe(`${U}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`);
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(world.files.has(`community-media/${m.storage_path}`)).toBe(true);
    expect(world.files.has(`temp-uploads/${U}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`)).toBe(false);
  });
  it('finalize : exécutable renommé en .png => rejeté/quarantaine, supprimé du dépôt temporaire, jamais publié', async () => {
    world.tables.media_assets = [media()];
    const exe = new Uint8Array(64); exe.set([0x4d, 0x5a, 0x90]);
    world.files.set(`temp-uploads/${U}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, exe);
    const h = await load('media-upload-finalize');
    const r = await h(req({ mediaId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
    expect(r.status).toBe(422);
    expect(['rejected', 'quarantined']).toContain(world.tables.media_assets[0].status);
    expect([...world.files.keys()].some((k) => k.startsWith('community-media/'))).toBe(false);
    expect(world.files.has(`temp-uploads/${U}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`)).toBe(false);
  });
  it('finalize : taille différente de celle annoncée => rejet ; fichier d\'un autre membre => 404', async () => {
    world.tables.media_assets = [media({ size_bytes: 9999 })];
    world.files.set(`temp-uploads/${U}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, png());
    const h = await load('media-upload-finalize');
    expect((await h(req({ mediaId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }))).status).toBe(422);
    world.tables.media_assets = [media({ owner_id: 'autre' })];
    expect((await h(req({ mediaId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }))).status).toBe(404);
  });
});

describe('suppression de compte et maintenance', () => {
  it('delete-account : confirmation exigée ; fichiers puis compte supprimés', async () => {
    world.files.set('private-documents/u1/doc.pdf', new Uint8Array([1])); world.files.set('chronicles/u1/2026-10-16.pdf', new Uint8Array([1])); world.files.set('chronicles/u2/x.pdf', new Uint8Array([1]));
    const h = await load('delete-account');
    expect((await h(req({}))).status).toBe(400);
    expect((await h(req({ confirm: 'supprimer' }))).status).toBe(400);
    expect((await h(req({ confirm: 'SUPPRIMER' }))).status).toBe(200);
    expect(world.calls.deletedUsers).toEqual(['u1']);
    expect(world.files.has('private-documents/u1/doc.pdf')).toBe(false);
    expect(world.files.has('chronicles/u1/2026-10-16.pdf')).toBe(false);
    expect(world.files.has('chronicles/u2/x.pdf')).toBe(true); // les fichiers des autres ne sont pas touchés
  });
  it('maintenance : secret obligatoire ; purge les dépôts abandonnés', async () => {
    const old = new Date(Date.now() - 3 * 86400_000).toISOString();
    world.tables.media_assets = [{ id: 'm1', owner_id: 'u1', status: 'uploading', bucket: 'temp-uploads', storage_path: 'u1/m1', created_at: old }];
    world.files.set('temp-uploads/u1/m1', new Uint8Array([1]));
    const h = await load('maintenance');
    expect((await h(req({}, null))).status).toBe(401);
    const j = await (await h(req({}, null, { 'x-cron-secret': 's3cret' }))).json();
    expect(j.abandonedUploads).toBe(1);
    expect(world.files.has('temp-uploads/u1/m1')).toBe(false);
  });
});
