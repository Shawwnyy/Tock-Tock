// Page d'accueil : le point sur aujourd'hui, la série, la semaine, les objectifs, une idée pour toi, et ton nom# de discussion.
import { useState } from 'react';
import { addDays, buildDailySeries, formatScore, periodGeneralAverage } from '../../supabase/functions/_shared/stats.ts';
import { formatDateFr } from '../../supabase/functions/_shared/chronicle.ts';
import { Alert, Button, Card } from '../components/ui';
import { Link } from '../lib/router';
import { chatAvailable } from './chatApi';
import { myTag } from './chat';
import { EXERCISES } from './data';
import { weekCount } from './exercises';
import { checkinsSorted, streaks, today, useStore, type Store } from './store';

const TIPS = [
  'Un petit pas aujourd\'hui vaut mieux qu\'un grand plan demain.', 'Boire un verre d\'eau et ouvrir une fenêtre : deux gestes simples qui aident à se poser.',
  'Noter une chose qui s\'est bien passée suffit à faire un bon bilan.', 'Un jour sans bilan n\'est pas un échec : le suivi reprend quand tu veux.',
  'Les moyennes décrivent, elles ne jugent pas : une mauvaise journée n\'est pas une mauvaise vie.', 'Expirer plus longtemps qu\'on inspire aide le corps à se calmer.',
  'Parler à quelqu\'un de confiance allège souvent plus qu\'on ne l\'imagine.', 'Dormir à heures régulières est l\'un des meilleurs leviers du moral.',
  'Découper un objectif en étapes de 10 minutes le rend beaucoup moins intimidant.', 'Sortir marcher 10 minutes, même sans but, change souvent l\'humeur.',
  'Tu n\'as pas à tout régler aujourd\'hui.', 'Un compliment sincère, donné ou reçu, compte comme une petite victoire.', 'Faire une pause n\'est pas perdre du temps.',
  'Si c\'est trop lourd, demander de l\'aide est une force, pas une faiblesse.',
];

function dayIndex(t: string): number { return Math.floor(Date.parse(`${t}T12:00:00Z`) / 86400000); }

function hourIn(tz: string): number {
  try { return Number(new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', hourCycle: 'h23', timeZone: tz || undefined }).format(new Date())); } catch { return new Date().getHours(); }
}

export function greeting(h: number): string { return h >= 5 && h < 12 ? 'Bonjour' : h >= 12 && h < 18 ? 'Bon après-midi' : 'Bonsoir'; }

function Spark({ values }: { values: (number | null)[] }) {
  const W = 280, H = 56, P = 4;
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(values.length - 1, 1);
  const y = (v: number) => H - P - (v / 10) * (H - 2 * P);
  const segs: string[] = []; let cur: string[] = [];
  values.forEach((v, i) => { if (v === null) { if (cur.length) segs.push(cur.join(' ')); cur = []; } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); });
  if (cur.length) segs.push(cur.join(' '));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Moyenne générale des 14 derniers jours ; les jours sans bilan sont des vides">
      {segs.map((p, i) => (p.includes(' ') ? <polyline key={i} points={p} fill="none" stroke="currentColor" strokeWidth="2" /> : <circle key={i} cx={p.split(',')[0]} cy={p.split(',')[1]} r="2.5" fill="currentColor" />))}
    </svg>
  );
}

function idea(s: Store, t: string, todayGeneral: number | null) {
  if (todayGeneral !== null && todayGeneral < 4) return { title: 'Une respiration pour te poser', text: 'La journée semble difficile. Trois minutes de respiration lente peuvent aider. Si tu te sens mal, l\'onglet « Aide » liste des personnes à qui parler.', to: '/bien-etre', cta: 'Respirer' };
  const e = EXERCISES[dayIndex(t) % EXERCISES.length];
  return { title: `Idée du jour : ${e.name}`, text: `${e.intro} (${e.minutes} min)`, to: '/bien-etre', cta: 'Voir les exercices' };
}

