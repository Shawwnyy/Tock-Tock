import { useState } from 'react';
import { db, friendlyError } from '../lib/supabase';
import { Alert, Button, Card, Loading, useAction, useAsync } from '../components/ui';

interface Step { id: string; title: string; done: boolean; sort_order: number }
interface Goal { id: string; title: string; description: string | null; due_date: string | null; status: 'todo' | 'in_progress' | 'paused' | 'done' | 'archived'; progress: number | null; share_on_profile: boolean; goal_steps: Step[] }
const STATUS: Record<Goal['status'], string> = { todo: 'À faire', in_progress: 'En cours', paused: 'En pause', done: 'Terminé', archived: 'Archivé' };

export function Goals() {
  const act = useAction();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const { data, loading, reload } = useAsync(async () => {
    const { data: g } = await db().from('goals').select('*, goal_steps(id,title,done,sort_order)').order('created_at', { ascending: false });
    return (g ?? []) as Goal[];
  }, []);
  const run = (fn: () => PromiseLike<{ error: unknown }>, msg?: string) => act.run(async () => { const { error } = await fn(); if (error) throw new Error(friendlyError(error)); reload(); return msg; });
  if (loading || !data) return <Loading />;
  const goals = data.filter((g) => showArchived || g.status !== 'archived');

  return (
    <div className="stack">
      <Card title="Nouvel objectif">
        <label>Titre<input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Échéance (facultatif)<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <Button disabled={!title.trim()} busy={act.busy} onClick={async () => { await run(async () => db().from('goals').insert({ user_id: (await db().auth.getUser()).data.user!.id, title: title.trim(), due_date: due || null }), 'Objectif créé.'); setTitle(''); setDue(''); }}>Créer</Button>
        {act.error && <Alert kind="error">{act.error}</Alert>}
      </Card>
      {goals.length === 0 && <p className="muted">Aucun objectif pour le moment. Un petit objectif découpé en petites étapes, c'est déjà beaucoup.</p>}
      {goals.map((g) => {
        const done = g.goal_steps.filter((s) => s.done).length;
        const pct = g.goal_steps.length ? Math.round((done / g.goal_steps.length) * 100) : g.progress;
        return (
          <Card key={g.id} title={g.title}>
            <p className="muted">{STATUS[g.status]}{g.due_date ? ` · échéance ${g.due_date}` : ''}{pct !== null && pct !== undefined ? ` · ${pct} %` : ''}</p>
            {pct !== null && pct !== undefined && <progress max={100} value={pct} aria-label={`Progression de ${g.title}`} />}
            <ul className="plain">
              {[...g.goal_steps].sort((a, b) => a.sort_order - b.sort_order).map((s) => (
                <li key={s.id} className="item">
                  <label className="check"><input type="checkbox" checked={s.done} onChange={(e) => run(() => db().from('goal_steps').update({ done: e.target.checked, done_at: e.target.checked ? new Date().toISOString() : null }).eq('id', s.id))} /> <span className={s.done ? 'done' : ''}>{s.title}</span></label>
                  <Button variant="ghost" aria-label={`Retirer l'étape ${s.title}`} onClick={() => run(() => db().from('goal_steps').delete().eq('id', s.id))}>✕</Button>
                </li>
              ))}
            </ul>
            <AddStep goalId={g.id} count={g.goal_steps.length} onAdded={reload} />
            <div className="row">
              <select aria-label="Statut" value={g.status} onChange={(e) => run(() => db().from('goals').update({ status: e.target.value }).eq('id', g.id))}>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <label className="check"><input type="checkbox" checked={g.share_on_profile} onChange={(e) => run(() => db().from('goals').update({ share_on_profile: e.target.checked }).eq('id', g.id))} /> Montrer le titre sur mon profil</label>
              <Button variant="danger" onClick={() => { if (confirm('Supprimer cet objectif ?')) run(() => db().from('goals').delete().eq('id', g.id)); }}>Supprimer</Button>
            </div>
          </Card>
        );
      })}
      <label className="check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Afficher les objectifs archivés</label>
    </div>
  );
}

function AddStep({ goalId, count, onAdded }: { goalId: string; count: number; onAdded: () => void }) {
  const [t, setT] = useState('');
  return (
    <form className="row" onSubmit={async (e) => {
      e.preventDefault();
      if (!t.trim()) return;
      const { error } = await db().from('goal_steps').insert({ goal_id: goalId, user_id: (await db().auth.getUser()).data.user!.id, title: t.trim(), sort_order: count + 1 });
      if (!error) { setT(''); onAdded(); }
    }}>
      <input aria-label="Nouvelle étape" placeholder="Ajouter une étape" value={t} maxLength={160} onChange={(e) => setT(e.target.value)} />
      <Button type="submit" variant="ghost" disabled={!t.trim()}>Ajouter</Button>
    </form>
  );
}
