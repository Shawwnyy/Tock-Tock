// Connexion / inscription dans la version locale : écran d'accueil et page « Compte ».
// Sans serveur relié (fabrication par défaut), le formulaire contrôle le format mais n'envoie ni ne vérifie AUCUN code, et le dit.
import { useState } from 'react';
import { Alert, Button, Card } from '../components/ui';
import { OtpFlow } from '../components/OtpFlow';
import { Link, usePath } from '../lib/router';
import { authServer, sendCode, verifyCode } from './gotrue';
import { randomHandle, update, useStore } from './store';

const flowProps = (intent?: 'signin' | 'signup') => ({
  intent,
  available: !!authServer,
  phoneEnabled: true,
  send: (k: 'email' | 'phone', v: string) => (authServer ? sendCode(authServer, k, v) : Promise.resolve({ ok: false as const, message: 'Aucun serveur relié.' })),
  verify: (k: 'email' | 'phone', v: string, c: string) => (authServer ? verifyCode(authServer, k, v, c) : Promise.resolve({ ok: false as const, message: 'Aucun serveur relié.' })),
});

/** Ne garde que la forme masquée de l'identifiant (jamais l'adresse complète, ni le code, ni aucun jeton). */
function remember(kind: 'email' | 'phone', masked: string) {
  update((n) => { n.settings.account = { kind, masked, verified_at: new Date().toISOString() }; });
}

const WHY = 'Dans ce fichier, le compte sert uniquement à confirmer que cette adresse ou ce numéro est bien à toi. Tes bilans restent sur cet appareil (rien n\'est synchronisé) ; seuls l\'identifiant et le code passent par le serveur d\'authentification.';

/** Premier écran : se connecter, s'inscrire, ou continuer sans compte. */
export function Welcome() {
  const s = useStore();
  return (
    <main className="narrow stack" id="main">
      <h1>Tock Tock</h1>
      <p className="lead">Ton carnet de bord personnel, privé. Connecte-toi ou crée un compte avec un code reçu par e-mail ou par SMS, ou continue sans compte.</p>
      <Card title="Connexion ou inscription"><OtpFlow {...flowProps()} onVerified={(k, m) => remember(k, m)} />{authServer && <p className="muted">{WHY}</p>}</Card>
      {s.settings.account ? (
        <Button onClick={() => update((n) => { n.settings.welcome_done = true; })}>Continuer</Button>
      ) : (
        <Card title="Sans compte">
          <p>Tout fonctionne sans compte : tes données restent dans ce navigateur. Tu pourras te connecter plus tard depuis Réglages.</p>
          <Button variant="ghost" onClick={() => update((n) => { n.settings.welcome_done = true; })}>Continuer sans compte</Button>
        </Card>
      )}
      <p className="muted">Avant de t'inscrire, tu peux <Link to="/regles">lire les règles</Link>.</p>
    </main>
  );
}

/** Page « Compte » (depuis Réglages). */
export function AccountPage() {
  const s = useStore();
  const path = usePath();
  const intent = path.startsWith('/compte/inscription') ? 'signup' as const : path.startsWith('/compte/connexion') ? 'signin' as const : undefined;
  const [fresh, setFresh] = useState(false); // garde le message de réussite visible juste après la validation du code
  const a = s.settings.account;
  return (
    <div className="stack">
      <h1>{intent === 'signup' ? 'Créer un compte' : intent === 'signin' ? 'Se connecter' : 'Compte'}</h1>
      {a && !fresh ? (
        <Card title="Identifiant confirmé">
          <p>{a.kind === 'email' ? 'Adresse e-mail' : 'Numéro de mobile'} : <strong>{a.masked}</strong> · confirmé le {new Date(a.verified_at).toLocaleDateString('fr-FR')}.</p>
          <p className="muted">{WHY}</p>
          <Button variant="ghost" onClick={() => update((n) => { n.settings.account = null; })}>Se déconnecter (retirer l'identifiant de cet appareil)</Button>
        </Card>
      ) : (
        <Card title={intent === 'signup' ? 'Inscription' : intent === 'signin' ? 'Connexion' : 'Connexion ou inscription'}>
          <OtpFlow {...flowProps(intent)} onVerified={(k, m) => { setFresh(true); remember(k, m); }} />
          {authServer && <p className="muted">{WHY}</p>}
        </Card>
      )}
      <Card title="Mon numéro local">
        <p><strong className="handle">#{s.settings.handle}</strong></p>
        <p className="muted">Un numéro aléatoire propre à cet appareil, comme un pseudonyme : il ne contient ni ton nom, ni ton e-mail, ni ton numéro de téléphone. Il n'est pas unique au monde (avec un compte sur le serveur complet, l'identifiant public est attribué par le serveur).</p>
        <Button variant="ghost" onClick={() => update((n) => { n.settings.handle = randomHandle(); })}>Générer un autre numéro</Button>
      </Card>
      {!authServer && <Alert>Pour activer l'envoi de codes, il faut un serveur d'authentification (Supabase) : voir <code>LISEZ-MOI.txt</code>, section « Relier la connexion ». Sans lui, Tock Tock fonctionne entièrement sur cet appareil.</Alert>}
    </div>
  );
}
