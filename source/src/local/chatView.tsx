// Page « Discussion » : sans compte, avec ton nom# (ex. Léo#18428). On n'écrit qu'à quelqu'un dont on connaît le nom#.
import { useEffect, useRef, useState } from 'react';
import { crisisMessage, detectCrisis, type CrisisLevel } from '../../supabase/functions/_shared/crisis.ts';
import { formatScore } from '../../supabase/functions/_shared/stats.ts';
import { formatDateFr } from '../../supabase/functions/_shared/chronicle.ts';
import { Alert, Button, Card, Field } from '../components/ui';
import { blockContact, chatAvailable, claim, enableChat, pollOnce, refuseRequest, requestBilan, sendSnapshot, sendText, useChatStatus } from './chatApi';
import { MAX_TEXT, contactOf, myTag, parseTag } from './chat';
import { ResourceList } from './pagesB';
import { randomHandle, update, useStore, type ChatMsg, type Snapshot } from './store';

/** Relève le relais toutes les 3 s tant que la discussion est activée. */
export function ChatPoller() {
  const enabled = useStore().chat.enabled;
  useEffect(() => {
    if (!chatAvailable || !enabled) return;
    void pollOnce();
    const t = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) void pollOnce(); }, 3000);
    return () => clearInterval(t);
  }, [enabled]);
  return null;
}

function SnapshotView({ snap, who }: { snap: Snapshot; who: string }) {
  if (snap.empty) return <p><strong>{who}</strong> n'a pas encore fait de bilan aujourd'hui ({formatDateFr(snap.date)}).</p>;
  return (
    <div>
      <p><strong>Bilan de {who}</strong> · {formatDateFr(snap.date)}</p>
      <p>Moyenne générale : <strong>{snap.general === null ? 'indisponible' : `${formatScore(snap.general)}/10`}</strong></p>
      <ul className="plain">{snap.categories.map((c) => <li key={c.name}>{c.name} : {c.avg === null ? <span className="muted">pas de donnée</span> : `${formatScore(c.avg)}/10`}</li>)}</ul>
      {snap.pain && <p>Douleur : {snap.pain.score === null ? 'non renseignée' : `${snap.pain.score}/10`}{snap.pain.zone ? ` (${snap.pain.zone})` : ''}</p>}
      {snap.note && <p>Note : « {snap.note} »</p>}
    </div>
  );
}

function Activation() {
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card title="Activer la discussion">
      <p>La discussion n'a <strong>pas de compte</strong> : tu es reconnu par ton <strong>nom#numéro</strong> (par exemple <em>Léo#18428</em>) et par une clé secrète gardée sur cet appareil. Pour discuter, donne ton nom# à quelqu'un, ou demande le sien. Il n'y a ni annuaire, ni salon public.</p>
      <ul className="help">
        <li>Les messages ne sont <strong>pas chiffrés de bout en bout</strong> et ne sont gardés par le relais qu'en mémoire (24 h au plus, effacés dès réception).</li>
        <li>Tu peux <strong>bloquer</strong> quelqu'un à tout moment. Personne ne voit ton bilan sans ton accord à chaque fois (sauf « toujours autoriser », que tu peux retirer).</li>
        <li>Bienveillance exigée. Ce n'est <strong>pas un service d'urgence</strong> : si tu vas mal, l'onglet « Aide » liste des services d'écoute.</li>
      </ul>
      <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />J'ai 15 ans ou plus et j'accepte ces règles de discussion.</label>
      {err && <Alert kind="error">{err}</Alert>}
      <Button busy={busy} disabled={!ack} onClick={async () => { setBusy(true); const r = await enableChat(); setBusy(false); if (!r.ok) setErr(r.message ?? 'Échec.'); }}>Activer la discussion</Button>
    </Card>
  );
}