export function Home() {
  const s = useStore();
  const [copied, setCopied] = useState(false);
  const t = today(s);
  const list = checkinsSorted(s);
  const st = streaks(list.map((c) => c.checkin_date), t);
  const series14 = buildDailySeries(list, addDays(t, -13), t);
  const series7 = series14.slice(-7);
  const avg7 = periodGeneralAverage(series7);
  const doneToday = s.checkins[t];
  const todayGeneral = series14[series14.length - 1]?.general ?? null;
  const goals = s.goals.filter((g) => g.status === 'in_progress' || g.status === 'todo').slice(0, 3);
  const id = idea(s, t, todayGeneral);
  const tip = TIPS[dayIndex(t) % TIPS.length];
  const name = s.settings.name;
  return (
    <div className="stack">
      <h1>{greeting(hourIn(s.settings.timezone))}{name ? ` ${name}` : ''}</h1>
      <p className="lead">{formatDateFr(t)} · {tip}</p>

      <Card title="Aujourd'hui">
        {doneToday ? (
          <>
            <Alert kind="success">Ton bilan du jour est enregistré{todayGeneral !== null ? ` · moyenne ${formatScore(todayGeneral)}/10` : ' · moyenne indisponible (aucune réponse numérique)'}.</Alert>
            <div className="row"><Link to="/aujourdhui" className="btn btn-ghost">Modifier mon bilan</Link><Link to="/historique" className="btn btn-ghost">Voir mon historique</Link></div>
          </>
        ) : (
          <>
            <p>Tu n'as pas encore fait ton bilan du jour. Il prend quelques minutes (ou 2 minutes en bilan rapide).</p>
            <div className="row"><Link to="/aujourdhui" className="btn btn-primary">Faire mon bilan</Link></div>
          </>
        )}
      </Card>

      <div className="tiles">
        <div className="tile"><strong>{st.current}</strong><span>jour{st.current > 1 ? 's' : ''} de suite</span><small className="muted">meilleure série : {st.best}</small></div>
        <div className="tile"><strong>{st.total}</strong><span>bilan{st.total > 1 ? 's' : ''} au total</span><small className="muted">une pause n'efface rien</small></div>
        <div className="tile"><strong>{avg7.value === null ? '—' : formatScore(avg7.value)}</strong><span>moyenne sur 7 jours</span><small className="muted">{avg7.days} jour{avg7.days > 1 ? 's' : ''} avec données</small></div>
        <div className="tile"><strong>{weekCount(s.exlog, t)}</strong><span>exercice{weekCount(s.exlog, t) > 1 ? 's' : ''} cette semaine</span><small className="muted"><Link to="/bien-etre">voir les exercices</Link></small></div>
      </div>

      <Card title="Ces 14 derniers jours">
        {series14.some((p) => p.general !== null) ? <><Spark values={series14.map((p) => p.general)} /><p className="muted">Un vide = un jour sans bilan (jamais un zéro).</p></> : <p className="muted">Pas encore de données : ta courbe apparaîtra après ton premier bilan.</p>}
      </Card>

      <Card title={id.title}><p>{id.text}</p><Link to={id.to} className="btn btn-ghost">{id.cta}</Link></Card>

      <Card title="Mes objectifs" actions={<Link to="/objectifs">Tout voir</Link>}>
        {goals.length === 0 ? <p className="muted">Aucun objectif en cours. Un objectif avec 2 ou 3 petites étapes, c'est déjà un bon début.</p> : (
          <ul className="plain">{goals.map((g) => { const done = g.steps.filter((x) => x.done).length; const next = g.steps.find((x) => !x.done); return (
            <li key={g.id} className="item"><span><strong>{g.title}</strong>{g.steps.length ? <> · {done}/{g.steps.length} étapes</> : null}{next ? <><br /><span className="muted">Prochaine étape : {next.title}</span></> : null}</span></li>
          ); })}</ul>
        )}
      </Card>

      <Card title="Discussion">
        <p>Ton nom# : <strong className="handle">{myTag(s)}</strong></p>
        <p className="muted">Donne-le à quelqu'un pour discuter avec lui, ou pour lui permettre (avec ton accord à chaque fois) de voir ton bilan du jour.</p>
        <div className="row">
          <Button variant="ghost" onClick={() => { void navigator.clipboard?.writeText(myTag(s)).then(() => setCopied(true)).catch(() => undefined); }}>{copied ? 'Copié ✓' : 'Copier mon nom#'}</Button>
          <Link to="/discussion" className="btn btn-ghost">{chatAvailable ? 'Ouvrir la discussion' : 'À propos de la discussion'}</Link>
        </div>
      </Card>

      <Card title="Raccourcis">
        <div className="row"><Link to="/bien-etre" className="btn btn-ghost">Respirer</Link><Link to="/objectifs" className="btn btn-ghost">Mes objectifs</Link><Link to="/bibliotheque" className="btn btn-ghost">Bibliothèque</Link><Link to="/aide" className="btn btn-ghost">Aide et écoute</Link></div>
      </Card>
    </div>
  );
}
