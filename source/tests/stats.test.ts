import { describe, it, expect } from 'bun:test';
import { computeCheckinStats, answerToTen, formatScore, buildDailySeries, aggregatePeriods, weekStart, addDays, explainAverage, rangeFor, indicatorSeries, periodGeneralAverage } from '../supabase/functions/_shared/stats.ts';
import type { Answer, Checkin } from '../supabase/functions/_shared/types.ts';

const scale = (cat: string, name: string, v: number | null, min = 0, max = 10, incl = true): Answer => ({
  snapshot: { indicator_id: name, name, category_id: cat, category_name: cat, response_type: 'scale', scale_min: min, scale_max: max, choices: null, include_in_average: incl },
  value_num: v, value_text: null, value_choice: null,
});

describe('moyennes', () => {
  it('moyenne générale = moyenne des moyennes de catégories (pas des réponses)', () => {
    // A: 3 réponses à 9 => 9 ; B: 1 réponse à 3 => 3 ; moyenne des réponses = 7,5 ; moyenne des catégories = 6
    const s = computeCheckinStats([scale('A', 'a1', 9), scale('A', 'a2', 9), scale('A', 'a3', 9), scale('B', 'b1', 3)]);
    expect(s.general).toBe(6);
    expect(s.categoriesWithData).toBe(2);
    expect(s.numericCount).toBe(4);
  });
  it('une réponse vide n\'est jamais un zéro', () => {
    const s = computeCheckinStats([scale('A', 'a1', 8), scale('A', 'a2', null)]);
    expect(s.categories[0].average).toBe(8);
    expect(s.categories[0].count).toBe(1);
  });
  it('un vrai zéro est compté comme zéro', () => {
    const s = computeCheckinStats([scale('A', 'a1', 0), scale('A', 'a2', 10)]);
    expect(s.categories[0].average).toBe(5);
  });
  it('catégorie sans donnée => null, ignorée de la moyenne générale', () => {
    const s = computeCheckinStats([scale('A', 'a1', 4), scale('B', 'b1', null)]);
    expect(s.categories.find((c) => c.key === 'B')!.average).toBeNull();
    expect(s.general).toBe(4);
  });
  it('aucune donnée => Moyenne indisponible', () => {
    const s = computeCheckinStats([scale('A', 'a1', null)]);
    expect(s.general).toBeNull();
    expect(explainAverage(s)).toContain('Moyenne indisponible');
    expect(computeCheckinStats([]).general).toBeNull();
  });
  it('normalise les échelles différentes sur 10', () => {
    expect(answerToTen(scale('A', 'x', 3, 1, 5))).toBe(5);
    expect(answerToTen(scale('A', 'x', 5, 1, 5))).toBe(10);
    expect(answerToTen(scale('A', 'x', 1, 1, 5))).toBe(0);
    expect(answerToTen(scale('A', 'x', 11, 0, 10))).toBeNull();
    expect(answerToTen(scale('A', 'x', 4, 5, 5))).toBeNull();
  });
  it('exclut les indicateurs désactivés dans la moyenne, les textes, les oui/non et les choix sans score', () => {
    const base = scale('A', 'a', 7).snapshot;
    expect(answerToTen(scale('A', 'a', 7, 0, 10, false))).toBeNull();
    expect(answerToTen({ snapshot: { ...base, response_type: 'text' }, value_num: null, value_text: 'bla', value_choice: null })).toBeNull();
    expect(answerToTen({ snapshot: { ...base, response_type: 'boolean' }, value_num: 1, value_text: null, value_choice: null })).toBeNull();
    const ch = { ...base, response_type: 'choice' as const, choices: [{ label: 'Bien', score: 8 }, { label: 'Autre', score: null }] };
    expect(answerToTen({ snapshot: ch, value_num: null, value_text: null, value_choice: 'Bien' })).toBe(8);
    expect(answerToTen({ snapshot: ch, value_num: null, value_text: null, value_choice: 'Autre' })).toBeNull();
    expect(answerToTen({ snapshot: ch, value_num: null, value_text: null, value_choice: 'Inconnu' })).toBeNull();
  });
  it('la douleur n\'entre pas dans les moyennes (colonnes dédiées)', () => {
    const c: Checkin = { checkin_date: '2026-10-01', pain_score: 9, answers: [scale('A', 'a', 6)] };
    expect(computeCheckinStats(c.answers).general).toBe(6);
  });
  it('arrondi à l\'affichage uniquement', () => {
    const s = computeCheckinStats([scale('A', 'a', 7), scale('A', 'b', 8), scale('A', 'c', 8)]);
    expect(s.general).toBeCloseTo(7.6666667, 6);
    expect(formatScore(s.general)).toBe('7,7');
    expect(formatScore(null)).toBe('—');
    expect(formatScore(7.25)).toBe('7,3');
  });
});

describe('séries et périodes', () => {
  const c = (d: string, v: number | null): Checkin => ({ checkin_date: d, answers: [scale('A', 'a', v)] });
  it('les jours sans bilan sont des trous (null), jamais des zéros', () => {
    const s = buildDailySeries([c('2026-10-01', 8), c('2026-10-03', 0)], '2026-10-01', '2026-10-04');
    expect(s.map((p) => p.general)).toEqual([8, null, 0, null]);
    expect(s.map((p) => p.hasCheckin)).toEqual([true, false, true, false]);
  });
  it('un bilan sans valeur numérique reste un trou mais « a un bilan »', () => {
    const s = buildDailySeries([c('2026-10-01', null)], '2026-10-01', '2026-10-01');
    expect(s[0]).toMatchObject({ hasCheckin: true, general: null });
  });
  it('agrégation hebdomadaire / mensuelle sans compter les jours vides', () => {
    const series = buildDailySeries([c('2026-10-05', 4), c('2026-10-07', 8), c('2026-11-02', 2)], '2026-10-01', '2026-11-05');
    const w = aggregatePeriods(series, 'week');
    expect(w.find((p) => p.key === '2026-10-05')).toMatchObject({ value: 6, days: 2 });
    expect(w.find((p) => p.key === '2026-10-12')).toMatchObject({ value: null, days: 0 });
    const m = aggregatePeriods(series, 'month');
    expect(m.map((p) => [p.key, p.value])).toEqual([['2026-10', 6], ['2026-11', 2]]);
  });
  it('lundi de semaine, ajout de jours, passage d\'année, bissextile', () => {
    expect(weekStart('2026-10-16')).toBe('2026-10-12');
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('plages prédéfinies', () => {
    expect(rangeFor('7d', '2026-10-16')).toEqual({ from: '2026-10-10', to: '2026-10-16' });
    expect(rangeFor('30d', '2026-10-16').from).toBe('2026-09-17');
  });
  it('série d\'un indicateur et moyenne de période', () => {
    const cs = [c('2026-10-01', 2), c('2026-10-03', 6)];
    expect(indicatorSeries(cs, 'a', '2026-10-01', '2026-10-03').map((p) => p.value)).toEqual([2, null, 6]);
    expect(periodGeneralAverage(buildDailySeries(cs, '2026-10-01', '2026-10-03'))).toEqual({ value: 4, days: 2 });
  });
});
