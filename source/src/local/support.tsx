// Centre d'aide : écoute (urgence), FAQ, tickets (enregistrés sur l'appareil, exportables), diagnostic sans données personnelles.
import { useEffect, useMemo, useState } from 'react';
import { crisisMessage, detectCrisis, resourcesFor, HELP_RESOURCES } from '../../supabase/functions/_shared/crisis.ts';
import { formatDateFr } from '../../supabase/functions/_shared/chronicle.ts';
import { Alert, Button, Card, Field } from '../components/ui';
import { PdfWriter } from './pdfkit';
import { ResourceList } from './pagesB';
import { RULES_VERSION } from './rules';
import { downloadBlob, getState, storageWorks, uid, update, useStore, type Store, type Ticket } from './store';

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------
interface Faq { cat: string; q: string; a: string }
export const FAQ: Faq[] = [
  { cat: 'Utiliser', q: 'Comment est calculée ma moyenne ?', a: 'Chaque réponse est ramenée sur 10. La moyenne d\'une catégorie est la moyenne de ses réponses ; la moyenne générale est la moyenne des catégories qui ont des données. Les questions vides, la douleur, les textes et les oui/non ne sont jamais comptés. Détail dans « Règles ».' },
  { cat: 'Utiliser', q: 'Pourquoi vois-je « Moyenne indisponible » ?', a: 'Parce qu\'aucune réponse numérique n\'a été donnée ce jour-là. C\'est normal : Tock Tock préfère un blanc honnête à un zéro inventé.' },
  { cat: 'Utiliser', q: 'Puis-je modifier ou compléter un bilan passé ?', a: 'Oui. Dans « Aujourd\'hui », change le jour avec le sélecteur de date, ou ouvre Historique → Calendrier, choisis un jour puis « Modifier ».' },
  { cat: 'Utiliser', q: 'Comment ajouter, retirer ou renommer un indicateur ?', a: 'Dans Réglages → Mes indicateurs. Tu peux désactiver n\'importe quel indicateur (il disparaît des prochains bilans) et en ajouter. Les anciens bilans gardent leurs réponses d\'origine.' },
  { cat: 'Utiliser', q: 'À quoi sert le bilan rapide ?', a: 'Il n\'affiche que 5 questions clés (moral, énergie, sommeil, sérénité, satisfaction) plus tes indicateurs personnels, pour les jours chargés. Tu peux repasser en bilan complet à tout moment, sans rien perdre.' },
  { cat: 'Utiliser', q: 'Comment fonctionne la série de jours ?', a: 'Elle compte les jours consécutifs avec un bilan. Une pause remet la série en cours à zéro, mais la meilleure série et toutes tes données restent. Il n\'y a ni classement ni pénalité.' },
  { cat: 'Mes données', q: 'Où sont mes données ?', a: 'Uniquement dans le navigateur de cet appareil. Rien n\'est envoyé sur Internet. Un autre navigateur ou un autre appareil ne les voit pas.' },
  { cat: 'Mes données', q: 'Comment faire une sauvegarde ?', a: 'Réglages → « Télécharger une sauvegarde (PDF) ». Le PDF est lisible et contient aussi tes données exactes pour la restauration. Garde-le comme un document privé.' },
  { cat: 'Mes données', q: 'Comment restaurer ou changer d\'appareil ?', a: 'Sur le nouvel appareil, ouvre Tock Tock → Réglages → « Restaurer une sauvegarde » et choisis le PDF. Il doit être le fichier d\'origine (pas imprimé en PDF, pas retouché).' },
  { cat: 'Mes données', q: 'Mes données ont disparu, que faire ?', a: 'Vérifie que tu es dans le même navigateur et hors navigation privée, puis restaure ta dernière sauvegarde PDF. Vider les données du navigateur, ou un nettoyage automatique, efface tout : d\'où l\'importance des sauvegardes.' },
  { cat: 'Mes données', q: 'J\'ai oublié mon code PIN.', a: 'Le PIN n\'est pas récupérable. Si tu as une sauvegarde PDF : vide les données du site dans ton navigateur, rouvre Tock Tock et restaure. Sans sauvegarde, les données restent dans le navigateur mais ne sont plus accessibles par l\'application.' },
  { cat: 'Chroniques', q: 'Pourquoi n\'y a-t-il pas de chronique pour un jour ?', a: 'Soit il n\'y avait pas assez de données (aucune chronique n\'est inventée), soit le jour a plus de 14 jours, soit la génération automatique est désactivée dans Réglages. Tu peux la générer à la demande dans Historique → Chroniques.' },
  { cat: 'Chroniques', q: 'Le PDF d\'une chronique contient-il ma douleur ?', a: 'Pas par défaut : la douleur et les notes personnelles sont exclues, sauf si tu l\'actives dans Réglages → Chroniques.' },
  { cat: 'Aide', q: 'Je ne me sens pas bien. Que faire ?', a: 'Parle à une personne de confiance et utilise l\'onglet « Écoute » de cette page : il liste des services d\'écoute gratuits dans ton pays. En danger immédiat, appelle les urgences (112 en Europe).' },
  { cat: 'Aide', q: 'Mon ticket est-il envoyé automatiquement ?', a: 'Non, pas dans cette version : elle n\'envoie aucun ticket. Le ticket est enregistré sur ton appareil et tu l\'exportes (PDF, copie ou e-mail) pour le transmettre. Avec la version serveur, il arrive directement dans la file du support.' },
  { cat: 'Aide', q: 'Puis-je l\'utiliser sur téléphone et ordinateur ?', a: 'Oui, mais les données ne se synchronisent pas : chaque appareil a les siennes. Pour les transférer, fais une sauvegarde PDF puis restaure-la sur l\'autre appareil.' },
];

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function searchFaq(query: string, limit = 5): Faq[] {
  const tokens = norm(query).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  if (!tokens.length) return [];
  return FAQ.map((f) => { const hay = norm(`${f.q} ${f.a}`); const sc = tokens.reduce((n, t) => n + (hay.includes(t) ? (norm(f.q).includes(t) ? 2 : 1) : 0), 0); return { f, sc }; })
    .filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, limit).map((x) => x.f);
}