function RequestCard({ m, num, name }: { m: ChatMsg; num: string; name: string }) {
  const [pain, setPain] = useState(false);
  const [note, setNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (state: ChatMsg['state']) => update((n) => { const x = n.chat.threads[num]?.find((y) => y.id === m.id); if (x) x.state = state; });
  if (m.state === 'allowed') return <p className="muted">Tu as autorisé {name}#{num} à voir ton bilan du jour.</p>;
  if (m.state === 'refused') return <p className="muted">Tu as refusé la demande de {name}#{num}.</p>;
  return (
    <div>
      <p><strong>{name}#{num}</strong> demande à voir ton <strong>bilan du jour</strong> (moyennes par catégorie).</p>
      <label className="check"><input type="checkbox" checked={pain} onChange={(e) => setPain(e.target.checked)} />Inclure ma douleur</label>
      <label className="check"><input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} />Inclure ma note du jour</label>
      <div className="row">
        <Button busy={busy} onClick={async () => { setBusy(true); await sendSnapshot({ num, name }, { pain, note }); set('allowed'); setBusy(false); }}>Autoriser cette fois</Button>
        <Button variant="ghost" busy={busy} onClick={async () => { setBusy(true); await sendSnapshot({ num, name }, { pain: false, note: false }); update((n) => { contactOf(n, num, name).always_allow = true; }); set('allowed'); setBusy(false); }}>Toujours autoriser (moyennes seulement)</Button>
        <Button variant="ghost" busy={busy} onClick={async () => { setBusy(true); await refuseRequest({ num, name }); set('refused'); setBusy(false); }}>Refuser</Button>
      </div>
    </div>
  );
}

function Thread({ num }: { num: string }) {
  const s = useStore();
  const c = s.chat.contacts.find((x) => x.num === num);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisLevel>('none');
  const box = useRef<HTMLDivElement>(null);
  const msgs = s.chat.threads[num] ?? [];
  useEffect(() => { update((n) => { const x = n.chat.contacts.find((y) => y.num === num); if (x) x.unread = 0; }); }, [num, msgs.length]);
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, num]);
  if (!c) return null;
  const to = { num: c.num, name: c.name };
  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setErr(null);
    const lvl = detectCrisis(t);
    setCrisis(lvl);
    const r = await sendText(to, t);
    setBusy(false);
    if (r.ok) setText(''); else setErr(r.message ?? 'Échec.');
  }
  return (
    <Card title={`${c.name}#${c.num}`} actions={<span className="row">
      <Button variant="ghost" onClick={async () => { setErr(null); const r = await requestBilan(to); if (!r.ok) setErr(r.message ?? 'Échec.'); }}>Voir son bilan du jour</Button>
      <Button variant="ghost" onClick={() => { if (confirm(`Bloquer ${c.name}#${c.num} ? Vous ne recevrez plus ses messages.`)) void blockContact(c.num); }}>Bloquer</Button></span>}>
      {c.always_allow && <p className="muted">{c.name} peut voir tes moyennes du jour sans redemander. <button className="linklike" onClick={() => update((n) => { contactOf(n, num, c.name).always_allow = false; })}>Retirer cette autorisation</button></p>}
      <div className="bubbles" ref={box} aria-live="polite" aria-label={`Conversation avec ${c.name}`}>
        {msgs.length === 0 && <p className="muted">Aucun message. Écris le premier : sois bienveillant·e.</p>}
        {msgs.map((m) => m.t === 'msg' ? <div key={m.id} className={`bubble ${m.dir}`}>{m.text}<small>{new Date(m.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</small></div>
          : m.t === 'request' ? <div key={m.id} className="bubble sys"><RequestCard m={m} num={c.num} name={c.name} /></div>
          : m.t === 'snapshot' && m.payload ? <div key={m.id} className="bubble sys"><SnapshotView snap={m.payload} who={m.dir === 'in' ? `${c.name}` : 'toi (partagé)'} /></div>
          : <div key={m.id} className="bubble sys muted">{m.t === 'response' ? `${c.name} ${m.text}` : m.text}</div>)}
      </div>
      {crisis !== 'none' && (() => { const cm = crisisMessage(crisis, s.settings.country); return <Alert kind="warn"><p>{cm.text}</p><ResourceList items={cm.resources} /></Alert>; })()}
      {err && <Alert kind="error">{err}</Alert>}
      <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <Field id="msg" label="Ton message"><textarea id="msg" rows={2} maxLength={MAX_TEXT} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} /></Field>
        <Button type="submit" busy={busy} disabled={!text.trim()}>Envoyer</Button>
      </form>
    </Card>
  );
}

