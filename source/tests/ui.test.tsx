// Tests de fumée de l'interface : rendu côté serveur (SSR) avec un faux Supabase. Ils vérifient que les écrans se
// rendent sans erreur avec des données réalistes et que la logique d'affichage clé est correcte (trous des graphiques,
// écran de configuration honnête, passerelle d'authentification). Ils ne remplacent PAS un test dans un vrai navigateur.
import { describe, it, expect, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

mock.module('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, from: () => ({}) }),
}));

const settings = {
  timezone: 'Europe/Paris', age_band: '18_plus', bio: null, chronicle_enabled: true, chronicle_time: '00:05:00', chronicle_email_enabled: false, chronicle_email_mode: 'notify',
  pdf_include_sensitive: false, no_data_behavior: 'nothing', reminder_enabled: false, reminder_time: '20:00:00', track_pain: true, ai_consent: false, ai_use_history: false,
  chatbot_memory_enabled: false, chatbot_access: { checkins: false, goals: false, chronicles: false, pain: false }, notification_prefs: {}, visibility: { bio: 'private', interests: 'private', shared_goals: 'private', avatar: 'members' }, interests: [],
};
const doc = (kind: string) => ({ id: kind, kind, version: '1', title: kind, body_md: 'Texte\n\nSuite', published_at: '2026-01-01T00:00:00Z', requires_reacceptance: true });
const me = (over: object = {}) => ({
  id: 'u1', email: 'a@b.fr', profile: { handle: 'user#00001', display_name: 'Mona', avatar_preset: 'sun', onboarded_at: '2026-10-01', deactivated_at: null },
  settings, pendingDocs: [], latestDocs: [doc('community_rules'), doc('privacy_policy'), doc('chatbot_limits')], role: null, ...over,
});

async function setup(configured: boolean) {
  if (configured) {
    process.env.VITE_SUPABASE_URL = 'https://abcdefgh.supabase.co';
    process.env.VITE_SUPABASE_ANON_KEY = 'x'.repeat(40);
  } else {
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
  }
}

describe('écran de configuration', () => {
  it('sans variables, l\'application le dit honnêtement (aucune démo trompeuse)', async () => {
    await setup(false);
    const { isConfigured } = await import('../src/config');
    expect(isConfigured).toBe(false);
    const { Setup } = await import('../src/pages/Setup');
    const html = renderToStaticMarkup(createElement(Setup));
    expect(html).toContain('configuration requise');
    expect(html).toContain('Rien ne fonctionne en mode démonstration');
  });
});

describe('règles d\'acceptation (miroir de la règle SQL)', () => {
  it('pendingDocuments : version importante plus récente => à réaccepter', async () => {
    const { pendingDocuments } = await import('../src/lib/auth');
    const v1 = { ...doc('community_rules'), id: 'a', published_at: '2026-01-01T00:00:00Z' };
    const v2 = { ...doc('community_rules'), id: 'b', version: '2', published_at: '2026-06-01T00:00:00Z' };
    expect(pendingDocuments([v1 as never], new Set())).toMatchObject({ pending: [{ id: 'a' }] });
    expect(pendingDocuments([v1 as never], new Set(['a'])).pending).toEqual([]);
    expect(pendingDocuments([v1, v2] as never, new Set(['a'])).pending.map((d) => d.id)).toEqual(['b']);
    expect(pendingDocuments([v1, v2] as never, new Set(['b'])).pending).toEqual([]);
    const minor = { ...v2, requires_reacceptance: false };
    expect(pendingDocuments([v1, minor] as never, new Set(['a'])).pending).toEqual([]); // modification mineure : pas de nouvelle acceptation
    expect(pendingDocuments([{ ...v2, published_at: '2999-01-01T00:00:00Z' }] as never, new Set()).pending).toEqual([]); // pas encore en vigueur
  });
});

describe('rendu Markdown minimal (textes juridiques, ressources)', () => {
  it('titres, listes, gras ; aucun HTML brut n\'est interprété', async () => {
    const { MdLite } = await import('../src/components/MdLite');
    const html = renderToStaticMarkup(createElement(MdLite, { text: '## Titre\n- un\n- deux\n\n**gras** <script>alert(1)</script> [lien](javascript:alert(1))' }));
    expect(html).toContain('<h4>Titre</h4>');
    expect(html).toContain('<ul><li>un</li><li>deux</li></ul>');
    expect(html).toContain('<strong>gras</strong>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<a ');
  });
});

