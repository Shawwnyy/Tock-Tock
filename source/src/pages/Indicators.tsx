import { useState } from 'react';
import { db, friendlyError } from '../lib/supabase';
import { Alert, Button, Card, Loading, Toggle, useAction, useAsync } from '../components/ui';

interface Cat { id: string; name: string; sort_order: number }
interface Ind { id: string; category_id: string; name: string; description: string | null; response_type: string; scale_min: number | null; scale_max: number | null; is_active: boolean; include_in_average: boolean; is_required: boolean; sort_order: number; choices: { label: string; score: number | null }[] | null }

export function Indicators() {
  const act = useAction();
  const { data, loading, reload } = useAsync(async () => {
    const [c, i] = await Promise.all([
      db().from('indicator_categories').select('id,name,sort_order').is('deleted_at', null).order('sort_order'),
      db().from('indicators').select('*').is('deleted_at', null).order('sort_order'),
    ]);
    return { cats: (c.data ?? []) as Cat[], inds: (i.data ?? []) as Ind[] };
  }, []);
  const [name, setName] = useState('');
  const [cat, setCat] = useState('');
  const [type, setType] = useState<'scale' | 'text' | 'choice' | 'boolean'>('scale');
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(10);
  const [choices, setChoices] = useState('');
  const [newCat, setNewCat] = useState('');

  const patch = (id: string, p: Partial<Ind>) => act.run(async () => {
    const { error } = await db().from('indicators').update(p).eq('id', id);
    if (error) throw new Error(friendlyError(error));
    reload();
  });

  if (loading || !data) return <Loading />;

  async function add() {
    await act.run(async () => {
      const cid = cat || data!.cats[0]?.id;
      if (!cid) throw new Error('Crée d\'abord une catégorie.');
      let ch: { label: string; score: number | null }[] | null = null;
      if (type === 'choice') {
        // « Libellé=score » ; sans score, la réponse n'entre pas dans la moyenne.
        ch = choices.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
          const [label, s] = l.split('=');
          const n = s === undefined || s.trim() === '' ? null : Number(s);
          return { label: label.trim(), score: n !== null && Number.isFinite(n) && n >= 0 && n <= 10 ? n : null };
        });
        if (ch.length < 2) throw new Error('Un choix multiple demande au moins deux options.');
      }
      const { error } = await db().from('indicators').insert({
        user_id: (await db().auth.getUser()).data.user!.id, category_id: cid, name: name.trim(), response_type: type,
        scale_min: type === 'scale' ? min : null, scale_max: type === 'scale' ? max : null, choices: ch,
        include_in_average: type === 'scale' || (type === 'choice' && !!ch && ch.every((c) => c.score !== null)), sort_order: data!.inds.length + 1,
      });
      if (error) throw new Error(friendlyError(error));
      setName(''); setChoices(''); reload();
      return 'Indicateur ajouté.';
    });
  }

  return (
    <div className="stack">
      <Card title="Mes indicateurs">
        <p className="muted">Tout est modifiable. Désactiver un indicateur le retire de ton bilan sans effacer l'historique : tes anciens bilans gardent la définition de l'époque.</p>
        {act.error && <Alert kind="error">{act.error}</Alert>}
        {act.done && <Alert kind="success">{act.done}</Alert>}
        {data.cats.map((c) => (
          <div key={c.id} className="group">
            <h3>{c.name}</h3>
            <ul className="plain">
              {data.inds.filter((i) => i.category_id === c.id).map((i) => (
                <li key={i.id} className="item">
                  <div>
                    <strong className={i.is_active ? '' : 'off'}>{i.name}</strong>
                    <span className="muted"> · {i.response_type === 'scale' ? `échelle ${i.scale_min}–${i.scale_max}` : i.response_type === 'choice' ? 'choix' : i.response_type === 'boolean' ? 'oui/non' : 'texte'}</span>
                    {!i.include_in_average && <span className="muted"> · hors moyenne</span>}
                  </div>
                  <div className="row">
                    <Toggle id={`a-${i.id}`} label="Actif" checked={i.is_active} onChange={(v) => patch(i.id, { is_active: v })} />
                    {(i.response_type === 'scale' || i.response_type === 'choice') && <Toggle id={`m-${i.id}`} label="Dans la moyenne" checked={i.include_in_average} onChange={(v) => patch(i.id, { include_in_average: v })} />}
                    <Button variant="danger" onClick={() => { if (confirm(`Supprimer « ${i.name} » ? Tes anciens bilans restent intacts.`)) act.run(async () => { const { error } = await db().from('indicators').update({ deleted_at: new Date().toISOString(), is_active: false } as never).eq('id', i.id); if (error) throw new Error(friendlyError(error)); reload(); }); }}>Supprimer</Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <Button variant="ghost" onClick={() => act.run(async () => { const { error } = await db().rpc('restore_default_indicators'); if (error) throw new Error(friendlyError(error)); reload(); return 'Indicateurs par défaut restaurés (rien n\'a été écrasé).'; })}>Restaurer les indicateurs par défaut</Button>
      </Card>

      <Card title="Ajouter un indicateur">
        <label>Nom<input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
        <label>Catégorie<select value={cat} onChange={(e) => setCat(e.target.value)}>{data.cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Type de réponse<select value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="scale">Échelle numérique</option><option value="boolean">Oui / non</option><option value="choice">Choix</option><option value="text">Texte libre</option></select></label>
        {type === 'scale' && <div className="row"><label>Minimum<input type="number" value={min} onChange={(e) => setMin(+e.target.value)} /></label><label>Maximum<input type="number" value={max} onChange={(e) => setMax(+e.target.value)} /></label></div>}
        {type === 'choice' && <label>Options (une par ligne, « libellé=note de 0 à 10 » facultative)<textarea rows={4} value={choices} onChange={(e) => setChoices(e.target.value)} placeholder={'Bien=8\nMoyen=5\nDifficile=2'} /></label>}
        <Button onClick={add} busy={act.busy} disabled={name.trim().length < 1 || (type === 'scale' && max <= min)}>Ajouter</Button>
      </Card>

      <Card title="Ajouter une catégorie">
        <label>Nom<input value={newCat} maxLength={60} onChange={(e) => setNewCat(e.target.value)} /></label>
        <Button onClick={() => act.run(async () => { const { error } = await db().from('indicator_categories').insert({ user_id: (await db().auth.getUser()).data.user!.id, name: newCat.trim(), sort_order: data.cats.length + 1 }); if (error) throw new Error(friendlyError(error)); setNewCat(''); reload(); })} disabled={!newCat.trim()}>Créer</Button>
      </Card>
    </div>
  );
}
