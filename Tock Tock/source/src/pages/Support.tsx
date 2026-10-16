// Aide (version serveur) : FAQ courte + tickets envoyés à l'équipe. Le membre ne voit que ses tickets et les réponses publiques.
import { useState } from 'react';
import { crisisMessage, countryFromTimezone, detectCrisis, resourcesFor, type HelpResource } from '../../supabase/functions/_shared/crisis.ts';
import { Alert, Button, Card, Field, Loading, useAction, useAsync } from '../components/ui';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { db, friendlyError } from '../lib/supabase';

export const CATEGORY_LABEL: Record<string, string> = { bug: 'Problème technique', usage: 'Question d\'utilisation', data: 'Mes données', suggestion: 'Suggestion', report: 'Signalement', other: 'Autre' };
export const STATUS_LABEL: Record<string, string> = { open: 'Ouvert', pending_member: 'En attente de ta réponse', resolved: 'Résolu', closed: 'Fermé' };

const FAQ: { q: string; a: string }[] = [
  { q: 'Comment est calculée ma moyenne ?', a: 'Chaque réponse est ramenée sur 10 ; la moyenne générale est la moyenne des catégories qui ont des données. Les questions vides, la douleur et les textes ne sont jamais comptés. Une question vide n\'est jamais un zéro.' },
  { q: 'Qui voit mes bilans ?', a: 'Toi seul·e, et ton assistant si tu l\'autorises. Les modérateurs et le support n\'ont aucun accès à tes bilans, objectifs, chroniques ou conversations.' },
  { q: 'Je n\'ai pas reçu mon code de connexion.', a: 'Vérifie tes courriers indésirables, attends une minute puis redemande un code. Si le problème continue, crée un ticket (catégorie « Problème technique »).' },
  { q: 'Comment signaler un contenu ou une personne ?', a: 'Depuis la publication ou le commentaire, bouton « Signaler ». Des humains examinent et tu seras informé·e du résultat.' },
  { q: 'Comment supprimer mon compte ?', a: 'Réglages → Zone sensible. Tes données privées sont supprimées ; certains journaux de modération sont conservés sans lien avec toi.' },
];