export function ChatPage() {
  const s = useStore();
  const st = useChatStatus();
  const [open, setOpen] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const tagOk = myTag(s);

  if (!chatAvailable) {
    return (
      <div className="stack"><h1>Discussion</h1>
        <Alert kind="warn"><strong>La discussion n'est pas disponible dans ce fichier hors ligne.</strong> Discuter avec d'autres personnes exige un petit serveur de relais. Il est fourni dans le dossier <code>discussion/</code> du zip : lance-le (voir <code>LISEZ-MOI.txt</code>) puis ouvre l'adresse affichée.</Alert>
        <Card title="Ton futur nom#"><p><strong className="handle">{tagOk}</strong></p><p className="muted">Quand la discussion sera disponible, c'est ce nom# que tu donneras pour qu'on t'écrive ou qu'on demande à voir ton bilan (avec ton accord à chaque fois).</p></Card>
      </div>
    );
  }
  if (!s.chat.enabled) return <div className="stack"><h1>Discussion</h1><Activation /></div>;

  const contacts = [...s.chat.contacts].filter((c) => !c.blocked).sort((a, b) => b.last_ts.localeCompare(a.last_ts));
  const blocked = s.chat.contacts.filter((c) => c.blocked);
  return (
    <div className="stack">
      <h1>Discussion</h1>
      <Card title="Mon nom#">
        <p><strong className="handle" id="mytag">{tagOk}</strong>{' '}
          <span className={`dot dot-${st}`} role="status">{st === 'online' ? 'en ligne' : st === 'offline' ? 'serveur injoignable' : st === 'error' ? 'erreur' : 'connexion…'}</span></p>
        <p className="muted">Donne ce nom# à la personne avec qui tu veux discuter. Elle pourra t'écrire et, si tu l'autorises, voir ton bilan du jour.</p>
        <div className="row">
          <Button variant="ghost" onClick={() => { void navigator.clipboard?.writeText(tagOk).then(() => setCopied(true)).catch(() => undefined); }}>{copied ? 'Copié ✓' : 'Copier mon nom#'}</Button>
          <Button variant="ghost" onClick={async () => { update((n) => { n.settings.handle = randomHandle(); }); await claim(); }}>Changer de numéro</Button>
          <Button variant="ghost" onClick={() => update((n) => { n.chat.enabled = false; })}>Désactiver la discussion</Button>
        </div>
      </Card>
      <div className="chat">
        <Card title="Conversations">
          <form onSubmit={(e) => { e.preventDefault(); const p = parseTag(tag); if (!p) { setErr('Écris le nom# complet de la personne, par exemple Marie#04211.'); return; } if (p.num === s.settings.handle) { setErr('C\'est ton propre nom#.'); return; } setErr(null); update((n) => { const c = contactOf(n, p.num, p.name); if (!(n.chat.threads[p.num] ?? []).some((m) => m.dir === 'in')) c.name = p.name; }); setOpen(p.num); setTag(''); }}>
            <Field id="tag" label="Nouvelle discussion"><input id="tag" placeholder="Marie#04211" value={tag} onChange={(e) => setTag(e.target.value)} autoComplete="off" /></Field>
            {err && <p className="hint field-problem" role="alert">{err}</p>}
            <Button type="submit" variant="ghost">Ouvrir</Button>
          </form>
          <ul className="plain convos">
            {contacts.map((c) => <li key={c.num}><button className={`convo ${open === c.num ? 'on' : ''}`} onClick={() => setOpen(c.num)}>{c.name}#{c.num}{c.unread > 0 && <span className="badge" aria-label={`${c.unread} non lus`}>{c.unread}</span>}</button></li>)}
            {contacts.length === 0 && <li className="muted">Aucune conversation.</li>}
          </ul>
          {blocked.length > 0 && <details className="doc"><summary>Bloqués ({blocked.length})</summary><p className="muted">Les personnes bloquées ne peuvent plus t'écrire.</p><ul className="plain">{blocked.map((c) => <li key={c.num}>{c.name}#{c.num}</li>)}</ul></details>}
        </Card>
        {open && s.chat.contacts.some((c) => c.num === open && !c.blocked) ? <Thread num={open} /> : <Card title="Choisis une conversation"><p className="muted">Ouvre une conversation à gauche, ou saisis le nom# d'une personne pour lui écrire.</p></Card>}
      </div>
    </div>
  );
}
