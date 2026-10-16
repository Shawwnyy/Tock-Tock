// File des tickets pour le personnel : pseudonyme + contenu du ticket uniquement (aucune donnée privée de bien-être).
import { useState } from 'react';
import { Alert, Button, Card, Field, Loading, useAction, useAsync } from '../components/ui';
import { timeAgo } from '../lib/format';
import { db, friendlyError } from '../lib/supabase';
import { CATEGORY_LABEL, STATUS_LABEL } from './Support';

interface T { id: string; ref: string; created_at: string; updated_at: string; status: string; priority: string; category: string; subject: string; flags: { needs_support?: boolean }; diagnostic: Record<string, string>; user_handle: string; message_count: number }
interface M { id: string; created_at: string; is_staff: boolean; internal: boolean; body: string; author_handle: string | null }

export function StaffTickets() {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('active');
  const list = useAsync(async () => ((await db().from('staff_tickets').select('*').order('created_at')).data ?? []) as T[], [open]);
  if (open) { const t = list.data?.find((x) => x.id === open); return t ? <Thread t={t} back={() => setOpen(null)} /> : <Loading />; }
  if (list.loading) return <Loading />;
  const rows = (list.data ?? []).filter((t) => (filter === 'active' ? t.status === 'open' || t.status === 'pending_member' : filter === 'all' ? true : t.status === filter))
    .sort((a, b) => Number(!!b.flags?.needs_support) - Number(!!a.flags?.needs_support) || Number(b.priority === 'important') - Number(a.priority === 'important') || a.created_at.localeCompare(b.created_at));
  return (
    <div className="stack">
      <div className="row"><label>Afficher<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="active">À traiter</option><option value="open">Ouverts</option><option value="pending_member">En attente du membre</option><option value="resolved">Résolus</option><option value="closed">Fermés</option><option value="all">Tous</option></select></label></div>
      <p className="muted">Tri : détresse signalée d'abord, puis priorité importante, puis ancienneté.</p>
      {rows.length === 0 && <p className="muted">Aucun ticket.</p>}
      <ul className="plain">{rows.map((t) => <li className="item" key={t.id}><button className="linklike" onClick={() => setOpen(t.id)}>{t.flags?.needs_support ? '🆘 ' : t.priority === 'important' ? '❗ ' : ''}{t.ref} — {t.subject}</button><span className="muted">{t.user_handle} · {STATUS_LABEL[t.status]} · {timeAgo(t.created_at)}</span></li>)}</ul>
    </div>
  );
}

function Thread({ t, back }: { t: T; back: () => void }) {
  const act = useAction();
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const msgs = useAsync(async () => ((await db().from('staff_ticket_messages').select('id,created_at,is_staff,internal,body,author_handle').eq('ticket_id', t.id).order('created_at')).data ?? []) as M[], [t.id]);
  const run = (fn: () => PromiseLike<{ error: unknown }>) => act.run(async () => { const { error } = await fn(); if (error) throw new Error(friendlyError(error)); msgs.reload(); });
  return (
    <div className="stack">
      <Button variant="ghost" onClick={back}>← File des tickets</Button>
      <Card title={`${t.ref} — ${t.subject}`}>
        {t.flags?.needs_support && <Alert kind="warn">Le texte évoque une détresse : réponds en priorité, avec bienveillance, et rappelle les ressources d'aide humaines. Tu n'es pas un service d'urgence.</Alert>}
        <p className="muted">{t.user_handle} · {CATEGORY_LABEL[t.category]} · {STATUS_LABEL[t.status]} · priorité {t.priority === 'important' ? 'importante' : 'normale'}</p>
        {Object.keys(t.diagnostic ?? {}).length > 0 && <details className="doc"><summary>Informations techniques</summary><pre className="pre">{Object.entries(t.diagnostic).map(([k, v]) => `${k} : ${v}`).join('\n')}</pre></details>}
        {msgs.loading ? <Loading /> : msgs.data?.map((m) => <blockquote key={m.id} className="pre" style={m.internal ? { borderColor: 'var(--warn)' } : undefined}><strong>{m.is_staff ? `${m.author_handle ?? 'Équipe'}${m.internal ? ' (note interne)' : ''}` : t.user_handle}</strong> <span className="muted">· {timeAgo(m.created_at)}</span><br />{m.body}</blockquote>)}
        <Field label="Réponse" id="s-reply"><textarea id="s-reply" rows={4} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />Note interne (invisible du membre)</label>
        {act.error && <Alert kind="error">{act.error}</Alert>}
        <div className="row">
          <Button busy={act.busy} disabled={!reply.trim()} onClick={() => run(() => db().rpc('staff_reply_ticket', { p_ticket: t.id, p_body: reply.trim(), p_internal: internal })).then(() => setReply(''))}>{internal ? 'Ajouter la note' : 'Répondre'}</Button>
          {t.status !== 'resolved' && <Button variant="ghost" onClick={() => run(() => db().rpc('staff_set_ticket_status', { p_ticket: t.id, p_status: 'resolved' })).then(back)}>Marquer résolu</Button>}
          {t.status === 'resolved' && <Button variant="ghost" onClick={() => run(() => db().rpc('staff_set_ticket_status', { p_ticket: t.id, p_status: 'open' })).then(back)}>Rouvrir</Button>}
          <Button variant="danger" onClick={() => { if (confirm('Fermer définitivement ce ticket ?')) void run(() => db().rpc('staff_set_ticket_status', { p_ticket: t.id, p_status: 'closed' })).then(back); }}>Fermer</Button>
        </div>
      </Card>
    </div>
  );
}