export function Support() {
  const [tab, setTab] = useState<'faq' | 'tickets'>('faq');
  return (
    <div className="stack">
      <h1>Aide</h1>
      <Alert kind="warn">Un ticket n'est pas un service d'urgence. En danger immédiat : 112 (Europe) · 3114 (France, prévention du suicide).</Alert>
      <div className="tabs" role="tablist">{([['faq', 'FAQ'], ['tickets', 'Mes tickets']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'faq' && <Card title="Questions fréquentes">{FAQ.map((f) => <details key={f.q} className="doc"><summary><strong>{f.q}</strong></summary><p>{f.a}</p></details>)}</Card>}
      {tab === 'tickets' && <Tickets />}
    </div>
  );
}

interface TicketRow { id: string; ref: string; category: string; subject: string; priority: string; status: string; created_at: string; updated_at: string }

function Tickets() {
  const [view, setView] = useState<'list' | 'new' | string>('list');
  const list = useAsync(async () => ((await db().from('support_tickets').select('id,ref,category,subject,priority,status,created_at,updated_at').order('updated_at', { ascending: false }).limit(50)).data ?? []) as TicketRow[], [view]);
  if (view === 'new') return <NewTicket onDone={(id) => setView(id)} onCancel={() => setView('list')} />;
  if (view !== 'list') return <TicketThread id={view} ticket={list.data?.find((t) => t.id === view) ?? null} back={() => setView('list')} />;
  if (list.loading) return <Loading />;
  return (
    <div className="stack">
      <Button onClick={() => setView('new')}>Nouveau ticket</Button>
      {list.data?.length === 0 && <p className="muted">Aucun ticket.</p>}
      <ul className="plain">{list.data?.map((t) => <li className="item" key={t.id}><button className="linklike" onClick={() => setView(t.id)}>{t.ref} — {t.subject}</button><span className="muted">{STATUS_LABEL[t.status] ?? t.status} · {timeAgo(t.updated_at)}</span></li>)}</ul>
    </div>
  );
}

function NewTicket({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const { me } = useAuth();
  const act = useAction();
  const [category, setCategory] = useState('usage');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('normal');
  const [diag, setDiag] = useState(true);
  const [help, setHelp] = useState<{ text: string; resources: HelpResource[] } | null>(null);
  const level = detectCrisis(`${subject} ${body}`);
  const crisis = level !== 'none' ? crisisMessage(level, countryFromTimezone(me!.settings?.timezone)) : null;
  async function create() {
    await act.run(async () => {
      if (subject.trim().length < 5) throw new Error('Le sujet doit faire au moins 5 caractères.');
      if (body.trim().length < 15) throw new Error('Décris le problème en au moins 15 caractères.');
      const diagnostic = diag ? { app: 'Tock Tock', browser: navigator.userAgent.slice(0, 160), language: navigator.language, timezone: me!.settings?.timezone ?? '', screen: `${window.innerWidth}x${window.innerHeight}` } : {};
      const { data, error } = await db().rpc('create_ticket', { p_category: category, p_subject: subject.trim(), p_body: body.trim(), p_priority: priority, p_diagnostic: diagnostic });
      if (error) throw new Error(friendlyError(error));
      const r = data as { id: string; needs_support: boolean };
      if (r.needs_support) { const c = crisisMessage('distress', countryFromTimezone(me!.settings?.timezone)); setHelp({ text: c.text, resources: resourcesFor(countryFromTimezone(me!.settings?.timezone)).slice(0, 3) }); }
      else onDone(r.id);
    });
  }
  return (
    <Card title="Nouveau ticket" actions={<Button variant="ghost" onClick={onCancel}>Annuler</Button>}>
      <Field label="Catégorie" id="t-cat"><select id="t-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Sujet (5 à 100 caractères)" id="t-sub"><input id="t-sub" maxLength={100} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="Description (15 à 2000 caractères)" hint="Ce que tu faisais, ce que tu attendais, ce qui s'est passé. N'écris ni mot de passe ni données de santé détaillées." id="t-body"><textarea id="t-body" rows={6} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <Field label="Priorité" id="t-prio"><select id="t-prio" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="normal">Normale</option><option value="important">Importante (je suis bloqué·e)</option></select></Field>
      <label className="check"><input type="checkbox" checked={diag} onChange={(e) => setDiag(e.target.checked)} />Joindre des informations techniques (navigateur, langue, fuseau, taille d'écran — jamais le contenu de tes bilans)</label>
      {crisis && !help && <Alert kind="warn"><p>{crisis.text}</p><ul className="help">{crisis.resources.map((r) => <li key={r.name}><strong>{r.name}</strong> — {r.contact}</li>)}</ul></Alert>}
      {help && <Alert kind="warn"><p>Ton ticket est bien envoyé et traité en priorité. En attendant :</p><p>{help.text}</p><ul className="help">{help.resources.map((r) => <li key={r.name}><strong>{r.name}</strong> — {r.contact}</li>)}</ul></Alert>}
      {act.error && <Alert kind="error">{act.error}</Alert>}
      <Button busy={act.busy} onClick={create}>Envoyer le ticket</Button>
    </Card>
  );
}

function TicketThread({ id, ticket, back }: { id: string; ticket: TicketRow | null; back: () => void }) {
  const act = useAction();
  const [msg, setMsg] = useState('');
  const msgs = useAsync(async () => ((await db().from('support_messages').select('id,is_staff,body,created_at').eq('ticket_id', id).order('created_at')).data ?? []) as { id: string; is_staff: boolean; body: string; created_at: string }[], [id]);
  const closed = ticket?.status === 'closed';
  return (
    <div className="stack">
      <Button variant="ghost" onClick={back}>← Mes tickets</Button>
      <Card title={ticket ? `${ticket.ref} — ${ticket.subject}` : 'Ticket'}>
        {ticket && <p className="muted">{CATEGORY_LABEL[ticket.category]} · {STATUS_LABEL[ticket.status] ?? ticket.status} · créé {timeAgo(ticket.created_at)}</p>}
        {msgs.loading ? <Loading /> : msgs.data?.map((m) => <blockquote key={m.id} className="pre"><strong>{m.is_staff ? 'Équipe Tock Tock' : 'Moi'}</strong> <span className="muted">· {timeAgo(m.created_at)}</span><br />{m.body}</blockquote>)}
        {!closed && (
          <>
            <Field label="Ajouter un message" id="t-msg"><textarea id="t-msg" rows={3} maxLength={2000} value={msg} onChange={(e) => setMsg(e.target.value)} /></Field>
            {act.error && <Alert kind="error">{act.error}</Alert>}
            <div className="row">
              <Button busy={act.busy} disabled={!msg.trim()} onClick={() => act.run(async () => { const { error } = await db().rpc('add_ticket_message', { p_ticket: id, p_body: msg.trim() }); if (error) throw new Error(friendlyError(error)); setMsg(''); msgs.reload(); })}>Envoyer</Button>
              <Button variant="ghost" onClick={() => { if (confirm('Fermer ce ticket ? Tu ne pourras plus y répondre.')) act.run(async () => { const { error } = await db().rpc('close_my_ticket', { p_ticket: id }); if (error) throw new Error(friendlyError(error)); back(); }); }}>Fermer le ticket</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
