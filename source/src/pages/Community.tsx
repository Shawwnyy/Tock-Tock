import { useState } from 'react';
import { callFunction, db, friendlyError, supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { Alert, Avatar, Button, Card, Loading, useAction, useAsync } from '../components/ui';

interface Cat { id: string; slug: string; label: string }
interface Post { id: string; author_id: string; category_id: string; kind: string; title: string | null; body: string; status: string; created_at: string; comment_count: number; edited_at: string | null }
interface Author { id: string; handle: string; display_name: string | null; avatar_preset: string; bio?: string | null; interests?: string[] | null }
interface Media { id: string; kind: string; display_name: string; bucket: string; storage_path: string; status: string }

const KINDS: Record<string, string> = { text: 'Message', tip: 'Astuce', question: 'Question', encouragement: 'Encouragement', goal: 'Objectif', resource: 'Ressource', victory: 'Petite victoire' };
const REACTIONS: [string, string][] = [['support', '🤝 Soutien'], ['bravo', '👏 Bravo'], ['thanks', '🙏 Merci'], ['inspiring', '✨ Inspirant']];
const REASONS: Record<string, string> = { harassment: 'Harcèlement', threat: 'Menace', sexual_content: 'Contenu sexuel', violence: 'Violence', discrimination: 'Discrimination', scam_spam: 'Arnaque / spam', impersonation: 'Usurpation d\'identité', private_data: 'Données privées', dangerous_content: 'Contenu dangereux', other: 'Autre' };

export function Community() {
  const { me } = useAuth();
  const age = me!.settings!.age_band;
  const [tab, setTab] = useState<'feed' | 'saved' | 'mine'>('feed');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');

  const cats = useAsync(async () => ((await db().from('post_categories').select('id,slug,label').eq('is_active', true).order('sort_order')).data ?? []) as Cat[], []);
  const feed = useAsync(async () => {
    let req = db().from('posts').select('id,author_id,category_id,kind,title,body,status,created_at,comment_count,edited_at').order('created_at', { ascending: false }).limit(30);
    if (tab === 'mine') req = req.eq('author_id', me!.id);
    else req = req.eq('status', 'published');
    if (cat) req = req.eq('category_id', cat);
    if (query.trim().length >= 2) req = req.textSearch('search', query.trim(), { config: 'french', type: 'websearch' });
    if (tab === 'saved') {
      const { data: s } = await db().from('saved_items').select('post_id').not('post_id', 'is', null);
      const ids = (s ?? []).map((x: { post_id: string }) => x.post_id);
      if (!ids.length) return { posts: [] as Post[], authors: new Map<string, Author>(), totals: [] as { post_id: string; kind: string; n: number }[], mine: [] as { post_id: string; kind: string }[], saved: new Set<string>(), media: [] as { post_id: string; media: Media }[] };
      req = req.in('id', ids);
    }
    const { data: posts, error } = await req;
    if (error) throw error;
    const list = (posts ?? []) as Post[];
    const ids = list.map((p) => p.id);
    const authorIds = [...new Set(list.map((p) => p.author_id))];
    const [a, t, m, s, pm] = await Promise.all([
      authorIds.length ? db().from('member_profiles').select('id,handle,display_name,avatar_preset,bio,interests').in('id', authorIds) : Promise.resolve({ data: [] }),
      ids.length ? db().from('reaction_totals').select('post_id,kind,n').in('post_id', ids) : Promise.resolve({ data: [] }),
      ids.length ? db().from('reactions').select('post_id,kind').in('post_id', ids).eq('user_id', me!.id) : Promise.resolve({ data: [] }),
      ids.length ? db().from('saved_items').select('post_id').in('post_id', ids) : Promise.resolve({ data: [] }),
      ids.length ? db().from('post_media').select('post_id, media:media_assets(id,kind,display_name,bucket,storage_path,status)').in('post_id', ids) : Promise.resolve({ data: [] }),
    ]);
    return {
      posts: list, authors: new Map(((a.data ?? []) as Author[]).map((x) => [x.id, x])), totals: (t.data ?? []) as { post_id: string; kind: string; n: number }[],
      mine: (m.data ?? []) as { post_id: string; kind: string }[], saved: new Set(((s.data ?? []) as { post_id: string }[]).map((x) => x.post_id)),
      media: (pm.data ?? []) as unknown as { post_id: string; media: Media }[],
    };
  }, [tab, cat, query]);

  if (age === 'under_15') return <Alert kind="info">La communauté n'est pas disponible pour ton âge déclaré. Ton espace privé reste entièrement utilisable.</Alert>;

  return (
    <div className="stack">
      <Composer cats={cats.data ?? []} onPosted={feed.reload} />
      <Card title="Communauté">
        <div className="tabs" role="tablist">
          {([['feed', 'Fil'], ['saved', 'Favoris'], ['mine', 'Mes publications']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
          <select aria-label="Catégorie" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Toutes les catégories</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <input aria-label="Rechercher" placeholder="Rechercher un mot" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" variant="ghost">Rechercher</Button>
        </form>
        <p className="muted">Ici, pas de classement ni de compteur de popularité : seulement des réactions positives, sans noms.</p>
        {feed.loading && <Loading />}
        {feed.error && <Alert kind="error">Impossible de charger le fil pour le moment.</Alert>}
        {feed.data?.posts.length === 0 && <p className="muted">Rien à afficher pour l'instant.</p>}
        {feed.data?.posts.map((p) => <PostCard key={p.id} post={p} data={feed.data!} cats={cats.data ?? []} reload={feed.reload} />)}
      </Card>
    </div>
  );
}

function Composer({ cats, onPosted }: { cats: Cat[]; onPosted: () => void }) {
  const { me } = useAuth();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: 'text', category_id: '', title: '', body: '', rights: false });
  const [files, setFiles] = useState<File[]>([]);

  async function submit() {
    await act.run(async () => {
      const category_id = f.category_id || cats[0]?.id;
      const mediaIds: string[] = [];
      for (const file of files) {
        const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : file.type === 'application/pdf' ? 'document' : null;
        if (!kind) throw new Error('Type de fichier non pris en charge.');
        const init = await callFunction<{ mediaId?: string; path?: string; token?: string; message?: string }>('media-upload-init', { filename: file.name, size: file.size, mime: file.type, kind });
        if (!init.ok || !init.data.mediaId) throw new Error(init.data.message ?? 'Téléversement refusé.');
        const up = await supabase!.storage.from('temp-uploads').uploadToSignedUrl(init.data.path!, init.data.token!, file);
        if (up.error) throw new Error('Le dépôt du fichier a échoué.');
        const fin = await callFunction<{ message?: string; reasons?: string[] }>('media-upload-finalize', { mediaId: init.data.mediaId });
        if (!fin.ok) throw new Error(fin.data.reasons?.join(' ') ?? 'Le fichier a été refusé.');
        mediaIds.push(init.data.mediaId);
      }
      const { data, error } = await db().from('posts').insert({ author_id: me!.id, category_id, kind: f.kind, title: f.title.trim() || null, body: f.body.trim(), rights_attested: f.rights }).select('id,status').single();
      if (error) throw new Error(friendlyError(error));
      for (const [i, id] of mediaIds.entries()) await db().from('post_media').insert({ post_id: data.id, media_id: id, sort_order: i });
      setF({ ...f, title: '', body: '', rights: false }); setFiles([]); setOpen(false); onPosted();
      return data.status === 'pending_review' ? 'Ton message est en attente de relecture avant d\'être visible. Ce n\'est pas une sanction.' : mediaIds.length ? 'Publié. Tes fichiers seront visibles après relecture.' : 'Publié.';
    });
  }

  if (!open) return <div><Button onClick={() => setOpen(true)}>✍️ Publier</Button>{act.done && <Alert kind="success">{act.done}</Alert>}</div>;
  return (
    <Card title="Nouvelle publication">
      <p className="muted">Sois bienveillant·e : pas d'information privée, pas de conseil médical, pas de lien douteux. Les messages peuvent être relus.</p>
      <div className="row">
        <label>Type<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Catégorie<select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      </div>
      <label>Titre (facultatif)<input maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label>Message<textarea rows={5} maxLength={5000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      <label>Joindre des fichiers (image, audio, vidéo, PDF)<input type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,audio/*,video/mp4,video/webm,application/pdf" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 4))} /></label>
      {(f.kind === 'resource' || files.length > 0) && <label className="check"><input type="checkbox" checked={f.rights} onChange={(e) => setF({ ...f, rights: e.target.checked })} /> J'atteste avoir le droit de partager ce contenu.</label>}
      {act.error && <Alert kind="error">{act.error}</Alert>}
      <div className="row"><Button busy={act.busy} disabled={!f.body.trim() || ((f.kind === 'resource' || files.length > 0) && !f.rights)} onClick={submit}>Publier</Button><Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button></div>
    </Card>
  );
}

type FeedData = { authors: Map<string, Author>; totals: { post_id: string; kind: string; n: number }[]; mine: { post_id: string; kind: string }[]; saved: Set<string>; media: { post_id: string; media: Media }[] };

function PostCard({ post, data, cats, reload }: { post: Post; data: FeedData; cats: Cat[]; reload: () => void }) {
  const { me } = useAuth();
  const act = useAction();
  const author = data.authors.get(post.author_id);
  const [showComments, setShowComments] = useState(false);
  const [report, setReport] = useState(false);
  const [profile, setProfile] = useState(false);
  const mineKinds = new Set(data.mine.filter((m) => m.post_id === post.id).map((m) => m.kind));
  const isMine = post.author_id === me!.id;
  const media = data.media.filter((m) => m.post_id === post.id && m.media);

  const toggle = (kind: string) => act.run(async () => {
    const { error } = mineKinds.has(kind) ? await db().from('reactions').delete().eq('post_id', post.id).eq('kind', kind).eq('user_id', me!.id) : await db().from('reactions').insert({ post_id: post.id, kind, user_id: me!.id });
    if (error) throw new Error(friendlyError(error));
    reload();
  });

  return (
    <article className="post">
      <header>
        <button className="linklike author" onClick={() => setProfile(!profile)} aria-expanded={profile}><Avatar preset={author?.avatar_preset ?? 'sun'} /> <strong>{author?.display_name ?? 'Membre'}</strong> <span className="handle">{author?.handle ?? ''}</span></button>
        <span className="muted"> · {timeAgo(post.created_at)} · {KINDS[post.kind] ?? post.kind} · {cats.find((c) => c.id === post.category_id)?.label}</span>
        {post.status !== 'published' && <span className="badge">{post.status === 'pending_review' ? 'En attente de relecture' : post.status === 'hidden' ? 'Masqué' : post.status}</span>}
      </header>
      {profile && author && <div className="profile"><p>{author.bio || <span className="muted">Pas de présentation.</span>}</p>{author.interests?.length ? <p>Centres d'intérêt : {author.interests.join(', ')}</p> : null}</div>}
      {post.title && <h3>{post.title}</h3>}
      <p className="pre">{post.body}</p>
      {media.map((m) => <MediaView key={m.media.id} m={m.media} />)}
      <div className="row reactions">
        {REACTIONS.map(([k, l]) => {
          const n = data.totals.find((t) => t.post_id === post.id && t.kind === k)?.n ?? 0;
          return <button key={k} className={`pill ${mineKinds.has(k) ? 'on' : ''}`} aria-pressed={mineKinds.has(k)} onClick={() => toggle(k)}>{l}{n > 0 ? ` · ${n}` : ''}</button>;
        })}
        <button className={`pill ${data.saved.has(post.id) ? 'on' : ''}`} aria-pressed={data.saved.has(post.id)} onClick={() => act.run(async () => { const { error } = data.saved.has(post.id) ? await db().from('saved_items').delete().eq('post_id', post.id) : await db().from('saved_items').insert({ user_id: me!.id, post_id: post.id }); if (error) throw new Error(friendlyError(error)); reload(); })}>🔖 Favori</button>
        <button className="pill" onClick={() => setShowComments(!showComments)} aria-expanded={showComments}>💬 {post.comment_count}</button>
      </div>
      {act.error && <Alert kind="error">{act.error}</Alert>}
      {showComments && <Comments postId={post.id} onChange={reload} />}
      <div className="row small">
        {!isMine && <button className="linklike" onClick={() => setReport(!report)}>Signaler</button>}
        {!isMine && <button className="linklike" onClick={() => { if (confirm('Bloquer ce membre ? Vous ne verrez plus vos contenus respectifs.')) act.run(async () => { const { error } = await db().from('blocks').insert({ blocker_id: me!.id, blocked_id: post.author_id, mode: 'block' }); if (error) throw new Error(friendlyError(error)); reload(); }); }}>Bloquer</button>}
        {isMine && <button className="linklike" onClick={() => { if (confirm('Supprimer ta publication ?')) act.run(async () => { await db().from('posts').delete().eq('id', post.id); reload(); }); }}>Supprimer</button>}
      </div>
      {report && <ReportForm target={{ type: 'post', id: post.id }} onDone={() => setReport(false)} />}
    </article>
  );
}

function MediaView({ m }: { m: Media }) {
  const { data } = useAsync(async () => (m.status === 'approved' || m.status === 'pending_review' ? (await supabase!.storage.from(m.bucket).createSignedUrl(m.storage_path, 300)).data?.signedUrl ?? null : null), [m.id]);
  if (m.status === 'pending_review') return <p className="muted">📎 {m.display_name} — en attente de relecture.</p>;
  if (!data) return <p className="muted">📎 {m.display_name}</p>;
  if (m.kind === 'image') return <img src={data} alt={m.display_name} loading="lazy" className="media" />;
  if (m.kind === 'audio') return <audio controls src={data} preload="none" />;
  if (m.kind === 'video') return <video controls src={data} preload="none" className="media" />;
  return <a href={data} target="_blank" rel="noopener noreferrer">📄 {m.display_name}</a>;
}

function Comments({ postId, onChange }: { postId: string; onChange: () => void }) {
  const { me } = useAuth();
  const act = useAction();
  const [body, setBody] = useState('');
  const [report, setReport] = useState<string | null>(null);
  const { data, loading, reload } = useAsync(async () => {
    const { data: c } = await db().from('comments').select('id,author_id,body,created_at,status').eq('post_id', postId).order('created_at');
    const ids = [...new Set((c ?? []).map((x: { author_id: string }) => x.author_id))];
    const { data: a } = ids.length ? await db().from('member_profiles').select('id,handle,display_name').in('id', ids) : { data: [] };
    return { comments: (c ?? []) as { id: string; author_id: string; body: string; created_at: string; status: string }[], authors: new Map(((a ?? []) as { id: string; handle: string; display_name: string }[]).map((x) => [x.id, x])) };
  }, [postId]);
  return (
    <div className="comments">
      {loading && <Loading />}
      {data?.comments.map((c) => (
        <div key={c.id} className="comment">
          <strong>{data.authors.get(c.author_id)?.display_name ?? 'Membre'}</strong> <span className="muted">{timeAgo(c.created_at)}{c.status === 'pending_review' ? ' · en attente de relecture' : ''}</span>
          <p className="pre">{c.body}</p>
          <div className="row small">
            {c.author_id !== me!.id && <button className="linklike" onClick={() => setReport(report === c.id ? null : c.id)}>Signaler</button>}
            {c.author_id === me!.id && <button className="linklike" onClick={() => act.run(async () => { await db().from('comments').delete().eq('id', c.id); reload(); onChange(); })}>Supprimer</button>}
          </div>
          {report === c.id && <ReportForm target={{ type: 'comment', id: c.id }} onDone={() => setReport(null)} />}
        </div>
      ))}
      <form className="row" onSubmit={(e) => { e.preventDefault(); act.run(async () => { const { error } = await db().from('comments').insert({ post_id: postId, author_id: me!.id, body: body.trim() }); if (error) throw new Error(friendlyError(error)); setBody(''); reload(); onChange(); }); }}>
        <input aria-label="Ton commentaire" placeholder="Écrire un commentaire bienveillant" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
        <Button type="submit" busy={act.busy} disabled={!body.trim()}>Envoyer</Button>
      </form>
      {act.error && <Alert kind="error">{act.error}</Alert>}
    </div>
  );
}

export function ReportForm({ target, onDone }: { target: { type: 'post' | 'comment' | 'media' | 'profile'; id: string }; onDone: () => void }) {
  const { me } = useAuth();
  const act = useAction();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  return (
    <div className="report">
      <label>Motif<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Choisir…</option>{Object.entries(REASONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label>Précisions (facultatif)<textarea rows={2} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
      {act.error && <Alert kind="error">{act.error}</Alert>}
      {act.done && <Alert kind="success">{act.done}</Alert>}
      <div className="row">
        <Button disabled={!reason} busy={act.busy} onClick={() => act.run(async () => { const { error } = await db().from('reports').insert({ reporter_id: me!.id, target_type: target.type, target_id: target.id, reason, details: details.trim() || null }); if (error) throw new Error(friendlyError(error)); setTimeout(onDone, 1500); return 'Merci, ton signalement a été transmis à l\'équipe de modération.'; })}>Envoyer le signalement</Button>
        <Button variant="ghost" onClick={onDone}>Annuler</Button>
      </div>
    </div>
  );
}
