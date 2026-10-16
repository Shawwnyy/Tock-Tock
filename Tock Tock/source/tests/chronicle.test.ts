import { describe, it, expect } from 'bun:test';
import { buildTemplateChronicle, formatDateFr, chronicleToText } from '../supabase/functions/_shared/chronicle.ts';
import type { Answer, Checkin } from '../supabase/functions/_shared/types.ts';

const sc = (cat: string, name: string, v: number | null): Answer => ({
  snapshot: { indicator_id: name, name, category_id: cat, category_name: cat, response_type: 'scale', scale_min: 0, scale_max: 10, choices: null, include_in_average: true },
  value_num: v, value_text: null, value_choice: null,
});
const opts = { includeNotes: true, includeGoals: true, includePain: true, includeHistory: true };
const checkin: Checkin = {
  checkin_date: '2026-10-16', events_note: 'Rendez-vous chez le dentiste', day_note: 'Journée longue', pain_score: 6, pain_zone: 'dos',
  answers: [sc('Humeur', 'Joie', 8), sc('Humeur', 'Calme', 2), sc('Corps', 'Sommeil', 5), sc('Corps', 'Énergie', null)],
};

describe('chronique gabarit', () => {
  it('dates en français', () => {
    expect(formatDateFr('2026-10-16')).toBe('vendredi 16 octobre 2026');
    expect(formatDateFr('2026-03-01')).toBe('dimanche 1er mars 2026');
  });
  it('contient uniquement des faits issus des données', () => {
    const c = buildTemplateChronicle({ date: '2026-10-16', checkin, options: opts });
    expect(c.insufficient).toBe(false);
    expect(c.sections.summary).toContain('5,0/10');
    expect(c.sections.positives).toContain('Joie');
    expect(c.sections.difficulties).toContain('Calme');
    expect(c.sections.remember).toContain('dentiste');
    expect(c.sections.pain).toContain('6/10');
    expect(c.data_used).toMatchObject({ checkin: true, notes: true, pain: true });
    // la moyenne des catégories : Humeur 5, Corps 5 => 5
    expect(c.stats!.general).toBe(5);
  });
  it('la douleur et les notes n\'apparaissent pas sans autorisation', () => {
    const c = buildTemplateChronicle({ date: '2026-10-16', checkin, options: { ...opts, includePain: false, includeNotes: false } });
    expect(c.sections.pain).toBeUndefined();
    expect(c.sections.remember).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain('dentiste');
    expect(JSON.stringify(c.sections)).not.toContain('dos');
    expect(c.data_used.pain).toBe(false);
  });
  it('données insuffisantes => aucune chronique inventée', () => {
    const none = buildTemplateChronicle({ date: '2026-10-16', checkin: null, options: opts });
    expect(none.insufficient).toBe(true);
    expect(Object.keys(none.sections)).toEqual(['notice']);
    const empty = buildTemplateChronicle({ date: '2026-10-16', checkin: { checkin_date: '2026-10-16', answers: [sc('A', 'x', null)] }, options: opts });
    expect(empty.insufficient).toBe(true);
  });
  it('bilan avec notes seulement mais notes non autorisées => insuffisant', () => {
    const c = buildTemplateChronicle({ date: '2026-10-16', checkin: { checkin_date: '2026-10-16', events_note: 'secret', answers: [] }, options: { ...opts, includeNotes: false } });
    expect(c.insufficient).toBe(true);
    expect(JSON.stringify(c)).not.toContain('secret');
  });
  it('comparaison avec le bilan précédent', () => {
    const prev: Checkin = { checkin_date: '2026-10-15', answers: [sc('A', 'x', 3)] };
    const c = buildTemplateChronicle({ date: '2026-10-16', checkin, previousCheckin: prev, options: opts });
    expect(c.sections.reflection).toContain('plus haute');
    expect(c.data_used.history).toBe(true);
    const off = buildTemplateChronicle({ date: '2026-10-16', checkin, previousCheckin: prev, options: { ...opts, includeHistory: false } });
    expect(off.sections.reflection).toBeUndefined();
  });
  it('objectifs : seulement les étapes réellement validées', () => {
    const c = buildTemplateChronicle({
      date: '2026-10-16', checkin, options: opts,
      goals: [{ title: 'Marcher', status: 'in_progress', stepsDoneToday: ['Sortir 10 min'], nextStep: 'Sortir 15 min' }, { title: 'Lire', status: 'todo' }],
    });
    expect(c.sections.goals).toContain('Sortir 10 min');
    expect(c.sections.goals).not.toContain('Lire');
    expect(c.sections.tomorrow).toContain('Sortir 15 min');
  });
  it('texte brut lisible', () => {
    const t = chronicleToText(buildTemplateChronicle({ date: '2026-10-16', checkin, options: opts }));
    expect(t.startsWith('Chronique de minuit')).toBe(true);
    expect(t).toContain('Résumé');
  });
});
