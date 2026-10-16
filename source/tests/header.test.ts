// En-tête : heure à la seconde dans le bon fuseau, numéro aléatoire local stable et bien formé.
import { describe, expect, test } from 'bun:test';
import { formatClock, formatClockDate, msToNextSecond } from '../src/local/clock.ts';
import { getState, normalizeStore, randomHandle, update } from '../src/local/store.ts';

describe('heure', () => {
  test('HH:MM:SS dans le fuseau demandé (heure d\'été de Paris = UTC+2)', () => {
    const d = new Date('2026-10-16T18:44:12Z');
    expect(formatClock(d, 'Europe/Paris')).toBe('20:44:12');
    expect(formatClock(d, 'UTC')).toBe('18:44:12');
    expect(formatClock(d, 'America/New_York')).toBe('14:44:12');
  });
  test('minuit s\'écrit 00:00:00 (pas 24:00:00) et le changement d\'heure est suivi', () => {
    expect(formatClock(new Date('2026-10-16T22:00:00Z'), 'Europe/Paris')).toBe('00:00:00');
    expect(formatClock(new Date('2026-10-25T01:30:00Z'), 'Europe/Paris')).toBe('02:30:00'); // après le retour à l'heure d'hiver (UTC+1)
  });
  test('fuseau invalide ou vide : repli sans erreur', () => {
    expect(formatClock(new Date('2026-10-16T18:44:12Z'), 'Pas/Un_Fuseau')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatClock(new Date('2026-10-16T18:44:12Z'), '')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
  test('date complète en français pour l\'infobulle', () => {
    expect(formatClockDate(new Date('2026-10-16T18:44:12Z'), 'Europe/Paris')).toBe('vendredi 16 octobre 2026');
  });
  test('la prochaine mise à jour tombe juste après la seconde pleine, jamais en retard d\'une seconde', () => {
    expect(msToNextSecond(1_000_000_000_000)).toBe(1005);
    expect(msToNextSecond(1_000_000_000_999)).toBe(6);
    for (const ms of [0, 1, 500, 999]) { const w = msToNextSecond(1_000_000_000_000 + ms); expect(w).toBeGreaterThan(0); expect(w).toBeLessThanOrEqual(1005); }
  });
});

describe('numéro aléatoire local', () => {
  test('5 chiffres, varié', () => {
    const set = new Set(Array.from({ length: 60 }, randomHandle));
    for (const h of set) expect(h).toMatch(/^\d{5}$/);
    expect(set.size).toBeGreaterThan(40);
  });
  test('le magasin en possède un, il persiste, et un ancien enregistrement sans numéro en reçoit un valide', () => {
    expect(getState().settings.handle).toMatch(/^\d{5}$/);
    const before = getState().settings.handle;
    update((n) => { n.settings.name = 'Léo'; });
    expect(getState().settings.handle).toBe(before);
    const old = structuredClone(getState()) as unknown as { settings: Record<string, unknown> };
    delete old.settings.handle;
    expect(normalizeStore(old).settings.handle).toMatch(/^\d{5}$/);
    old.settings.handle = '<script>';
    expect(normalizeStore(old).settings.handle).toMatch(/^\d{5}$/);
    old.settings.handle = '12345';
    expect(normalizeStore(old).settings.handle).toBe('12345');
  });
});
