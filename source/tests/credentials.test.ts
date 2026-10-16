// Format des identifiants de connexion et du code : cas courants, fautes de frappe, numéros français et internationaux.
import { describe, expect, test } from 'bun:test';
import { authErrorMessage, checkCode, checkEmail, checkPhone, maskEmail, maskPhone } from '../src/lib/credentials.ts';

describe('e-mail', () => {
  test('adresses valides, normalisées en minuscules', () => {
    for (const a of ['prenom@exemple.fr', ' Prenom.Nom+tag@Mail.Exemple.COM ', 'a_b-c@sub.domaine.org']) expect(checkEmail(a).ok).toBe(true);
    expect((checkEmail(' Prenom@Exemple.FR ') as { value: string }).value).toBe('prenom@exemple.fr');
  });
  test('adresses refusées, avec une raison lisible', () => {
    const bad: [string, RegExp][] = [['', /Saisis/], ['prenom', /manque le « @ »/], ['a b@c.fr', /espace/], ['a@@c.fr', /seul « @ »/], ['@exemple.fr', /début/], ['a@', /domaine/], ['a@exemple', /fin du domaine/], ['a..b@c.fr', /point/], ['.a@c.fr', /point/], ['a@-c.fr', /domaine/], ['a@c.f', /fin du domaine/], ['a@c.123', /fin du domaine/]];
    for (const [a, re] of bad) { const r = checkEmail(a); expect(r.ok).toBe(false); expect((r as { reason: string }).reason).toMatch(re); }
  });
  test('faute de frappe courante : suggestion, jamais de correction automatique', () => {
    const r = checkEmail('leo@gmial.com');
    expect(r.ok).toBe(true);
    expect((r as { value: string }).value).toBe('leo@gmial.com');
    expect((r as { hint?: string }).hint).toContain('leo@gmail.com');
    expect((checkEmail('leo@gmail.com') as { hint?: string }).hint).toBeUndefined();
  });
});

describe('téléphone', () => {
  const ok = (s: string) => { const r = checkPhone(s); expect(r.ok).toBe(true); return (r as { value: { e164: string; display: string } }).value; };
  test('mobile français sous toutes ses formes -> E.164', () => {
    for (const s of ['06 12 34 56 78', '0612345678', '06.12.34.56.78', '06-12-34-56-78', '+33 6 12 34 56 78', '+33612345678', '0033612345678', '+33 (0)6 12 34 56 78', '+33 06 12 34 56 78', '612345678']) expect(ok(s).e164).toBe('+33612345678');
    expect(ok('07 98 76 54 32').e164).toBe('+33798765432');
    expect(ok('06 12 34 56 78').display).toBe('+33 6 12 34 56 78');
  });
  test('ligne fixe ou box française : refusée avec une explication (pas de SMS possible)', () => {
    for (const s of ['01 23 45 67 89', '04 12 34 56 78', '09 12 34 56 78', '+33 1 23 45 67 89']) expect((checkPhone(s) as { reason: string }).reason).toMatch(/ligne fixe/);
    expect((checkPhone('08 12 34 56 78') as { reason: string }).reason).toMatch(/pas un mobile/);
  });
  test('formats incorrects', () => {
    const bad: [string, RegExp][] = [['', /Saisis/], ['abc', /chiffres/], ['06 12 34', /10 chiffres/], ['06 12 34 56 78 9', /10 chiffres/], ['+33 6 12 34 56', /10 chiffres/], ['06*12*34*56*78', /Caractère non valide/], ['+0123456789', /8 à 15 chiffres/], ['+1234567', /8 à 15 chiffres/], ['+1234567890123456', /8 à 15 chiffres/]];
    for (const [s, re] of bad) { const r = checkPhone(s); expect(r.ok).toBe(false); expect((r as { reason: string }).reason).toMatch(re); }
  });
  test('autres pays : indicatif obligatoire, format international vérifié seulement', () => {
    expect(ok('+32 470 12 34 56').e164).toBe('+32470123456');
    expect(ok('0032 470 12 34 56').e164).toBe('+32470123456');
    expect(ok('+1 (415) 555-0132').e164).toBe('+14155550132');
    expect((checkPhone('+32 470 12 34 56') as { hint?: string }).hint).toBeDefined();
  });
});

describe('code reçu', () => {
  test('6 chiffres, avec ou sans espaces', () => {
    expect(checkCode('123456')).toEqual({ ok: true, value: '123456' });
    expect(checkCode(' 123 456 ')).toEqual({ ok: true, value: '123456' });
    expect(checkCode('123-456')).toEqual({ ok: true, value: '123456' });
  });
  test('refus avec raison', () => {
    expect((checkCode('') as { reason: string }).reason).toMatch(/Saisis/);
    expect((checkCode('12a456') as { reason: string }).reason).toMatch(/chiffres/);
    expect((checkCode('123') as { reason: string }).reason).toContain('il en manque 3');
    expect((checkCode('1234567') as { reason: string }).reason).toMatch(/Trop/);
  });
});

describe('masquage et messages d\'erreur', () => {
  test('masques', () => {
    expect(maskEmail('prenom@exemple.fr')).toBe('p•••••@exemple.fr');
    expect(maskEmail('prenom@exemple.fr')).not.toContain('renom');
    expect(maskPhone('+33612345678')).toBe('+33•••••••78');
    expect(maskPhone('+33612345678')).not.toContain('1234');
  });
  test('erreurs : limitation, code faux, SMS indisponible, réseau - jamais « compte inconnu »', () => {
    expect(authErrorMessage({ status: 429, error_code: 'over_sms_send_rate_limit' }, 'send')).toMatch(/Trop de demandes/);
    expect(authErrorMessage({ message: 'For security purposes, you can only request this after 52 seconds.' }, 'send')).toMatch(/Trop de demandes/);
    expect(authErrorMessage({ status: 403, error_code: 'otp_expired' }, 'verify')).toMatch(/incorrect ou expiré/);
    expect(authErrorMessage({ error_code: 'sms_send_failed' }, 'send')).toMatch(/SMS n'est pas disponible/);
    expect(authErrorMessage({ message: 'Failed to fetch' }, 'send')).toMatch(/Connexion impossible/);
    for (const e of [{ error_code: 'user_not_found' }, { status: 422, message: 'Signups not allowed for otp' }, { status: 500 }]) expect(authErrorMessage(e, 'send')).not.toMatch(/introuvable|n'existe pas|inconnu/i);
  });
});
