// Logique de la discussion côté appareil : nom#, bilan partagé (sobriété), données reçues non fiables, sauvegarde sans clé secrète.
import { describe, expect, test } from 'bun:test';
import { applyIncoming, buildSnapshot, cleanName, myTag, parseTag, sanitizeSnapshot, unreadTotal } from '../src/local/chat.ts';
import { buildBackupPdf, extractAttachment, mergeRestored } from '../src/local/backup.ts';
import { activeIndicators, getState, normalizeStore, snapshotOf, today, update } from '../src/local/store.ts';
import { EXERCISES } from '../src/local/data.ts';
import { weekCount } from '../src/local/exercises.tsx';
import { greeting } from '../src/local/home.tsx';

describe('nom#', () => {
  test('lecture : nom + 5 chiffres exigés', () => {
    expect(parseTag('Léo#18428')).toEqual({ name: 'Léo', num: '18428' });
    expect(parseTag('  Marie Dupont # 04211 ')).toEqual({ name: 'Marie Dupont', num: '04211' });
    for (const bad of ['', '#18428', 'Léo', 'Léo#1842', 'Léo#184285', 'Léo#abcde']) expect(parseTag(bad)).toBeNull();
  });
  test('nettoyage du nom : pas de #, pas de contrôle, 24 caractères, repli « Anonyme »', () => {
    expect(cleanName('Le#o\u0007')).toBe('Leo');
    expect(cleanName('x'.repeat(40))).toHaveLength(24);
    expect(cleanName('   ')).toBe('Anonyme');
    update((n) => { n.settings.name = 'Léo'; n.settings.handle = '18428'; });
    expect(myTag(getState())).toBe('Léo#18428');
  });
});

describe('bilan partagé', () => {
  function withCheckin(pain: boolean) {
    const mood = activeIndicators(getState()).find((i) => i.template_key === 'mood')!;
    const sleep = activeIndicators(getState()).find((i) => i.template_key === 'sleep')!;
    update((n) => { const t = today(n); n.checkins = { [t]: { checkin_date: t, tags: [], updated_at: new Date().toISOString(), pain_score: pain ? 6 : null, pain_zone: 'Dos', day_note: 'SECRET',
      answers: [{ snapshot: snapshotOf(n, mood), value_num: 8, value_text: null, value_choice: null }, { snapshot: snapshotOf(n, sleep), value_num: 4, value_text: null, value_choice: null }] } }; });
  }
  test('par défaut : moyennes seulement, ni douleur ni note ; catégories sans réponse absentes (jamais 0)', () => {
    withCheckin(true);
    const s = buildSnapshot(getState(), { pain: false, note: false });
    expect(s.general).toBe(6);
    expect(s.pain).toBeUndefined(); expect(s.note).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('SECRET');
    expect(s.categories.map((c) => c.avg)).toEqual([8, 4]); // les catégories sans réponse sont ABSENTES, jamais comptées comme 0
  });
  test('douleur et note seulement si cochées', () => {
    const s = buildSnapshot(getState(), { pain: true, note: true });
    expect(s.pain).toEqual({ score: 6, zone: 'Dos' }); expect(s.note).toBe('SECRET');
  });
  test('sans bilan du jour : « empty », jamais une moyenne inventée', () => {
    update((n) => { n.checkins = {}; });
    const s = buildSnapshot(getState(), { pain: true, note: true });
    expect(s).toMatchObject({ empty: true, general: null, categories: [] });
  });
});

