// Relais de discussion : identité par clé secrète, aucune usurpation, livraison unique, limites, blocage.
import { describe, expect, test } from 'bun:test';
// @ts-ignore - module JavaScript sans déclaration de types
import { createRelay } from '../chat/relay.mjs';

const T1 = 'a'.repeat(32), T2 = 'b'.repeat(32), T3 = 'c'.repeat(32);
function setup(limits: object = {}) {
  let t = 1_000_000;
  const r = createRelay({ now: () => t, limits });
  const adv = (ms: number) => { t += ms; };
  const hello = (num: string, name: string, token: string) => r.api('hello', { num, name, token });
  return { r, adv, hello };
}

describe('identité sans compte', () => {
  test('premier arrivé, premier servi : un numéro pris refuse une autre clé', () => {
    const { hello } = setup();
    expect(hello('18428', 'Léo', T1).json.ok).toBe(true);
    expect(hello('18428', 'Léo', T1).json.ok).toBe(true); // même appareil : ok (renommer possible)
    const r = hello('18428', 'Intrus', T2);
    expect(r.status).toBe(409); expect(r.json.error).toBe('taken');
  });
  test('formats refusés', () => {
    const { hello } = setup();
    expect(hello('1842', 'x', T1).status).toBe(400);
    expect(hello('18428', 'x', 'court').status).toBe(400);
  });
});

describe('messages', () => {
  test('livrés une seule fois, au bon destinataire, sans HTML interprété par le relais', () => {
    const { r, hello } = setup(); hello('18428', 'Léo', T1); hello('04211', 'Marie', T2);
    const s = r.api('send', { num: '18428', token: T1, to: { num: '04211', name: 'marie' }, type: 'msg', text: '  Salut <b>Marie</b> ' });
    expect(s.json.ok).toBe(true);
    const p = r.api('poll', { num: '04211', token: T2, after: 0, epoch: r.epoch });
    expect(p.json.messages).toHaveLength(1);
    expect(p.json.messages[0]).toMatchObject({ type: 'msg', text: 'Salut <b>Marie</b>', from: { num: '18428', name: 'Léo' } });
    const again = r.api('poll', { num: '04211', token: T2, after: p.json.messages[0].id, epoch: r.epoch });
    expect(again.json.messages).toHaveLength(0);
    expect(r.api('poll', { num: '04211', token: T2, after: 0, epoch: r.epoch }).json.messages).toHaveLength(0); // déjà effacé du relais
    expect(r.api('poll', { num: '18428', token: T1, after: 0, epoch: r.epoch }).json.messages).toHaveLength(0);
  });
  test('usurpation et lecture du courrier d\'un autre : refusées', () => {
    const { r, hello } = setup(); hello('18428', 'Léo', T1); hello('04211', 'Marie', T2); hello('77777', 'Eve', T3);
    expect(r.api('send', { num: '18428', token: T3, to: { num: '04211', name: 'Marie' }, type: 'msg', text: 'faux' }).status).toBe(403);
    expect(r.api('poll', { num: '04211', token: T3, after: 0, epoch: r.epoch }).status).toBe(403);
    expect(r.api('poll', { num: '04211', token: '', after: 0 }).status).toBe(403);
    expect(r.api('poll', { num: '55555', token: T1, after: 0 }).status).toBe(401);
  });
  test('destinataire inconnu ou mauvais nom : même réponse (aucune fuite)', () => {
    const { r, hello } = setup(); hello('18428', 'Léo', T1); hello('04211', 'Marie', T2);
    const a = r.api('send', { num: '18428', token: T1, to: { num: '04211', name: 'Paul' }, type: 'msg', text: 'x' });
    const b = r.api('send', { num: '18428', token: T1, to: { num: '99999', name: 'Marie' }, type: 'msg', text: 'x' });
    expect(a).toEqual(b); expect(a.status).toBe(404);
    expect(r.api('send', { num: '18428', token: T1, to: { num: '18428', name: 'Léo' }, type: 'msg', text: 'x' }).status).toBe(404); // pas à soi-même
  });
  test('accents et majuscules ignorés dans le nom', () => {
    const { r, hello } = setup(); hello('18428', 'Léo', T1); hello('04211', 'Éloïse', T2);
    expect(r.api('send', { num: '18428', token: T1, to: { num: '04211', name: 'ELOISE' }, type: 'msg', text: 'ok' }).json.ok).toBe(true);
  });
  test('limites : texte vide, trop long, cadence, taille du bilan partagé', () => {
    const { r, adv, hello } = setup({ msgPerMin: 3 }); hello('18428', 'Léo', T1); hello('04211', 'Marie', T2);
    const send = (o: object) => r.api('send', { num: '18428', token: T1, to: { num: '04211', name: 'Marie' }, ...o });
    expect(send({ type: 'msg', text: '   ' }).status).toBe(400);
    expect(send({ type: 'msg', text: 'a'.repeat(1001) }).status).toBe(413);
    expect(send({ type: 'snapshot', payload: { x: 'a'.repeat(21000) } }).status).toBe(413);
    for (let i = 0; i < 3; i++) expect(send({ type: 'msg', text: 'm' + i }).json.ok).toBe(true);
    expect(send({ type: 'msg', text: 'm4' }).status).toBe(429);
    adv(61_000); expect(send({ type: 'msg', text: 'm5' }).json.ok).toBe(true);
  });
  test('demandes de bilan : 10 par heure au plus', () => {
    const { r, hello } = setup(); hello('18428', 'Léo', T1); hello('04211', 'Marie', T2);
    let last = 200;
    for (let i = 0; i < 11; i++) last = r.api('send', { num: '18428', token: T1, to: { num: '04211', name: 'Marie' }, type: 'request' }).status;
    expect(last).toBe(429);
  });
  test('blocage : plus rien n\'arrive, sans que l\'expéditeur le sache', () => {
    const { r, hello } = setup(); hello('18428', 'Léo', T1); hello('04211', 'Marie', T2);
    r.api('send', { num: '18428', token: T1, to: { num: '04211', name: 'Marie' }, type: 'msg', text: 'avant' });
    expect(r.api('block', { num: '04211', token: T2, target: '18428' }).json.ok).toBe(true);
    const s = r.api('send', { num: '18428', token: T1, to: { num: '04211', name: 'Marie' }, type: 'msg', text: 'après' });
    expect(s.json.ok).toBe(true);
    expect(r.api('poll', { num: '04211', token: T2, after: 0, epoch: r.epoch }).json.messages).toHaveLength(0);
  });
  test('expiration au bout de 24 h ; redémarrage du relais : nouvel epoch, le client repart de zéro', () => {
    const { r, adv, hello } = setup(); hello('18428', 'Léo', T1); hello('04211', 'Marie', T2);
    r.api('send', { num: '18428', token: T1, to: { num: '04211', name: 'Marie' }, type: 'msg', text: 'vieux' });
    adv(25 * 3600_000);
    expect(r.api('poll', { num: '04211', token: T2, after: 0, epoch: r.epoch }).json.messages).toHaveLength(0);
    expect(createRelay().epoch).not.toBe(r.epoch);
  });
});
