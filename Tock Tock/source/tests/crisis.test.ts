import { describe, it, expect } from 'bun:test';
import { detectCrisis, crisisMessage, resourcesFor, countryFromTimezone } from '../supabase/functions/_shared/crisis.ts';

describe('détection de crise', () => {
  it.each([
    'Je veux me suicider', "j'ai envie de mourir", 'Je veux mourir', "Je n'ai plus envie de vivre", 'je vais me faire du mal',
    "Ce serait mieux sans moi", 'Je pense à en finir avec la vie', 'I want to die',
  ])('crise : %s', (t) => expect(detectCrisis(t)).toBe('crisis'));
  it.each(['Je vais très mal', 'je me sens seul', 'je me déteste', "J'ai fait une crise d'angoisse"])('détresse : %s', (t) => expect(detectCrisis(t)).toBe('distress'));
  it.each(['Quelle belle journée', 'Comment modifier mon indicateur de sommeil ?', 'Mon bilan est nul aujourd\'hui... non, bon', '', 'Je suis tué de fatigue'])('rien : %s', (t) => {
    expect(['none', 'distress']).toContain(detectCrisis(t));
  });
  it('accents et casse ignorés', () => expect(detectCrisis('JE VEUX ME SUICIDER')).toBe('crisis'));
  it('message de crise fixe avec ressources locales', () => {
    const m = crisisMessage('crisis', 'FR');
    expect(m.resources.map((r) => r.contact)).toContain('3114');
    expect(m.text).toContain('pas un service d\'urgence');
    expect(resourcesFor('BE').map((r) => r.contact)).toContain('0800 32 123');
    expect(resourcesFor('CA').map((r) => r.contact)).toContain('988');
    expect(resourcesFor('ZZ').length).toBeGreaterThan(1);
  });
  it('pays depuis fuseau', () => {
    expect(countryFromTimezone('America/Toronto')).toBe('CA');
    expect(countryFromTimezone('Europe/Brussels')).toBe('BE');
    expect(countryFromTimezone('Europe/Paris')).toBe('FR');
  });
});
