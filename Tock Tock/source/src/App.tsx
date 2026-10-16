import { useEffect, type ReactNode } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { Link, RouterProvider, usePath } from './lib/router';
import { isConfigured } from './config';
import { db } from './lib/supabase';
import { Alert, Button, Loading, useAsync } from './components/ui';
import { Setup } from './pages/Setup';
import { Login } from './pages/Login';
import { Rules } from './pages/Rules';
import { Onboarding } from './pages/Onboarding';
import { Today } from './pages/Today';
import { Indicators } from './pages/Indicators';
import { Goals } from './pages/Goals';
import { History } from './pages/History';
import { Community } from './pages/Community';
import { Assistant } from './pages/Assistant';
import { Library } from './pages/Library';
import { Settings } from './pages/Settings';
import { Moderation } from './pages/Moderation';
import { Notifications } from './pages/Notifications';
import { Support } from './pages/Support';

const NAV: { to: string; label: string; match: (p: string) => boolean }[] = [
  { to: '/', label: 'Mon espace', match: (p) => p === '/' || p.startsWith('/bilan') || p.startsWith('/indicateurs') || p.startsWith('/objectifs') },
  { to: '/communaute', label: 'Communauté', match: (p) => p.startsWith('/communaute') },
  { to: '/assistant', label: 'Assistant', match: (p) => p.startsWith('/assistant') },
  { to: '/historique', label: 'Historique', match: (p) => p.startsWith('/historique') },
];

function Shell({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const path = usePath();
  const unread = useAsync(async () => (await db().from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)).count ?? 0, [path]);
  return (
    <>
      <a href="#main" className="skip">Aller au contenu</a>
      <header className="topbar">
        <Link to="/" className="brand">Tock Tock</Link>
        <nav aria-label="Principal">{NAV.map((n) => <Link key={n.to} to={n.to} className={n.match(path) ? 'on' : ''} aria-current={n.match(path) ? 'page' : undefined}>{n.label}</Link>)}</nav>
        <nav aria-label="Compte" className="account">
          <Link to="/notifications" aria-label={`Notifications${unread.data ? ` (${unread.data} non lues)` : ''}`}>🔔{unread.data ? <span className="badge">{unread.data}</span> : null}</Link>
          <Link to="/bibliotheque">Bibliothèque</Link>
          <Link to="/aide">Aide</Link>
          {me!.role && <Link to="/moderation">Modération</Link>}
          <Link to="/reglages">Réglages</Link>
        </nav>
      </header>
      <main id="main" className="page">{children}</main>
      <footer className="foot muted">Tock Tock n'est pas un service médical ni d'urgence. En cas de danger : 112 (Europe) · 3114 (France, prévention du suicide).</footer>
    </>
  );
}

function Space({ children }: { children: ReactNode }) {
  const path = usePath();
  if (!(path === '/' || path.startsWith('/bilan') || path.startsWith('/indicateurs') || path.startsWith('/objectifs'))) return <>{children}</>;
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Mon espace">
        {[['/', 'Accueil'], ['/bilan', 'Mon bilan'], ['/indicateurs', 'Indicateurs'], ['/objectifs', 'Objectifs']].map(([to, l]) => <Link key={to} to={to} className={path === to ? 'on' : ''} aria-current={path === to ? 'page' : undefined}>{l}</Link>)}
      </div>
      {children}
    </>
  );
}

function Home() {
  const { me } = useAuth();
  return (
    <div className="stack">
      <h1>Bonjour {me!.profile?.display_name} 👋</h1>
      <p className="lead">Ton espace est privé : seuls toi et les personnes que tu choisis y ont accès.</p>
      <div className="grid">
        <Link to="/bilan" className="tile"><strong>Faire mon bilan</strong><span className="muted">Quelques questions, à ton rythme</span></Link>
        <Link to="/objectifs" className="tile"><strong>Mes objectifs</strong><span className="muted">Avancer par petites étapes</span></Link>
        <Link to="/historique" className="tile"><strong>Mon historique</strong><span className="muted">Graphiques et chroniques de minuit</span></Link>
        <Link to="/communaute" className="tile"><strong>Communauté</strong><span className="muted">Partager avec bienveillance</span></Link>
      </div>
    </div>
  );
}

function Routes() {
  const path = usePath();
  const page = path.startsWith('/bilan') ? <Today /> : path.startsWith('/indicateurs') ? <Indicators /> : path.startsWith('/objectifs') ? <Goals />
    : path.startsWith('/communaute') ? <Community /> : path.startsWith('/assistant') ? <Assistant /> : path.startsWith('/historique') ? <History />
    : path.startsWith('/bibliotheque') ? <Library /> : path.startsWith('/reglages') ? <Settings /> : path.startsWith('/moderation') ? <Moderation />
    : path.startsWith('/notifications') ? <Notifications /> : path.startsWith('/aide') ? <Support /> : <Home />;
  return <Shell><Space>{page}</Space></Shell>;
}

function Gate() {
  const { status, me, refresh, signOut } = useAuth();
  useEffect(() => { document.title = 'Tock Tock'; }, []);
  if (status === 'loading') return <main className="narrow"><Loading /></main>;
  if (status === 'out') return <Login />;
  if (!me?.profile || !me.settings) return <main className="narrow"><Alert kind="error">Ton profil n'a pas pu être chargé.</Alert><Button onClick={refresh}>Réessayer</Button> <Button variant="ghost" onClick={signOut}>Me déconnecter</Button></main>;
  if (me.profile.deactivated_at) return <main className="narrow"><h1>Compte désactivé</h1><p>Ton compte est masqué. Tu peux le réactiver à tout moment.</p><Button onClick={async () => { await db().rpc('reactivate_account'); await refresh(); }}>Réactiver mon compte</Button> <Button variant="ghost" onClick={signOut}>Me déconnecter</Button></main>;
  if (me.pendingDocs.length > 0) return <Rules />;
  if (!me.profile.onboarded_at) return <Onboarding />;
  return <Routes />;
}

export function App({ initialPath }: { initialPath?: string }) {
  if (!isConfigured) return <Setup />;
  return (
    <RouterProvider initial={initialPath}>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </RouterProvider>
  );
}
