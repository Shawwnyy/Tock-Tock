import { useEffect, useMemo, useState } from 'react';
import { HELP_RESOURCES } from '../../supabase/functions/_shared/crisis.ts';
import { Alert, Button, Card, Field } from '../components/ui';
import { Link, RouterProvider, usePath } from '../lib/router';
import { downloadBackupPdf } from './backup';
import { History, Today } from './pagesA';
import { About, Assistant, Goals, Library, SettingsPage, Wellbeing } from './pagesB';
import { AccountPage, Welcome } from './account';
import { ChatPage, ChatPoller } from './chatView';
import { Home } from './home';
import { unreadTotal } from './chat';
import { authServer } from './gotrue';
import { formatClock, formatClockDate, msToNextSecond } from './clock';
import { RULES_VERSION } from './rules';
import { RulesGate, RulesPage, RulesView } from './rulesView';
import { Support } from './support';
import { ensureChronicles, hashPin, storageWorks, update, useStore } from './store';

const NAV: [string, string][] = [['/accueil', 'Accueil'], ['/aujourdhui', 'Bilan du jour'], ['/historique', 'Historique'], ['/objectifs', 'Objectifs'], ['/bien-etre', 'Bien-être'], ['/assistant', 'Assistant'], ['/bibliotheque', 'Bibliothèque'], ['/discussion', 'Discussion'], ['/aide', 'Aide'], ['/reglages', 'Réglages']];

const askPersist = () => { try { void navigator.storage?.persist?.(); } catch { /* facultatif */ } };

function Onboarding() {
  const s = useStore();
  const [name, setName] = useState(s.settings.name);
  const [ok, setOk] = useState(false);
  return (
    <main className="narrow stack" id="main">
      <h1>Bienvenue sur Tock Tock</h1>
      <p className="lead">Un petit bilan par jour, pour mieux te comprendre. Tout reste sur cet appareil{authServer ? ' : seule la connexion par code contacte un serveur, jamais tes bilans.' : ' : cette page ne se connecte à rien.'}</p>
      <Card title="Avant de commencer">
        <Field label="Prénom ou pseudonyme (facultatif)" id="n"><input id="n" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Ton pays (pour les ressources d'aide)" id="c"><select id="c" value={s.settings.country} onChange={(e) => update((n) => { n.settings.country = e.target.value; })}>{Object.keys(HELP_RESOURCES).map((c) => <option key={c}>{c}</option>)}</select></Field>
      </Card>
      <Card title={`Règles d'utilisation (version ${RULES_VERSION})`}>
        <p className="muted">Le principe : <strong>tes données sont à toi, rien n'est inventé, tu gardes la main, l'humain passe d'abord, et on te dit ce qui est limité.</strong> Chaque règle découle de là.</p>
        <ul className="help">
          <li>Tock Tock est un outil de suivi personnel : <strong>ce n'est pas un dispositif médical</strong> et il ne pose aucun diagnostic.</li>
          <li>Tes données sont stockées uniquement dans ce navigateur. <strong>Fais des sauvegardes PDF</strong> (Réglages) : vider les données du navigateur les efface.</li>
          <li>Les moyennes ne comptent jamais une question vide comme zéro ; les chroniques n'inventent rien.</li>
          <li>Les objectifs, les séries et les petites victoires n'ont ni pénalité ni classement : un objectif non atteint n'est pas un échec.</li>
          <li>Un code de connexion (e-mail ou SMS) est toujours envoyé et vérifié par un serveur : l'application ne l'affiche ni ne le simule, et personne ne te le demandera jamais.</li>
          <li>Tu peux tout exporter (PDF, CSV) et tout supprimer à tout moment.</li>
          <li>Si tu vas très mal, parle à quelqu'un : l'onglet « Aide » liste des services d'écoute. En danger immédiat, appelle les urgences (112 en Europe).</li>
        </ul>
        <details className="doc"><summary><strong>Lire toutes les règles, avec les raisons</strong></summary><RulesView /></details>
        <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />J'ai lu et j'accepte ces règles.</label>
      </Card>
      <Button disabled={!ok} onClick={() => { update((n) => { n.settings.name = name.trim(); n.settings.onboarded = true; n.settings.rules_accepted_version = RULES_VERSION; n.settings.rules_accepted_at = new Date().toISOString(); }); askPersist(); window.location.hash = '/accueil'; }}>Commencer</Button>
    </main>
  );
}

function Lock({ onUnlock }: { onUnlock: () => void }) {
  const s = useStore();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  return (
    <main className="narrow stack" id="main">
      <h1>Tock Tock</h1>
      <form onSubmit={async (e) => { e.preventDefault(); const h = await hashPin(pin, s.settings.pinSalt ?? ''); if (h === s.settings.pinHash) onUnlock(); else { setErr(true); setPin(''); } }}>
        <Field label="Code PIN" id="pin"><input id="pin" type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} maxLength={8} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
        {err && <Alert kind="error">Code incorrect.</Alert>}
        <Button type="submit">Ouvrir</Button>
      </form>
      <p className="muted">Code oublié ? Voir « Aide → FAQ » : avec une sauvegarde PDF, vide les données du site puis restaure-la.</p>
    </main>
  );
}

function BackupBanner() {
  const s = useStore();
  const [hidden, setHidden] = useState(false);
  const n = Object.keys(s.checkins).length;
  const last = s.settings.lastBackupAt ? Date.parse(s.settings.lastBackupAt) : 0;
  const stale = !last || Date.now() - last > 14 * 86400000;
  if (hidden || n < 3 || !stale) return null;
  return (
    <Alert kind="warn">
      <strong>Pense à sauvegarder.</strong> {last ? 'Ta dernière sauvegarde date de plus de 14 jours.' : 'Tu n\'as encore fait aucune sauvegarde.'} Tes données ne sont que dans ce navigateur.{' '}
      <button className="linklike" onClick={() => { void downloadBackupPdf(); }}>Télécharger une sauvegarde PDF</button> · <button className="linklike" onClick={() => setHidden(true)}>Plus tard</button>
    </Alert>
  );
}

