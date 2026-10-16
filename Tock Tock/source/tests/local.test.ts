// Logique de la version locale « Tock Tock » : séries, corrélations, indicateurs par défaut, export, chroniques de rattrapage.
import { describe, expect, test } from 'bun:test';
import { csvExport, ensureChronicles, getState, makeChronicle, pearson, restoreDefaults, streaks, today, update, snapshotOf, activeIndicators } from '../src/local/store.ts';

describe('streaks', () => {
  test('série en cours, meilleure série, total', () => {
    const r = streaks(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-14', '2026-10-15', '2026-10-16'], '2026-10-16');
    expect(r).toEqual({ current: 3, best: 3, total: 6 });
  });
  test('aujourd\'hui pas encore fait : la série d\'hier compte toujours', () => {
    expect(streaks(['2026-10-14', '2026-10-15'], '2026-10-16').current).toBe(2);
  });
  test('trou d\'un jour : la série repart de zéro', () => {
    expect(streaks(['2026-10-10', '2026-10-14'], '2026-10-16').current).toBe(0);
  });
  test('aucune donnée', () => expect(streaks([], '2026-10-16')).toEqual({ current: 0, best: 0, total: 0 }));
});

describe('pearson', () => {
  test('moins de 10 points => null (pas d\'observation fragile)', () => expect(pearson([1, 2, 3], [1, 2, 3])).toBeNull());
  test('corrélation parfaite et inverse', () => {
    const x = Array.from({ length: 12 }, (_, i) => i);
    expect(pearson(x, x)).toBeCloseTo(1, 10);
    expect(pearson(x, x.map((v) => -v))).toBeCloseTo(-1, 10);
  });
  test('série constante => null', () => expect(pearson(Array(12).fill(3), Array.from({ length: 12 }, (_, i) => i))).toBeNull());
});

describe('données par défaut et chroniques', () => {
  test('20 indicateurs actifs répartis en 5 catégories ; restoreDefaults ne duplique rien', () => {
    const s = getState();
    expect(activeIndicators(s).length).toBe(20);
    expect(s.categories.length).toBe(5);
    update((n) => restoreDefaults(n));
    expect(getState().indicators.length).toBe(20);
    expect(getState().categories.length).toBe(5);
  });

  test('chronique de rattrapage : créée pour un jour PASSÉ avec bilan, jamais pour un jour sans données', () => {
    const s0 = getState();
    update((n) => { n.settings.onboarded = true; n.settings.chronicle_auto = true; });
    const t = today(getState());
    const y = new Date(Date.parse(`${t}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const mood = activeIndicators(s0).find((i) => i.template_key === 'mood')!;
    update((n) => {
      n.checkins[y] = { checkin_date: y, answers: [{ snapshot: snapshotOf(n, mood), value_num: 8, value_text: null, value_choice: null }], tags: [], updated_at: new Date().toISOString(), day_note: 'Une bonne journée.' };
    });
    expect(ensureChronicles()).toBe(1);
    const c = getState().chronicles[y];
    expect(c.title).toContain('Chronique de minuit');
    expect(c.insufficient).toBe(false);
    expect(ensureChronicles()).toBe(0); // idempotent
    const empty = makeChronicle(getState(), '2020-01-01');
    expect(empty.insufficient).toBe(true); // aucun bilan : aucune « fausse » chronique
  });

  test('export CSV : en-tête, valeur sur 10 exacte, échappement des guillemets', () => {
    const csv = csvExport(getState());
    const lines = csv.replace('﻿', '').split('\n');
    expect(lines[0]).toContain('valeur_sur_10');
    expect(lines.some((l) => l.includes('"Moral général"') && l.includes('"8.00"'))).toBe(true);
  });
});
