import { useState } from 'react';
import { db, friendlyError, supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { Alert, Button, Card, Loading, useAction, useAsync } from '../components/ui';
import { StaffTickets } from './StaffTickets';

interface Report { id: string; created_at: string; status: string; reason: string; details: string | null; target_type: 'post' | 'comment' | 'media' | 'profile'; target_id: string; target_user_id: string | null; target_user_handle: string | null; target_snapshot: { body?: string; title?: string } | null; reports_on_target: number; reporter_handle: string | null }
interface MediaQ { id: string; created_at: string; kind: string; display_name: string; size_bytes: number; detected_mime: string | null; owner_handle: string; owner_is_minor: boolean; storage_path: string; scan_result: { notes?: string[] } }
interface Appeal { id: string; user_handle: string; message: string; status: string; created_at: string; target_type: string | null }

export function Moderation() {
  const { me } = useAuth();
  const [tab, setTab] = useState<'reports' | 'media' | 'appeals' | 'tickets'>('reports');
  if (!me!.role) return <Alert kind="error">Cet espace est réservé à l'équipe de modération.</Alert>;
  return (
    <div className="stack">
      <Card title={`Modération — rôle : ${me!.role}`}>
        <p className="muted">Tu vois uniquement ce qui a été signalé ou soumis à relecture. Les bilans, objectifs, chroniques et conversations privées te sont inaccessibles. Chaque décision est enregistrée.</p>
        <div className="tabs" role="tablist">{([['reports', 'Signalements'], ['media', 'Fichiers à relire'], ['appeals', 'Contestations'], ['tickets', 'Tickets d\'aide']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      </Card>
      {tab === 'reports' && <Reports />}
      {tab === 'media' && <MediaQueue />}
      {tab === 'appeals' && <Appeals />}
      {tab === 'tickets' && <StaffTickets />}
    </div>
  );
}

function Reports() {
  const act = useAction();
  const { data, loading, reload } = useAsync(async () => ((await db().from('staff_reports').select('*').in('status', ['open', 'in_review', 'escalated']).order('created_at')).data ?? []) as Report[], []);
  const [note, setNote] = useState<Record<string, string>>({});
  if (loading) return <Loading />;
  const run = (fn: () => PromiseLike<{ error: unknown }>) => act.run(async () => { const { error } = await fn(); if (error) throw new Error(friendlyError(error)); reload(); });
  return (
    <>
      {act.error && <Alert kind="error">{act.error}</Alert>}
      {data?.length === 0 && <p className="muted">Aucun signalement à traiter.</p>}
      {data?.map((r) => (
        <Card key={r.id} title={`${r.reason} — ${r.target_type}`}>
          <p className="muted">{timeAgo(r.created_at)} · {r.reports_on_target} signalement(s) sur ce contenu · statut : {r.status} · auteur : {r.target_user_handle ?? 'inconnu'}</p>
          {r.target_snapshot?.title && <h4>{r.target_snapshot.title}</h4>}
          <blockquote className="pre">{r.target_snapshot?.body ?? '(contenu indisponible)'}</blockquote>
          {r.details && <p>Précisions : {r.details}</p>}
          <label>Explication (obligatoire pour masquer, retirer ou clore)<textarea rows={2} value={note[r.id] ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} /></label>
          <div className="row">
            {(r.target_type === 'post' || r.target_type === 'comment') && <>
              <Button variant="ghost" onClick={() => run(() => db().rpc('moderate_content', { p_target_type: r.target_type, p_target_id: r.target_id, p_action: 'hide', p_reason: 'report', p_explanation: note[r.id] ?? '', p_report_id: r.id }))}>Masquer</Button>
              <Button variant="danger" onClick={() => run(() => db().rpc('moderate_content', { p_target_type: r.target_type, p_target_id: r.target_id, p_action: 'remove', p_reason: 'report', p_explanation: note[r.id] ?? '', p_report_id: r.id }))}>Retirer</Button>
            </>}
            <Button variant="ghost" onClick={() => run(() => db().rpc('act_on_report', { p_report: r.id, p_status: 'in_review' }))}>Prendre en charge</Button>
            <Button variant="ghost" onClick={() => run(() => db().rpc('act_on_report', { p_report: r.id, p_status: 'escalated', p_note: note[r.id] ?? '' }))}>Escalader</Button>
            <Button variant="ghost" onClick={() => run(() => db().rpc('act_on_report', { p_report: r.id, p_status: 'closed', p_decision: 'no_action', p_note: note[r.id] ?? null }))}>Clore sans action</Button>
            {r.target_user_id && <Button variant="danger" onClick={() => { const days = Number(prompt('Suspension : combien de jours ? (1 à 90)')); if (days > 0) run(() => db().rpc('apply_sanction', { p_user: r.target_user_id, p_kind: 'suspension', p_reason_code: r.reason, p_explanation: note[r.id] ?? '', p_days: days, p_report_id: r.id })); }}>Suspendre…</Button>}
          </div>
        </Card>
      ))}
    </>
  );
}

function MediaQueue() {
  const act = useAction();
  const { data, loading, reload } = useAsync(async () => ((await db().from('staff_media_queue').select('*').order('created_at')).data ?? []) as MediaQ[], []);
  const [note, setNote] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  if (loading) return <Loading />;
  return (
    <>
      {act.error && <Alert kind="error">{act.error}</Alert>}
      {data?.length === 0 && <p className="muted">Aucun fichier en attente.</p>}
      {data?.map((m) => (
        <Card key={m.id} title={m.display_name}>
          <p className="muted">{m.kind} · {m.detected_mime} · {(m.size_bytes / 1024).toFixed(0)} Ko · envoyé par {m.owner_handle}{m.owner_is_minor ? ' · ⚠ membre mineur : vigilance renforcée' : ''}</p>
          {m.scan_result?.notes?.map((n) => <Alert key={n} kind="warn">{n}</Alert>)}
          {urls[m.id] ? (m.kind === 'image' ? <img className="media" src={urls[m.id]} alt="" /> : m.kind === 'audio' ? <audio controls src={urls[m.id]} /> : m.kind === 'video' ? <video className="media" controls src={urls[m.id]} /> : <a href={urls[m.id]} target="_blank" rel="noopener noreferrer">Ouvrir le document</a>)
            : <Button variant="ghost" onClick={async () => { const { data: u } = await supabase!.storage.from('community-media').createSignedUrl(m.storage_path, 120); if (u?.signedUrl) setUrls({ ...urls, [m.id]: u.signedUrl }); }}>Afficher le fichier (lien de 2 minutes)</Button>}
          <label>Motif (obligatoire pour refuser, 10 caractères minimum)<textarea rows={2} value={note[m.id] ?? ''} onChange={(e) => setNote({ ...note, [m.id]: e.target.value })} /></label>
          <div className="row">
            <Button onClick={() => act.run(async () => { const { error } = await db().rpc('review_media', { p_media: m.id, p_decision: 'approve', p_note: note[m.id] ?? null }); if (error) throw new Error(friendlyError(error)); reload(); })}>Approuver</Button>
            <Button variant="danger" onClick={() => act.run(async () => { const { error } = await db().rpc('review_media', { p_media: m.id, p_decision: 'reject', p_note: note[m.id] ?? '' }); if (error) throw new Error(friendlyError(error)); reload(); })}>Refuser</Button>
          </div>
        </Card>
      ))}
    </>
  );
}

function Appeals() {
  const act = useAction();
  const { data, loading, reload } = useAsync(async () => ((await db().from('appeals').select('id,user_handle,message,status,created_at,target_type').eq('status', 'open').order('created_at')).data ?? []) as Appeal[], []);
  const [note, setNote] = useState<Record<string, string>>({});
  if (loading) return <Loading />;
  return (
    <>
      {act.error && <Alert kind="error">{act.error}</Alert>}
      {data?.length === 0 && <p className="muted">Aucune contestation en attente.</p>}
      {data?.map((a) => (
        <Card key={a.id} title={`Contestation de ${a.user_handle}`}>
          <p className="muted">{timeAgo(a.created_at)} · {a.target_type ?? 'sanction'}</p>
          <blockquote className="pre">{a.message}</blockquote>
          <label>Réponse motivée<textarea rows={2} value={note[a.id] ?? ''} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} /></label>
          <div className="row">
            <Button onClick={() => act.run(async () => { const { error } = await db().rpc('decide_appeal', { p_id: a.id, p_outcome: 'overturned', p_note: note[a.id] ?? '' }); if (error) throw new Error(friendlyError(error)); reload(); })}>Donner raison au membre</Button>
            <Button variant="ghost" onClick={() => act.run(async () => { const { error } = await db().rpc('decide_appeal', { p_id: a.id, p_outcome: 'upheld', p_note: note[a.id] ?? '' }); if (error) throw new Error(friendlyError(error)); reload(); })}>Maintenir la décision</Button>
          </div>
        </Card>
      ))}
    </>
  );
}