// ---------------------------------------------------------------------------
// Diagnostic (aucune donnée personnelle : seulement des nombres et des infos techniques)
// ---------------------------------------------------------------------------
export function diagnosticText(s: Store): string {
  const size = (() => { try { return Math.round(JSON.stringify(s).length / 1024); } catch { return -1; } })();
  return [
    `Tock Tock (version locale) - règles ${RULES_VERSION}`,
    `Navigateur : ${typeof navigator !== 'undefined' ? navigator.userAgent : 'inconnu'}`,
    `Fuseau : ${s.settings.timezone} - langue : ${typeof navigator !== 'undefined' ? navigator.language : '?'}`,
    `Écran : ${typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '?'}`,
    `Stockage du navigateur : ${storageWorks() ? 'fonctionne' : 'INDISPONIBLE'} - taille des données : ${size} Ko`,
    `Contenu (nombres seulement) : ${Object.keys(s.checkins).length} bilans, ${s.goals.length} objectifs, ${Object.keys(s.chronicles).length} chroniques, ${s.tickets.length} tickets`,
    `Dernière sauvegarde : ${s.settings.lastBackupAt ? new Date(s.settings.lastBackupAt).toLocaleDateString('fr-FR') : 'jamais'}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------
export const TICKET_CATEGORIES = ['Problème technique (bug)', 'Question sur l\'utilisation', 'Mes données / sauvegarde', 'Suggestion d\'amélioration', 'Signalement (version serveur)', 'Autre'];
const STATUS_LABEL: Record<Ticket['status'], string> = { open: 'À envoyer', sent: 'Envoyé', resolved: 'Résolu' };

export function newRef(now = new Date()): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `TT-${d}-${Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

export function ticketText(t: Ticket): string {
  const head = `Ticket ${t.ref}\nCatégorie : ${t.category}\nPriorité : ${t.priority === 'important' ? 'importante' : 'normale'}\nCréé le : ${new Date(t.created_at).toLocaleString('fr-FR')}\nSujet : ${t.subject}`;
  const msgs = t.messages.map((m) => `\n[${new Date(m.at).toLocaleString('fr-FR')}] ${m.who === 'me' ? 'Moi' : 'Support'} :\n${m.text}`).join('\n');
  return `${head}\n${msgs}${t.diagnostic ? `\n\n--- Informations techniques ---\n${t.diagnostic}` : ''}`;
}

export async function buildTicketPdf(t: Ticket): Promise<Uint8Array> {
  const w = await PdfWriter.create(`Ticket ${t.ref}`);
  w.heading(`Ticket ${t.ref}`, 18);
  w.para(`${t.category} - priorité ${t.priority === 'important' ? 'importante' : 'normale'} - statut : ${STATUS_LABEL[t.status]}`);
  w.para(`Créé le ${new Date(t.created_at).toLocaleString('fr-FR')}`, { size: 9, color: [0.4, 0.4, 0.45] });
  w.heading('Sujet', 12); w.para(t.subject, { bold: true });
  w.heading('Échanges', 12);
  for (const m of t.messages) { w.para(`${m.who === 'me' ? 'Moi' : 'Support'} - ${new Date(m.at).toLocaleString('fr-FR')}`, { size: 8.5, bold: true, color: [0.3, 0.3, 0.4] }); w.para(m.text, { indent: 8 }); }
  if (t.diagnostic) { w.heading('Informations techniques (aucun contenu de bilan)', 12); w.para(t.diagnostic, { size: 9 }); }
  return w.finish(`Tock Tock - ticket ${t.ref}`);
}

function useHashTab(): string | null {
  const read = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tab');
  const [t, setT] = useState<string | null>(read);
  useEffect(() => { const on = () => setT(read()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  return t;
}

function Faqs() {
  const [q, setQ] = useState('');
  const results = useMemo(() => (q.trim().length >= 3 ? searchFaq(q, 8) : FAQ), [q]);
  const cats = [...new Set(results.map((f) => f.cat))];
  return (
    <div className="stack">
      <Field label="Rechercher dans l'aide" id="faq-q"><input id="faq-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex. sauvegarde, moyenne, code PIN…" /></Field>
      {results.length === 0 && <Alert>Aucune réponse trouvée. Essaie d'autres mots, ou crée un ticket (onglet Tickets).</Alert>}
      {cats.map((c) => (
        <Card key={c} title={c}>
          {results.filter((f) => f.cat === c).map((f) => <details key={f.q} className="doc"><summary><strong>{f.q}</strong></summary><p>{f.a}</p></details>)}
        </Card>
      ))}
    </div>
  );
}

function NewTicket({ onDone }: { onDone: (id: string) => void }) {
  const s = useStore();
  const [category, setCategory] = useState(TICKET_CATEGORIES[1]);
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [priority, setPriority] = useState<Ticket['priority']>('normal');
  const [diag, setDiag] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const level = detectCrisis(`${subject} ${desc}`);
  const crisis = level !== 'none' ? crisisMessage(level, s.settings.country) : null;
  const sugg = searchFaq(subject, 3);
  function create() {
    if (subject.trim().length < 5) return setErr('Le sujet doit faire au moins 5 caractères.');
    if (desc.trim().length < 15) return setErr('Décris le problème en au moins 15 caractères : plus c\'est précis, plus c\'est facile à traiter.');
    if (s.tickets.length >= 200) return setErr('Tu as atteint 200 tickets : supprime les anciens (résolus) avant d\'en créer.');
    const id = uid(), at = new Date().toISOString();
    update((n) => { n.tickets.unshift({ id, ref: newRef(), category, subject: subject.trim().slice(0, 100), priority, status: 'open', created_at: at, updated_at: at, messages: [{ id: uid(), at, who: 'me', text: desc.trim().slice(0, 2000) }], diagnostic: diag ? diagnosticText(getState()) : null }); });
    onDone(id);
  }
  return (
    <Card title="Nouveau ticket">
      <Alert kind="warn">Un ticket n'est pas un service d'urgence. Si tu es en détresse ou en danger, utilise l'onglet « Écoute » ou appelle les urgences.</Alert>
      <Field label="Catégorie" id="t-cat"><select id="t-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{TICKET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Sujet (5 à 100 caractères)" id="t-sub"><input id="t-sub" maxLength={100} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      {sugg.length > 0 && <Alert>Ces réponses t'aident peut-être déjà : {sugg.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</Alert>}
      <Field label="Description (15 à 2000 caractères)" hint="Ce que tu faisais, ce que tu attendais, ce qui s'est passé. N'écris ni mot de passe, ni données de santé détaillées." id="t-desc"><textarea id="t-desc" rows={6} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <p className="muted">{desc.length}/2000</p>
      <Field label="Priorité" id="t-prio"><select id="t-prio" value={priority} onChange={(e) => setPriority(e.target.value as Ticket['priority'])}><option value="normal">Normale</option><option value="important">Importante (je suis bloqué·e)</option></select></Field>
      <label className="check"><input type="checkbox" checked={diag} onChange={(e) => setDiag(e.target.checked)} />Joindre des informations techniques (navigateur, version, nombres d'éléments — jamais le contenu de tes bilans)</label>
      {crisis && <Alert kind="warn"><p>{crisis.text}</p><ResourceList items={crisis.resources} /></Alert>}
      {err && <Alert kind="error">{err}</Alert>}
      <Button onClick={create}>Créer le ticket</Button>
    </Card>
  );
}

function TicketView({ id, back }: { id: string; back: () => void }) {
  const s = useStore();
  const t = s.tickets.find((x) => x.id === id);
  const [msg, setMsg] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  if (!t) return <Alert>Ticket introuvable. <button className="linklike" onClick={back}>Retour</button></Alert>;
  const email = s.settings.supportEmail.trim();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const mailto = valid ? `mailto:${email}?subject=${encodeURIComponent(`[${t.ref}] ${t.subject}`)}&body=${encodeURIComponent(ticketText(t).slice(0, 1800))}` : '';
  const set = (fn: (x: Ticket) => void) => update((n) => { const x = n.tickets.find((y) => y.id === id)!; fn(x); x.updated_at = new Date().toISOString(); });
  return (
    <div className="stack">
      <div className="row"><Button variant="ghost" onClick={back}>← Mes tickets</Button></div>
      <Card title={`${t.ref} — ${t.subject}`} actions={<span className="pill on" style={{ cursor: 'default' }}>{STATUS_LABEL[t.status]}</span>}>
        <p className="muted">{t.category} · priorité {t.priority === 'important' ? 'importante' : 'normale'} · créé le {formatDateFr(t.created_at.slice(0, 10))}</p>
        {t.messages.map((m) => <blockquote key={m.id} className="pre"><strong>{m.who === 'me' ? 'Moi' : 'Support'}</strong> <span className="muted">· {new Date(m.at).toLocaleString('fr-FR')}</span><br />{m.text}</blockquote>)}
        {t.diagnostic && <details className="doc"><summary>Informations techniques jointes</summary><pre className="pre">{t.diagnostic}</pre></details>}
        {t.status !== 'resolved' && (
          <div className="row">
            <label>Ajouter un message<input value={msg} maxLength={2000} onChange={(e) => setMsg(e.target.value)} /></label>
            <Button variant="ghost" disabled={!msg.trim()} onClick={() => { set((x) => x.messages.push({ id: uid(), at: new Date().toISOString(), who: 'me', text: msg.trim().slice(0, 2000) })); setMsg(''); }}>Ajouter ma précision</Button>
            <Button variant="ghost" disabled={!msg.trim()} onClick={() => { set((x) => x.messages.push({ id: uid(), at: new Date().toISOString(), who: 'support', text: msg.trim().slice(0, 2000) })); setMsg(''); }}>Coller une réponse reçue du support</Button>
          </div>
        )}
      </Card>
      <Card title="Transmettre ce ticket">
        <Alert>Cette version n'envoie aucun ticket : celui-ci n'est <strong>pas encore envoyé</strong>. Exporte-le puis transmets-le, et marque-le « envoyé » quand c'est fait.</Alert>
        <div className="row">
          <Button onClick={async () => { downloadBlob(`ticket-${t.ref}.pdf`, (await buildTicketPdf(t)) as BlobPart, 'application/pdf'); setInfo('PDF du ticket téléchargé.'); }}>Télécharger en PDF</Button>
          <Button variant="ghost" onClick={() => { navigator.clipboard?.writeText(ticketText(t)).then(() => setInfo('Ticket copié.'), () => setInfo('Copie impossible : sélectionne le texte à la main.')); }}>Copier le texte</Button>
          {valid ? <a className="btn btn-ghost" href={mailto}>Ouvrir mon e-mail</a> : null}
        </div>
        <Field label="Adresse e-mail du support (facultatif)" hint="Enregistrée dans Réglages. Sert uniquement à préparer un e-mail dans ton application de messagerie." id="t-mail">
          <input id="t-mail" type="email" value={s.settings.supportEmail} onChange={(e) => update((n) => { n.settings.supportEmail = e.target.value.slice(0, 120); })} placeholder="support@exemple.fr" />
        </Field>
        {info && <Alert kind="success">{info}</Alert>}
        <div className="row">
          {t.status === 'open' && <Button variant="ghost" onClick={() => set((x) => { x.status = 'sent'; })}>Marquer comme envoyé</Button>}
          {t.status !== 'resolved' ? <Button variant="ghost" onClick={() => set((x) => { x.status = 'resolved'; })}>Marquer comme résolu</Button> : <Button variant="ghost" onClick={() => set((x) => { x.status = 'open'; })}>Rouvrir</Button>}
          <Button variant="danger" onClick={() => { if (confirm('Supprimer ce ticket ?')) { update((n) => { n.tickets = n.tickets.filter((y) => y.id !== id); }); back(); } }}>Supprimer</Button>
        </div>
      </Card>
    </div>
  );
}

function Tickets() {
  const s = useStore();
  const [view, setView] = useState<'list' | 'new' | string>('list');
  const [filter, setFilter] = useState<'all' | Ticket['status']>('all');
  if (view === 'new') return <NewTicket onDone={(id) => setView(id)} />;
  if (view !== 'list') return <TicketView id={view} back={() => setView('list')} />;
  const list = s.tickets.filter((t) => filter === 'all' || t.status === filter);
  return (
    <div className="stack">
      <Alert>Les tickets sont enregistrés sur cet appareil. Pour une question simple, regarde d'abord la FAQ.</Alert>
      <div className="row"><Button onClick={() => setView('new')}>Nouveau ticket</Button>
        <label>Filtrer<select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">Tous</option><option value="open">À envoyer</option><option value="sent">Envoyés</option><option value="resolved">Résolus</option></select></label></div>
      {list.length === 0 ? <p className="muted">Aucun ticket.</p> : (
        <ul className="plain">{list.map((t) => <li className="item" key={t.id}><button className="linklike" onClick={() => setView(t.id)}>{t.ref} — {t.subject}</button><span className="muted">{STATUS_LABEL[t.status]} · {new Date(t.updated_at).toLocaleDateString('fr-FR')}</span></li>)}</ul>
      )}
    </div>
  );
}

function Diagnostic() {
  const s = useStore();
  const [est, setEst] = useState<{ usage?: number; quota?: number; persisted?: boolean | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const e = await navigator.storage?.estimate?.();
        const p = (await navigator.storage?.persisted?.()) ?? null;
        setEst({ usage: e?.usage, quota: e?.quota, persisted: p });
      } catch { setEst({ persisted: null }); }
    })();
  }, []);
  const rows: [string, string, boolean][] = [
    ['Stockage du navigateur', storageWorks() ? 'Fonctionne' : 'INDISPONIBLE (navigation privée ?)', storageWorks()],
    ['Stockage durable', est?.persisted === true ? 'Demandé et accordé' : est?.persisted === false ? 'Non garanti : le navigateur peut nettoyer si l\'espace manque' : 'Inconnu', est?.persisted === true],
    ['Espace utilisé / disponible', est?.usage !== undefined && est?.quota ? `${Math.round(est.usage / 1024)} Ko / ${Math.round(est.quota / 1048576)} Mo` : 'Inconnu', true],
    ['Dernière sauvegarde PDF', s.settings.lastBackupAt ? new Date(s.settings.lastBackupAt).toLocaleDateString('fr-FR') : 'Jamais', !!s.settings.lastBackupAt || Object.keys(s.checkins).length < 3],
    ['Règles acceptées', s.settings.rules_accepted_version === RULES_VERSION ? `Version ${RULES_VERSION} (à jour)` : 'À mettre à jour', s.settings.rules_accepted_version === RULES_VERSION],
  ];
  return (
    <Card title="Diagnostic">
      <p className="muted">Ces vérifications se font sur ton appareil et ne contiennent aucun contenu de bilan.</p>
      <ul className="plain">{rows.map(([k, v, ok]) => <li className="item" key={k}><span>{k}</span><span>{ok ? '✅' : '⚠️'} {v}</span></li>)}</ul>
      <div className="row">
        <Button variant="ghost" onClick={async () => { try { const ok = await navigator.storage?.persist?.(); setNote(ok ? 'Stockage durable accordé.' : 'Le navigateur n\'a pas accordé le stockage durable (souvent : il faut utiliser régulièrement le site).'); } catch { setNote('Demande impossible.'); } }}>Demander le stockage durable</Button>
        <Button variant="ghost" onClick={() => { navigator.clipboard?.writeText(diagnosticText(s)).then(() => setNote('Diagnostic copié.'), () => setNote('Copie impossible.')); }}>Copier le diagnostic</Button>
      </div>
      {note && <Alert>{note}</Alert>}
      <details className="doc"><summary>Voir le texte du diagnostic</summary><pre className="pre">{diagnosticText(s)}</pre></details>
    </Card>
  );
}

export function Support() {
  const s = useStore();
  const hashTab = useHashTab();
  const [tab, setTab] = useState<'ecoute' | 'faq' | 'tickets' | 'diagnostic'>('ecoute');
  useEffect(() => { if (hashTab === 'faq' || hashTab === 'tickets' || hashTab === 'diagnostic' || hashTab === 'ecoute') setTab(hashTab); }, [hashTab]);
  const tabs: ['ecoute' | 'faq' | 'tickets' | 'diagnostic', string][] = [['ecoute', 'Écoute (urgence)'], ['faq', 'FAQ'], ['tickets', `Tickets${s.tickets.filter((t) => t.status !== 'resolved').length ? ` (${s.tickets.filter((t) => t.status !== 'resolved').length})` : ''}`], ['diagnostic', 'Diagnostic']];
  return (
    <div className="stack">
      <h1>Aide</h1>
      <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'ecoute' && (
        <>
          <Alert kind="warn">En danger immédiat : appelle les urgences de ton pays (112 en Europe). Tock Tock n'est ni un service d'urgence ni un dispositif médical.</Alert>
          <Card title="Services d'écoute">
            <Field label="Ton pays" id="country"><select id="country" value={s.settings.country} onChange={(e) => update((n) => { n.settings.country = e.target.value; })}>{Object.keys(HELP_RESOURCES).map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
            <ResourceList items={resourcesFor(s.settings.country)} />
          </Card>
        </>
      )}
      {tab === 'faq' && <Faqs />}
      {tab === 'tickets' && <Tickets />}
      {tab === 'diagnostic' && <Diagnostic />}
    </div>
  );
}