describe('données reçues (non fiables)', () => {
  test('bilan reçu : bornes, types, tailles', () => {
    const s = sanitizeSnapshot({ date: '2026-10-16', general: 99, categories: [{ name: 'x'.repeat(100), avg: -5 }, { name: 'Ok', avg: 'a' }, ...Array(20).fill({ name: 'z', avg: 1 })], pain: { score: 7, zone: 'y'.repeat(99) }, note: 'n'.repeat(900), extra: '<script>' })!;
    expect(s.general).toBe(10); expect(s.categories[0].avg).toBe(0); expect(s.categories[0].name).toHaveLength(40); expect(s.categories[1].avg).toBeNull();
    expect(s.categories).toHaveLength(10); expect(s.pain!.zone).toHaveLength(40); expect(s.note).toHaveLength(500);
    expect((s as unknown as Record<string, unknown>).extra).toBeUndefined();
    for (const bad of [null, 'x', 42, { date: 'hier' }, { general: 5 }]) expect(sanitizeSnapshot(bad)).toBeNull();
  });
  test('messages reçus : rangés par personne, non lus comptés, demandes en attente, bloqués ignorés, texte nettoyé', () => {
    update((n) => { n.chat.contacts = []; n.chat.threads = {}; n.chat.last_id = 0; });
    const now = new Date().toISOString();
    update((n) => {
      const r = applyIncoming(n, [
        { id: 5, type: 'msg', from: { num: '04211', name: 'Marie' }, text: 'Salut\u0007 !', ts: now },
        { id: 6, type: 'request', from: { num: '04211', name: 'Marie' }, ts: now },
        { id: 7, type: 'bogus', from: { num: '04211', name: 'Marie' }, ts: now },
        { id: 8, type: 'msg', from: { num: 'abc', name: 'Hack' }, text: 'x', ts: now },
      ]);
      expect(r.autoReply).toEqual([]);
    });
    const c = getState().chat;
    expect(c.last_id).toBe(8);
    expect(c.threads['04211'].map((m) => m.t)).toEqual(['msg', 'request']);
    expect(c.threads['04211'][0].text).toBe('Salut !');
    expect(c.threads['04211'][1].state).toBe('pending');
    expect(unreadTotal(getState())).toBe(2);
    update((n) => { n.chat.contacts[0].blocked = true; applyIncoming(n, [{ id: 9, type: 'msg', from: { num: '04211', name: 'Marie' }, text: 'bloqué', ts: now }]); });
    expect(getState().chat.threads['04211'].length).toBe(2);
    expect(unreadTotal(getState())).toBe(0);
  });
  test('autorisation permanente : demande suivie d\'une réponse automatique (moyennes seulement)', () => {
    update((n) => { n.chat.contacts = [{ num: '04211', name: 'Marie', last_ts: '', unread: 0, blocked: false, always_allow: true }]; n.chat.threads = {}; });
    let auto: string[] = [];
    update((n) => { auto = applyIncoming(n, [{ id: 10, type: 'request', from: { num: '04211', name: 'Marie' }, ts: new Date().toISOString() }]).autoReply; });
    expect(auto).toEqual(['04211']);
  });
});

describe('sauvegarde et discussion', () => {
  test('la clé secrète n\'est jamais dans le PDF, et la restauration garde l\'identité de cet appareil', async () => {
    update((n) => { n.chat.token = 'SECRETTOKEN0123456789abcdef'; n.chat.enabled = true; n.chat.contacts = []; n.settings.handle = '11111'; });
    const bytes = await buildBackupPdf(getState());
    const raw = new TextDecoder().decode(await extractAttachment(bytes));
    expect(raw).not.toContain('SECRETTOKEN');
    const restored = normalizeStore(JSON.parse(raw).data);
    const cur = structuredClone(getState()); cur.settings.handle = '22222'; cur.chat.token = 'DEVICE-TOKEN-0123456789abcdef';
    const merged = mergeRestored(restored, cur);
    expect(merged.chat.token).toBe('DEVICE-TOKEN-0123456789abcdef');
    expect(merged.settings.handle).toBe('22222');
  });
});

describe('exercices et accueil', () => {
  test('exercices : identifiants uniques, étapes non vides, durées plausibles, textes non gardés signalés', () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    for (const e of EXERCISES) { expect(e.steps.length).toBeGreaterThan(0); expect(e.minutes).toBeGreaterThan(0); for (const s of e.steps) expect(s.text.length).toBeGreaterThan(5); }
    for (const id of ['soucis', 'lettre']) expect(EXERCISES.find((e) => e.id === id)!.write!.keep).toBe(false);
    expect(EXERCISES.find((e) => e.id === 'gratitude')!.write!.keep).toBe(true);
  });
  test('exercices de la semaine : 7 jours glissants', () => {
    const log = [{ date: '2026-10-10' }, { date: '2026-10-09' }, { date: '2026-10-16' }, { date: '2026-10-17' }];
    expect(weekCount(log, '2026-10-16')).toBe(2);
  });
  test('salutation selon l\'heure', () => {
    expect([greeting(4), greeting(5), greeting(11), greeting(12), greeting(17), greeting(18), greeting(23)]).toEqual(['Bonsoir', 'Bonjour', 'Bonjour', 'Bon après-midi', 'Bon après-midi', 'Bonsoir', 'Bonsoir']);
  });
});