describe('graphique', () => {
  it('les jours sans donnée sont des trous, jamais des zéros', async () => {
    const { LineChart } = await import('../src/components/Chart');
    const html = renderToStaticMarkup(createElement(LineChart, { title: 'Test', points: [{ label: '1', value: 5 }, { label: '2', value: 6 }, { label: '3', value: null }, { label: '4', value: 7 }] }));
    expect((html.match(/<polyline/g) ?? []).length).toBe(1); // 5-6 reliés ; 7 isolé (point seul)
    expect(html).toContain('3 jour(s) avec données sur 4');
    const empty = renderToStaticMarkup(createElement(LineChart, { title: 'Vide', points: [{ label: '1', value: null }] }));
    expect(empty).not.toContain('<polyline');
    expect(empty).toContain('Aucune donnée');
    const zero = renderToStaticMarkup(createElement(LineChart, { title: 'Zéro', points: [{ label: '1', value: 0 }, { label: '2', value: 0 }] }));
    expect(zero).toContain('<polyline'); // un vrai zéro est tracé
  });
});

describe('écrans avec un membre connecté', () => {
  async function render(name: string, member: object = me()) {
    await setup(true);
    const { AuthContext } = await import('../src/lib/auth');
    const { RouterProvider } = await import('../src/lib/router');
    const mod = await import(`../src/pages/${name}`);
    const Page = mod[name] ?? Object.values(mod)[0];
    return renderToStaticMarkup(createElement(RouterProvider, { initial: '/' }, createElement(AuthContext.Provider, { value: { status: 'in', me: member as never, refresh: async () => {}, signOut: async () => {} } }, createElement(Page as never))));
  }
  it('Règles : une case par document et bouton désactivé tant que tout n\'est pas coché', async () => {
    const html = await render('Rules');
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(3);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Continuer/);
  });
  it('Onboarding : trois choix d\'âge, pseudonyme limité', async () => {
    const html = await render('Onboarding');
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3);
    expect(html).toContain('maxLength="30"');
  });
  it('Réglages : tous les contrôles de confidentialité sont présents, IA désactivée par défaut', async () => {
    const html = await render('Settings');
    for (const t of ['Exporter toutes mes données', 'Supprimer définitivement mon compte', 'Autoriser l&#x27;IA', 'Mémoire de l&#x27;assistant', 'Suivre la douleur', 'Contester une décision']) expect(html).toContain(t);
    expect(html).toMatch(/id="ai"(?![^>]*checked)/);
    expect(html).toMatch(/id="mem"(?![^>]*checked)/);
  });
  it('Assistant : annonce clairement le mode guidé et l\'absence de mémoire', async () => {
    const html = await render('Assistant');
    expect(html).toContain('mode guidé');
    expect(html).toContain('rien de cette conversation n&#x27;est conservé');
    expect(html).toContain('aucune');
  });
  it('Communauté : fermée pour un mineur de moins de 15 ans', async () => {
    const html = await render('Community', me({ settings: { ...settings, age_band: 'under_15' } }));
    expect(html).toContain('pas disponible pour ton âge déclaré');
  });
  it('Modération : refusée sans rôle de personnel', async () => {
    const html = await render('Moderation');
    expect(html).toContain('réservé à l&#x27;équipe de modération');
  });
  it('Login : propose l\'e-mail sans mot de passe', async () => {
    await setup(true);
    const { Login } = await import('../src/pages/Login');
    const html = renderToStaticMarkup(createElement(Login));
    expect(html).toContain('Recevoir mon code');
    expect(html).not.toContain('type="password"');
  });
});

describe('connexion par code (rendu)', () => {
  it('page de connexion serveur : e-mail seul tant que le SMS n\'est pas configuré, jamais de code affiché', async () => {
    await setup(true);
    const { Login } = await import('../src/pages/Login');
    const html = renderToStaticMarkup(createElement(Login));
    expect(html).toContain('Connexion ou inscription');
    expect(html).toContain('Ton adresse e-mail');
    expect(html).not.toContain('role="tab"');
    expect(html).toContain('Recevoir mon code');
    expect(html).toContain('créé automatiquement');
    expect(html).not.toMatch(/\b\d{6}\b/);
  });
  it('OtpFlow avec téléphone activé : deux onglets ; sans serveur : avertissement honnête et envoi désactivé', async () => {
    const { OtpFlow } = await import('../src/components/OtpFlow');
    const html = renderToStaticMarkup(createElement(OtpFlow, { send: async () => ({ ok: true }), verify: async () => ({ ok: true }), phoneEnabled: true, available: false }));
    expect(html).toContain('role="tab"');
    expect(html).toContain('Téléphone');
    expect(html).toContain('Envoi de code indisponible ici');
    expect(html).toContain('Rien n&#x27;est simulé');
    expect(html).toContain('disabled');
  });
});
