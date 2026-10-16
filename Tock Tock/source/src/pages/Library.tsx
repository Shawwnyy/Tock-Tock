import { useState } from 'react';
import { db, friendlyError, supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { MdLite } from '../components/MdLite';
import { Alert, Button, Card, Loading, useAction, useAsync } from '../components/ui';

interface Res { id: string; origin: 'official' | 'external'; kind: string; title: string; summary: string; body_md: string | null; external_url: string | null; source_label: string; license_note: string; tags: string[]; media_id: string | null }
interface Path { id: string; title: string; summary: string; pathway_steps: { resource_id: string; step_order: number; is_optional: boolean; hint: string | null }[] }
const KIND: Record<string, string> = { tip: 'Astuce', exercise: 'Exercice', sheet: 'Fiche', image: 'Image', audio: 'Audio', video: 'Vidéo', pdf: 'PDF', link: 'Lien' };

export function Library() {
  const { me } = useAuth();
  const act = useAction();
  const [kind, setKind] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(async () => {
    const [r, p, pr, s] = await Promise.all([
      db().from('resources').select('*').eq('status', 'published').order('sort_order'),
      db().from('pathways').select('*, pathway_steps(resource_id,step_order,is_optional,hint)').eq('status', 'published').order('sort_order'),
      db().from('resource_progress').select('resource_id,status'),
      db().from('saved_items').select('resource_id').not('resource_id', 'is', null),
    ]);
    if (r.error) throw r.error;
    return { res: (r.data ?? []) as Res[], paths: (p.data ?? []) as Path[], progress: new Map(((pr.data ?? []) as { resource_id: string; status: string }[]).map((x) => [x.resource_id, x.status])), saved: new Set(((s.data ?? []) as { resource_id: string }[]).map((x) => x.resource_id)) };
  }, []);

  if (loading) return <Loading />;
  if (error || !data) return <Alert kind="info">La bibliothèque n'est pas disponible pour le moment.</Alert>;
  const list = data.res.filter((r) => !kind || r.kind === kind);
  return (
    <div className="stack">
      <Card title="Bibliothèque">
        <p className="muted">Des ressources sélectionnées par l'équipe, avec leur source et leurs droits. Elles ne remplacent pas un avis médical.</p>
        <label>Type<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Tous</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {act.error && <Alert kind="error">{act.error}</Alert>}
        {list.length === 0 && <p className="muted">Aucune ressource publiée pour le moment.</p>}
        {list.map((r) => (
          <article key={r.id} className="post">
            <h3><button className="linklike" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{r.title}</button></h3>
            <p className="muted">{KIND[r.kind]} · {r.source_label}{data.progress.get(r.id) === 'done' ? ' · ✔ terminé' : data.progress.get(r.id) === 'started' ? ' · commencé' : ''}</p>
            <p>{r.summary}</p>
            {open === r.id && (
              <div>
                {r.body_md && <MdLite text={r.body_md} />}
                {r.external_url && <p><a href={r.external_url} target="_blank" rel="noopener noreferrer nofollow">Ouvrir le lien externe ↗</a> <span className="muted">(site extérieur : Tock Tock n'en est pas responsable)</span></p>}
                {r.media_id && <ResourceMedia id={r.media_id} />}
                <p className="muted">Droits : {r.license_note}</p>
                <div className="row">
                  <Button variant="ghost" onClick={() => act.run(async () => { const { error: e } = await db().rpc('set_resource_progress', { p_resource: r.id, p_status: 'done' }); if (e) throw new Error(friendlyError(e)); reload(); })}>Marquer comme terminé</Button>
                  <Button variant="ghost" onClick={() => act.run(async () => { const { error: e } = data.saved.has(r.id) ? await db().from('saved_items').delete().eq('resource_id', r.id) : await db().from('saved_items').insert({ user_id: me!.id, resource_id: r.id }); if (e) throw new Error(friendlyError(e)); reload(); })}>{data.saved.has(r.id) ? 'Retirer des favoris' : '🔖 Ajouter aux favoris'}</Button>
                </div>
              </div>
            )}
          </article>
        ))}
      </Card>
      {data.paths.map((p) => (
        <Card key={p.id} title={`Parcours : ${p.title}`}>
          <p>{p.summary}</p>
          <ol>{[...p.pathway_steps].sort((a, b) => a.step_order - b.step_order).map((s) => { const r = data.res.find((x) => x.id === s.resource_id); return r ? <li key={s.resource_id}>{r.title}{s.is_optional ? ' (facultatif)' : ''}{data.progress.get(r.id) === 'done' ? ' ✔' : ''}{s.hint ? <span className="muted"> — {s.hint}</span> : null}</li> : null; })}</ol>
        </Card>
      ))}
    </div>
  );
}

function ResourceMedia({ id }: { id: string }) {
  const { data } = useAsync(async () => {
    const { data: m } = await db().from('media_assets').select('kind,display_name,bucket,storage_path,status').eq('id', id).maybeSingle();
    if (!m || m.status !== 'approved') return null;
    const { data: u } = await supabase!.storage.from(m.bucket).createSignedUrl(m.storage_path, 300);
    return u?.signedUrl ? { url: u.signedUrl, kind: m.kind as string, name: m.display_name as string } : null;
  }, [id]);
  if (!data) return null;
  if (data.kind === 'image') return <img className="media" src={data.url} alt={data.name} />;
  if (data.kind === 'audio') return <audio controls src={data.url} />;
  if (data.kind === 'video') return <video className="media" controls src={data.url} />;
  return <a href={data.url} target="_blank" rel="noopener noreferrer">📄 {data.name}</a>;
}
