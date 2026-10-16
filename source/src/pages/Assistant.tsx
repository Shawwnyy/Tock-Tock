import { useState } from 'react';
import { callFunction, db } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, useAction, useAsync } from '../components/ui';
import type { HelpResource } from '../../supabase/functions/_shared/crisis.ts';

interface Msg { role: 'user' | 'assistant'; content: string; mode?: string; resources?: HelpResource[]; suggestions?: string[] }

export function Assistant() {
  const { me } = useAuth();
  const s = me!.settings!;
  const act = useAction();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [conv, setConv] = useState<string | null>(null);
  const past = useAsync(async () => s.chatbot_memory_enabled ? ((await db().from('chat_conversations').select('id,title,updated_at').order('updated_at', { ascending: false }).limit(10)).data ?? []) as { id: string; title: string }[] : [], [s.chatbot_memory_enabled]);

  async function send(message: string) {
    if (!message.trim()) return;
    setText('');
    const history = msgs.filter((m) => m.mode !== 'crisis').slice(-8).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: message }]);
    await act.run(async () => {
      const r = await callFunction<{ text?: string; mode?: string; resources?: HelpResource[]; suggestions?: string[]; conversationId?: string | null; message?: string }>('assistant', { message, history, conversationId: conv });
      if (!r.ok) throw new Error(r.data.message ?? 'L\'assistant est indisponible pour le moment.');
      if (r.data.conversationId) setConv(r.data.conversationId);
      setMsgs((m) => [...m, { role: 'assistant', content: r.data.text ?? '', mode: r.data.mode, resources: r.data.resources, suggestions: r.data.suggestions }]);
    });
  }

  async function open(id: string) {
    const { data } = await db().from('chat_messages').select('role,content,mode,crisis').eq('conversation_id', id).order('created_at');
    setMsgs((data ?? []) as Msg[]);
    setConv(id);
  }

  return (
    <div className="stack">
      <Card title="Tock Tock Assistant">
        <Alert kind="info">
          Je ne suis pas un professionnel de santé ni un service d'urgence. {s.ai_consent ? 'L\'IA est activée si le service est configuré ; sinon je réponds en mode guidé.' : 'L\'IA est désactivée dans tes réglages : je réponds en mode guidé (explications de l\'application).'} Ma mémoire est {s.chatbot_memory_enabled ? 'activée' : 'désactivée'} : {s.chatbot_memory_enabled ? 'cette conversation est enregistrée et tu peux l\'effacer.' : 'rien de cette conversation n\'est conservé.'}
        </Alert>
        <div className="chat" aria-live="polite">
          {msgs.length === 0 && <p className="muted">Pose-moi une question sur l'application, ou écris ce que tu ressens.</p>}
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              <p className="pre">{m.content}</p>
              {m.resources && (
                <ul className="help">{m.resources.map((r) => <li key={r.name}><strong>{r.name}</strong> — {/^https?:/.test(r.contact) ? <a href={r.contact} target="_blank" rel="noopener noreferrer">{r.contact}</a> : <a href={`tel:${r.contact.replace(/\s/g, '')}`}>{r.contact}</a>} <span className="muted">{r.note}</span></li>)}</ul>
              )}
              {m.suggestions && <div className="row">{m.suggestions.map((q) => <button key={q} className="pill" onClick={() => send(q)}>{q}</button>)}</div>}
            </div>
          ))}
        </div>
        {act.error && <Alert kind="error">{act.error}</Alert>}
        <form className="row" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <textarea aria-label="Ton message" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" busy={act.busy} disabled={!text.trim()}>Envoyer</Button>
        </form>
        <p className="muted">Données partagées avec moi : {[s.chatbot_access.checkins && 'bilans', s.chatbot_access.goals && 'objectifs', s.chatbot_access.chronicles && 'chroniques', s.chatbot_access.pain && 'douleur'].filter(Boolean).join(', ') || 'aucune'} (modifiable dans les réglages).</p>
      </Card>
      {s.chatbot_memory_enabled && (past.data?.length ?? 0) > 0 && (
        <Card title="Conversations enregistrées">
          <ul className="plain">{past.data!.map((c) => <li key={c.id} className="item"><button className="linklike" onClick={() => open(c.id)}>{c.title}</button><Button variant="ghost" onClick={async () => { if (confirm('Supprimer cette conversation ?')) { await db().from('chat_conversations').delete().eq('id', c.id); if (conv === c.id) { setMsgs([]); setConv(null); } past.reload(); } }}>Supprimer</Button></li>)}</ul>
        </Card>
      )}
    </div>
  );
}
