import { db } from '../lib/supabase';
import { timeAgo } from '../lib/format';
import { Button, Card, Loading, useAsync } from '../components/ui';

const TEXT: Record<string, string> = {
  reaction: 'Quelqu\'un a réagi à ta publication.', comment: 'Nouveau commentaire sur ta publication.', reply: 'On a répondu à ton commentaire.',
  moderation: 'L\'équipe de modération a pris une décision concernant ton compte ou un contenu. Consulte tes réglages pour les détails.',
  report_result: 'Un signalement que tu as fait a été traité.', reminder: 'Rappel : ton bilan t\'attend.', chronicle: 'Ta chronique de minuit est prête.', goal_due: 'Un de tes objectifs arrive à échéance.',
};

export function Notifications() {
  const { data, loading, reload } = useAsync(async () => ((await db().from('notifications').select('id,kind,payload,created_at,read_at').order('created_at', { ascending: false }).limit(50)).data ?? []) as { id: string; kind: string; payload: { date?: string }; created_at: string; read_at: string | null }[], []);
  if (loading) return <Loading />;
  return (
    <Card title="Notifications" actions={<Button variant="ghost" onClick={async () => { await db().from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); reload(); }}>Tout marquer comme lu</Button>}>
      <p className="muted">Les notifications ne contiennent jamais tes scores, ton ressenti ni le contenu de tes chroniques.</p>
      {data?.length === 0 && <p className="muted">Rien de nouveau.</p>}
      <ul className="plain">{data?.map((n) => <li key={n.id} className={`item ${n.read_at ? '' : 'unread'}`}><span>{TEXT[n.kind] ?? 'Notification'} {n.payload?.date ? <span className="muted">({n.payload.date})</span> : null}</span><span className="muted">{timeAgo(n.created_at)}</span></li>)}</ul>
    </Card>
  );
}