function StorageBanner() {
  useStore(); // se met à jour quand une écriture échoue
  if (storageWorks()) return null;
  return <Alert kind="error"><strong>Tes données ne sont pas enregistrées.</strong> Le stockage du navigateur est indisponible ou plein (navigation privée ?). Télécharge une sauvegarde PDF avant de fermer la page.{' '}<button className="linklike" onClick={() => { void downloadBackupPdf(); }}>Sauvegarder maintenant</button></Alert>;
}

/** Heure à la seconde près, dans le fuseau choisi. Seul ce composant se redessine chaque seconde. */
function Clock({ tz }: { tz: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(new Date()); t = setTimeout(tick, msToNextSecond()); };
    t = setTimeout(tick, msToNextSecond());
    return () => clearTimeout(t);
  }, []);
  const date = useMemo(() => formatClockDate(now, tz), [now.getDate(), tz]); // eslint-disable-line react-hooks/exhaustive-deps
  return <time className="clock" dateTime={now.toISOString()} title={`${date} (${tz})`}>{formatClock(now, tz)}</time>;
}

/** En haut à droite : prénom, numéro aléatoire local, heure, et accès à la connexion / l'inscription. */
function HeaderStatus() {
  const s = useStore();
  const a = s.settings.account;
  return (
    <div className="status">
      {s.settings.name && <span className="muted">Bonjour {s.settings.name}</span>}
      <span className="handle" title="Numéro aléatoire propre à cet appareil (un pseudonyme : ni ton nom, ni ton e-mail, ni ton numéro)">#{s.settings.handle}</span>
      <Clock tz={s.settings.timezone} />
      {a ? (
        <>
          <Link to="/compte" className="hpill">Compte {a.masked}</Link>
          <button type="button" className="hpill" title="Retire l'identifiant confirmé de cet appareil. Tes bilans ne sont pas effacés." onClick={() => update((n) => { n.settings.account = null; })}>Se déconnecter</button>
        </>
      ) : (
        <>
          <Link to="/compte/connexion" className="hpill">Se connecter</Link>
          <Link to="/compte/inscription" className="hpill hpill-primary">S'inscrire</Link>
        </>
      )}
    </div>
  );
}

function Shell() {
  const s = useStore();
  const path = usePath();
  const unread = unreadTotal(s);
  useEffect(() => { ensureChronicles(); }, [s.settings.onboarded]);
  useEffect(() => { window.scrollTo?.(0, 0); }, [path]);
  useEffect(() => {
    const r = document.documentElement;
    if (s.settings.theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', s.settings.theme);
  }, [s.settings.theme]);
  const page = path.startsWith('/historique') ? <History /> : path.startsWith('/objectifs') ? <Goals /> : path.startsWith('/bien-etre') ? <Wellbeing />
    : path.startsWith('/assistant') ? <Assistant /> : path.startsWith('/bibliotheque') ? <Library /> : path.startsWith('/aide') ? <Support />
      : path.startsWith('/discussion') ? <ChatPage /> : path.startsWith('/reglages') ? <SettingsPage /> : path.startsWith('/compte') ? <AccountPage /> : path.startsWith('/regles') ? <RulesPage /> : path.startsWith('/apropos') ? <About /> : path.startsWith('/aujourdhui') ? <Today /> : <Home />;
  return (
    <>
      <a className="skip" href="#main">Aller au contenu</a>
      <header className="topbar">
        <div className="topline">
          <Link to="/aujourdhui" className="brand">Tock Tock</Link>
          <HeaderStatus />
        </div>
        <nav aria-label="Navigation principale">{NAV.map(([to, label]) => <Link key={to} to={to} className={path.startsWith(to) || (to === '/accueil' && path === '/') ? 'on' : ''} aria-current={path.startsWith(to) ? 'page' : undefined}>{label}{to === '/discussion' && unread > 0 ? <span className="badge" aria-label={`${unread} message${unread > 1 ? 's' : ''} non lu${unread > 1 ? 's' : ''}`}>{unread}</span> : null}</Link>)}</nav>
      </header>
      <ChatPoller />
      <main className="page" id="main"><StorageBanner /><BackupBanner />{page}</main>
      <footer className="foot muted">Tes données restent sur cet appareil · <Link to="/regles">Règles</Link> · <Link to="/apropos">À propos</Link> · Outil de suivi personnel, pas un dispositif médical.</footer>
    </>
  );
}

export function LocalApp() {
  const s = useStore();
  // Le verrou ne s'applique qu'à l'OUVERTURE : définir un code pendant la session ne verrouille pas aussitôt l'écran.
  const [lockedAtStart] = useState(!!s.settings.pinHash);
  const [unlocked, setUnlocked] = useState(false);
  if (!s.settings.onboarded) return <RouterProvider>{s.settings.welcome_done ? <Onboarding /> : <Welcome />}</RouterProvider>;
  if (lockedAtStart && s.settings.pinHash && !unlocked) return <Lock onUnlock={() => setUnlocked(true)} />;
  if (s.settings.rules_accepted_version !== RULES_VERSION) {
    return <RulesGate previous={s.settings.rules_accepted_version} onBackup={() => { void downloadBackupPdf(); }}
      onAccept={() => { update((n) => { n.settings.rules_accepted_version = RULES_VERSION; n.settings.rules_accepted_at = new Date().toISOString(); }); askPersist(); }} />;
  }
  return <RouterProvider><Shell /></RouterProvider>;
}
