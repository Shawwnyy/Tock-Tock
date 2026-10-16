import { describe, it, expect } from 'bun:test';
import { localNow, dueChronicleDates, chronicleDateForDelivery, reminderDueDate, isValidTimezone } from '../supabase/functions/_shared/schedule.ts';

const at = (iso: string) => new Date(iso);

describe('fuseaux horaires', () => {
  it('heure locale Europe/Paris été et hiver', () => {
    expect(localNow('Europe/Paris', at('2026-07-01T20:30:00Z'))).toMatchObject({ date: '2026-07-01', time: '22:30' });
    expect(localNow('Europe/Paris', at('2026-12-01T20:30:00Z'))).toMatchObject({ date: '2026-12-01', time: '21:30' });
    expect(localNow('America/Toronto', at('2026-12-01T02:30:00Z'))).toMatchObject({ date: '2026-11-30', time: '21:30' });
    expect(localNow('Europe/Paris', at('2026-12-31T23:30:00Z'))).toMatchObject({ date: '2027-01-01', time: '00:30' });
  });
  it('fuseau invalide', () => {
    expect(isValidTimezone('Europe/Paris')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('chroniques dues', () => {
  const due = (tz: string, time: string, iso: string, extra: object = {}) => dueChronicleDates({ timezone: tz, deliveryTime: time, now: at(iso), ...extra });
  it('21:30 => journée en cours ; 00:05 => veille', () => {
    expect(chronicleDateForDelivery('2026-10-16', '21:30')).toBe('2026-10-16');
    expect(chronicleDateForDelivery('2026-10-16', '00:05')).toBe('2026-10-15');
    expect(chronicleDateForDelivery('2026-10-16', '11:59')).toBe('2026-10-15');
    expect(chronicleDateForDelivery('2026-10-16', '12:00')).toBe('2026-10-16');
  });
  it('pas encore l\'heure => rien pour aujourd\'hui', () => {
    // 21:00 à Paris (19:00 UTC en octobre, UTC+2) ; livraison prévue 21:30
    expect(due('Europe/Paris', '21:30', '2026-10-16T19:00:00Z', { notBefore: '2026-10-16' })).toEqual([]);
  });
  it('à l\'heure => due ; déjà livrée => filtrée', () => {
    const iso = '2026-10-16T19:31:00Z'; // 21:31 Paris
    expect(due('Europe/Paris', '21:30', iso, { notBefore: '2026-10-16' })).toEqual(['2026-10-16']);
    expect(due('Europe/Paris', '21:30', iso, { notBefore: '2026-10-16', alreadyDelivered: new Set(['2026-10-16']) })).toEqual([]);
  });
  it('rattrapage après panne : encore due 4 h plus tard ; plus due après 36 h ; les jours antérieurs à l\'activation sont ignorés', () => {
    expect(due('Europe/Paris', '21:30', '2026-10-17T01:30:00Z', { notBefore: '2026-10-16' })).toEqual(['2026-10-16']);
    expect(due('Europe/Paris', '21:30', '2026-10-18T07:29:00Z')).toContain('2026-10-16'); // 35 h 59 après
    expect(due('Europe/Paris', '21:30', '2026-10-18T07:31:00Z')).not.toContain('2026-10-16'); // 36 h 01 après
  });
  it('00:05 => livre la veille, juste après minuit local', () => {
    expect(due('Europe/Paris', '00:05', '2026-10-15T22:06:00Z', { notBefore: '2026-10-15' })).toEqual(['2026-10-15']);
    expect(due('Europe/Paris', '00:05', '2026-10-15T21:50:00Z', { notBefore: '2026-10-15' })).toEqual([]);
  });
  it('retour à l\'heure d\'hiver (2026-10-25, Paris)', () => {
    // 21:30 locale le 25/10 = 20:30 UTC (UTC+1) ; le 24/10 (UTC+2) = 19:30 UTC.
    expect(due('Europe/Paris', '21:30', '2026-10-25T20:00:00Z', { notBefore: '2026-10-25' })).toEqual([]); // 21:00 locale
    expect(due('Europe/Paris', '21:30', '2026-10-25T20:31:00Z', { notBefore: '2026-10-25' })).toEqual(['2026-10-25']);
    expect(due('Europe/Paris', '21:30', '2026-10-24T19:31:00Z', { notBefore: '2026-10-24' })).toEqual(['2026-10-24']);
  });
  it('heure inexistante lors du passage à l\'heure d\'été (2026-03-29, Paris, 02:30) : livrée une fois, sans trou', () => {
    // 02:30 n'existe pas le 29/03 ; la chronique de la veille (28/03) devient due à 03:00 CEST = 01:00 UTC.
    expect(due('Europe/Paris', '02:30', '2026-03-29T00:30:00Z', { notBefore: '2026-03-28' })).toEqual([]); // 01:30 CET
    expect(due('Europe/Paris', '02:30', '2026-03-29T01:00:00Z', { notBefore: '2026-03-28' })).toEqual(['2026-03-28']);
    expect(due('Europe/Paris', '02:30', '2026-03-29T01:00:00Z', { notBefore: '2026-03-28', alreadyDelivered: new Set(['2026-03-28']) })).toEqual([]);
  });
  it('plusieurs fuseaux au même instant', () => {
    const iso = '2026-10-17T02:00:00Z';
    expect(due('Asia/Tokyo', '21:30', iso, { notBefore: '2026-10-16' })).toEqual(['2026-10-16']); // 11:00 le 17 à Tokyo, rattrapage
    expect(due('America/Los_Angeles', '21:30', iso, { notBefore: '2026-10-16' })).toEqual([]); // 19:00 le 16 à LA
  });
});

describe('rappel de bilan', () => {
  const args = { timezone: 'Europe/Paris', reminderTime: '20:00' };
  it('pas avant l\'heure, dû ensuite, une seule fois, plus dû après 6 h', () => {
    expect(reminderDueDate({ ...args, now: at('2026-10-16T17:00:00Z') })).toBeNull(); // 19:00 locale
    expect(reminderDueDate({ ...args, now: at('2026-10-16T18:30:00Z') })).toBe('2026-10-16'); // 20:30
    expect(reminderDueDate({ ...args, now: at('2026-10-16T18:30:00Z'), alreadySent: new Set(['2026-10-16']) })).toBeNull();
    expect(reminderDueDate({ ...args, now: at('2026-10-17T00:30:00Z') })).toBeNull(); // 02:30 locale le 17
  });
});
