import { useEffect, useRef, useState } from 'react';
import { formatScore, periodGeneralAverage, buildDailySeries, addDays } from '../../supabase/functions/_shared/stats.ts';
import { HELP_RESOURCES, crisisMessage, detectCrisis, resourcesFor, type HelpResource } from '../../supabase/functions/_shared/crisis.ts';
import { formatDateFr } from '../../supabase/functions/_shared/chronicle.ts';
import { Alert, Button, Card, Field, Toggle } from '../components/ui';
import { MdLite } from '../components/MdLite';
import { BREATHING, GROUNDING, LIBRARY } from './data';
import { checkinsSorted, csvExport, downloadBlob, getState, hashPin, replaceAll, restoreDefaults, storageWorks, today, uid, update, useStore, type Store } from './store';
import { authServer } from './gotrue';
import { Exercises } from './exercises';
import { RULES_VERSION } from './rules';
import { downloadBackupPdf, mergeRestored, readBackup } from './backup';

// ---------------------------------------------------------------------------
// Objectifs
// ---------------------------------------------------------------------------
const STATUS: Record<string, string> = { todo: 'À faire', in_progress: 'En cours', paused: 'En pause', done: 'Terminé', archived: 'Archivé' };

export function Goals() {
  const s = useStore();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [steps, setSteps] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const t = today(s);
  const list = s.goals.filter((g) => showArchived || g.status !== 'archived');
  return (
    <div className="stack">
      <h1>Objectifs</h1>
      <Card title="Nouvel objectif">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; update((n) => { n.goals.unshift({ id: uid(), title: title.trim().slice(0, 120), status: 'todo', due_date: due || null, steps: [], created_at: new Date().toISOString() }); }); setTitle(''); setDue(''); }}>
          <label>Objectif<input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Marcher 10 minutes par jour" /></label>
          <label>Échéance (optionnel)<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <Button type="submit">Ajouter</Button>
        </form>
      </Card>
      {list.length === 0 && <Alert>Aucun objectif pour l'instant. Commence petit : une étape de quelques minutes suffit.</Alert>}
      {list.map((g) => {
        const done = g.steps.filter((x) => x.done).length;
        const pct = g.steps.length ? Math.round((done / g.steps.length) * 100) : null;
        return (
          <Card key={g.id} title={g.title} actions={<select aria-label="Statut" value={g.status} onChange={(e) => update((n) => { n.goals.find((x) => x.id === g.id)!.status = e.target.value as typeof g.status; })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}>
            {g.due_date && <p className="muted">Échéance : {formatDateFr(g.due_date)}{g.due_date < t && g.status !== 'done' ? ' (dépassée — aucun souci, tu peux la décaler)' : ''}</p>}
            {pct !== null && <p><progress max={100} value={pct} aria-label="Avancement" /> {pct}% ({done}/{g.steps.length} étapes)</p>}
            <ul className="plain">
              {g.steps.map((st) => (
                <li className="item" key={st.id}>
                  <label className="check"><input type="checkbox" checked={st.done} onChange={(e) => update((n) => { const x = n.goals.find((y) => y.id === g.id)!.steps.find((y) => y.id === st.id)!; x.done = e.target.checked; x.done_at = e.target.checked ? t : null; })} /><span className={st.done ? 'done' : ''}>{st.title}</span></label>
                  <button className="linklike" onClick={() => update((n) => { const gg = n.goals.find((y) => y.id === g.id)!; gg.steps = gg.steps.filter((y) => y.id !== st.id); })}>Retirer</button>
                </li>
              ))}
            </ul>
            <form className="row" onSubmit={(e) => { e.preventDefault(); const v = (steps[g.id] ?? '').trim(); if (!v) return; update((n) => { n.goals.find((y) => y.id === g.id)!.steps.push({ id: uid(), title: v.slice(0, 120), done: false, done_at: null }); }); setSteps((p) => ({ ...p, [g.id]: '' })); }}>
              <label>Nouvelle étape<input value={steps[g.id] ?? ''} maxLength={120} onChange={(e) => setSteps((p) => ({ ...p, [g.id]: e.target.value }))} /></label>
              <Button variant="ghost" type="submit">Ajouter l'étape</Button>
            </form>
            <Button variant="danger" onClick={() => { if (confirm('Supprimer cet objectif et ses étapes ?')) update((n) => { n.goals = n.goals.filter((x) => x.id !== g.id); }); }}>Supprimer l'objectif</Button>
          </Card>
        );
      })}
      <label className="check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Afficher les objectifs archivés</label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bien-être : respiration guidée, ancrage 5-4-3-2-1, victoires
// ---------------------------------------------------------------------------
function Breathing() {
  const [id, setId] = useState(BREATHING[0].id);
  const pat = BREATHING.find((b) => b.id === id)!;
  const [run, setRun] = useState<{ phase: number; left: number; cycles: number } | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);
  function start() {
    setRun({ phase: 0, left: pat.phases[0][1], cycles: 0 });
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      setRun((r) => {
        if (!r) return r;
        if (r.left > 1) return { ...r, left: r.left - 1 };
        const next = (r.phase + 1) % pat.phases.length;
        return { phase: next, left: pat.phases[next][1], cycles: next === 0 ? r.cycles + 1 : r.cycles };
      });
    }, 1000);
  }
  function stop() { if (timer.current) window.clearInterval(timer.current); timer.current = null; setRun(null); }
  const [label, secs] = run ? pat.phases[run.phase] : ['Prêt·e ?', 0];
  const grow = run && (label === 'Inspire' || label === 'Retiens');
  return (
    <Card title="Respiration guidée">
      <div className="row"><label>Rythme<select value={id} disabled={!!run} onChange={(e) => setId(e.target.value)}>{BREATHING.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
      <p className="muted">{pat.note} Suggestion : {pat.minutes} minutes. Installe-toi confortablement et arrête-toi si tu ne te sens pas bien.</p>
      <div className="breath-wrap">
        <div className={`breath${grow ? ' grow' : ''}`} style={{ transitionDuration: `${secs || 1}s` }} aria-hidden="true" />
        <div className="breath-label" role="status" aria-live="polite">{label}{run ? ` · ${run.left}` : ''}</div>
      </div>
      {run && <p className="muted">Cycles terminés : {run.cycles}</p>}
      {run ? <Button variant="ghost" onClick={stop}>Arrêter</Button> : <Button onClick={start}>Commencer</Button>}
    </Card>
  );
}

function Grounding() {
  const [i, setI] = useState(-1);
  return (
    <Card title="Ancrage 5-4-3-2-1">
      <p className="muted">Un exercice simple pour revenir au moment présent quand tout s'accélère.</p>
      {i < 0 ? <Button onClick={() => setI(0)}>Commencer</Button> : i >= GROUNDING.length ? (
        <><Alert kind="success">Bien joué. Prends une respiration lente. Tu peux recommencer quand tu veux.</Alert><Button variant="ghost" onClick={() => setI(-1)}>Recommencer</Button></>
      ) : (
        <>
          <p className="big">{GROUNDING[i].n}</p>
          <p><strong>Nomme {GROUNDING[i].n} {GROUNDING[i].sense}.</strong></p>
          <p className="muted">{GROUNDING[i].hint}</p>
          <Button onClick={() => setI(i + 1)}>{i === GROUNDING.length - 1 ? 'Terminer' : 'Suivant'}</Button>
        </>
      )}
    </Card>
  );
}

function Victories() {
  const s = useStore();
  const [text, setText] = useState('');
  const t = today(s);
  const list = [...s.victories].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 60);
  return (
    <Card title="Petites victoires et gratitude">
      <p className="muted">Une chose qui s'est bien passée, même minuscule. Elles te serviront les jours moins faciles.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; update((n) => { n.victories.unshift({ id: uid(), date: t, text: text.trim().slice(0, 300) }); }); setText(''); }}>
        <label>Aujourd'hui, je suis content·e de…<input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} /></label>
        <Button type="submit">Ajouter</Button>
      </form>
      {list.length === 0 ? <p className="muted">Rien pour l'instant.</p> : (
        <ul className="plain">{list.map((v) => <li className="item" key={v.id}><span>{v.text} <small className="muted">· {formatDateFr(v.date)}</small></span><button className="linklike" onClick={() => update((n) => { n.victories = n.victories.filter((x) => x.id !== v.id); })}>Supprimer</button></li>)}</ul>
      )}
      {list.length > 2 && <Button variant="ghost" onClick={() => { const r = list[Math.floor(Math.random() * list.length)]; alert(`✨ ${r.text}\n(${formatDateFr(r.date)})`); }}>Me rappeler une victoire</Button>}
    </Card>
  );
}

export function Wellbeing() {
  return <div className="stack"><h1>Bien-être</h1><Breathing /><Grounding /><Exercises /><Victories /></div>;
}

// ---------------------------------------------------------------------------
// Aide (ressources d'écoute) et assistant guidé (sans IA, sans réseau)
// ---------------------------------------------------------------------------
export function ResourceList({ items }: { items: HelpResource[] }) {
  return <ul className="help">{items.map((r) => <li key={r.name}><strong>{r.name}</strong> — {r.contact}. <span className="muted">{r.note}</span></li>)}</ul>;
}

export function Help() {
  const s = useStore();
  return (
    <div className="stack">
      <h1>Aide et écoute</h1>
      <Alert kind="warn">En danger immédiat : appelle les urgences de ton pays (112 en Europe). Tock Tock n'est ni un service d'urgence ni un dispositif médical.</Alert>
      <Card title="Pays"><Field label="Ton pays" id="country"><select id="country" value={s.settings.country} onChange={(e) => update((n) => { n.settings.country = e.target.value; })}>{Object.keys(HELP_RESOURCES).map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
        <ResourceList items={resourcesFor(s.settings.country)} />
      </Card>
    </div>
  );
}

interface Msg { who: 'bot' | 'me'; text: string; resources?: HelpResource[] }

function weekSummary(s: Store): string {
  const t = today(s);
  const series = buildDailySeries(checkinsSorted(s), addDays(t, -6), t);
  const avg = periodGeneralAverage(series);
  if (avg.days === 0) return 'Je n\'ai aucun bilan sur les 7 derniers jours : rien à résumer pour l\'instant, et ce n\'est pas grave.';
  const withData = series.filter((p) => p.general !== null);
  const best = withData.reduce((a, b) => ((a.general as number) >= (b.general as number) ? a : b));
  return `Sur les 7 derniers jours : ${avg.days} bilan${avg.days > 1 ? 's' : ''}, moyenne générale **${formatScore(avg.value)}/10**. Meilleur jour : ${formatDateFr(best.date)} (${formatScore(best.general)}). Les jours sans bilan ne sont pas comptés comme des zéros.`;
}

const TIPS: Record<string, string> = {
  sommeil: 'Quelques repères généraux pour le sommeil : des horaires réguliers, moins d\'écrans dans l\'heure avant le coucher, une chambre fraîche et sombre. Si ça dure, parles-en à un médecin. (Voir aussi la bibliothèque.)',
  moyenne: 'Chaque réponse est ramenée sur 10. Les questions vides ne comptent pas (jamais zéro). La moyenne générale est la moyenne des catégories qui ont des données. La douleur, les textes et les oui/non sont exclus.',
  respir: 'Va dans **Bien-être** : trois rythmes de respiration guidée et un exercice d\'ancrage 5-4-3-2-1.',
  objectif: 'Découpe ton objectif en étapes de quelques minutes, et formule la prochaine comme une action précise. Tu peux les cocher dans **Objectifs**.',
  stress: 'Essaie une respiration lente (expire plus longtemps que tu n\'inspires) ou l\'ancrage 5-4-3-2-1, dans **Bien-être**. Si le stress est constant, un professionnel peut vraiment aider.',
};

export function Assistant() {
  const s = useStore();
  const [msgs, setMsgs] = useState<Msg[]>([{ who: 'bot', text: 'Bonjour ! Je suis l\'assistant guidé de Tock Tock : pas d\'IA, pas de réseau, tout reste sur ton appareil. Je peux résumer ta semaine, expliquer les moyennes, ou te guider vers un exercice. Je ne remplace pas un professionnel.' }]);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [msgs]);
  function ask(q: string) {
    const level = detectCrisis(q);
    const out: Msg[] = [{ who: 'me', text: q }];
    if (level !== 'none') { const c = crisisMessage(level, s.settings.country); out.push({ who: 'bot', text: c.text, resources: c.resources }); }
    else {
      const n = q.toLowerCase();
      let a = 'Je n\'ai pas de réponse automatique à ça. Essaie : « résumé de ma semaine », « comment est calculée ma moyenne », « mieux dormir », « respirer », « objectif ».';
      if (/semaine|r[ée]sum|bilan/.test(n)) a = weekSummary(s);
      else if (/moyenne|calcul/.test(n)) a = TIPS.moyenne;
      else if (/dorm|sommeil/.test(n)) a = TIPS.sommeil;
      else if (/respir|calme|souffl/.test(n)) a = TIPS.respir;
      else if (/stress|anxi|angoiss/.test(n)) a = TIPS.stress;
      else if (/objectif|projet|motiv/.test(n)) a = TIPS.objectif;
      out.push({ who: 'bot', text: a });
    }
    setMsgs((p) => [...p, ...out]);
  }
  return (
    <div className="stack">
      <h1>Assistant</h1>
      <div className="row">{['Résumé de ma semaine', 'Comment est calculée ma moyenne ?', 'Mieux dormir', 'Me détendre', 'Un objectif pour avancer'].map((q) => <button key={q} className="pill" onClick={() => ask(q)}>{q}</button>)}</div>
      <div className="chat" role="log" aria-live="polite">
        {msgs.map((m, i) => <div key={i} className={`bubble ${m.who === 'me' ? 'user' : ''}`}><MdLite text={m.text} />{m.resources && <ResourceList items={m.resources} />}</div>)}
        <div ref={end} />
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { ask(text.trim().slice(0, 500)); setText(''); } }}>
        <label>Ton message<input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} /></label>
        <Button type="submit">Envoyer</Button>
      </form>
      <p className="muted">Si tu écris quelque chose qui évoque une détresse, je te montre aussitôt des ressources d'aide humaines.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bibliothèque
// ---------------------------------------------------------------------------
export function Library() {
  const s = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const a = LIBRARY.find((x) => x.id === open);
  return (
    <div className="stack">
      <h1>Bibliothèque</h1>
      {a ? (
        <Card title={a.title} actions={<Button variant="ghost" onClick={() => setOpen(null)}>Retour</Button>}>
          <MdLite text={a.body} />
          {a.id === 'aide' && <ResourceList items={resourcesFor(s.settings.country)} />}
          <Button variant="ghost" disabled={s.read.includes(a.id)} onClick={() => update((n) => { if (!n.read.includes(a.id)) n.read.push(a.id); })}>{s.read.includes(a.id) ? 'Lu ✓' : 'Marquer comme lu'}</Button>
        </Card>
      ) : (
        <div className="grid">{LIBRARY.map((x) => <button key={x.id} className="tile" style={{ font: 'inherit', textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(x.id)}><span className="muted">{x.tag}</span><strong>{x.title}</strong>{s.read.includes(x.id) && <span className="muted">Lu ✓</span>}</button>)}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------
export function SettingsPage() {
  const s = useStore();
  const set = (patch: Partial<Store['settings']>) => update((n) => { Object.assign(n.settings, patch); });
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warn'; text: string } | null>(null);
  const [nName, setNName] = useState('');
  const [nCat, setNCat] = useState('');
  const [nType, setNType] = useState('scale10');
  const [nChoices, setNChoices] = useState('');
  const [nAvg, setNAvg] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const cats = s.categories.slice().sort((a, b) => a.sort_order - b.sort_order);

  function addIndicator() {
    const name = nName.trim();
    if (!name) return;
    const catId = nCat || cats[0]?.id;
    if (!catId) return;
    const labels = nChoices.split(',').map((x) => x.trim()).filter(Boolean);
    if (nType === 'choice' && labels.length < 2) { setMsg({ kind: 'error', text: 'Indique au moins 2 choix séparés par des virgules.' }); return; }
    update((n) => {
      const order = Math.max(0, ...n.indicators.map((i) => i.sort_order)) + 1;
      n.indicators.push({
        id: uid(), category_id: catId, name: name.slice(0, 80), description: '', template_key: null, active: true, sort_order: order,
        response_type: nType === 'text' ? 'text' : nType === 'boolean' ? 'boolean' : nType === 'choice' ? 'choice' : 'scale',
        scale_min: nType === 'scale5' ? 1 : nType === 'scale10' ? 0 : null, scale_max: nType === 'scale5' ? 5 : nType === 'scale10' ? 10 : null,
        choices: nType === 'choice' ? labels.map((label, i) => ({ label, score: nAvg ? Math.round((i * 10) / (labels.length - 1)) : null })) : null,
        include_in_average: nAvg && (nType === 'scale5' || nType === 'scale10' || nType === 'choice'),
      });
    });
    setNName(''); setNChoices(''); setMsg({ kind: 'success', text: 'Indicateur ajouté. Il apparaîtra dans ton prochain bilan ; les anciens bilans ne changent pas.' });
  }

  async function savePin() {
    if (!/^\d{4,8}$/.test(pin)) { setMsg({ kind: 'error', text: 'Le code doit contenir 4 à 8 chiffres.' }); return; }
    const salt = uid();
    const h = await hashPin(pin, salt);
    set({ pinHash: h, pinSalt: salt }); setPin('');
    setMsg({ kind: 'success', text: 'Code enregistré. Il masque l\'application à l\'ouverture ; il ne chiffre pas tes données.' });
  }

  async function restore(file: File) {
    try {
      const restored = mergeRestored(await readBackup(new Uint8Array(await file.arrayBuffer())), getState());
      const n = Object.keys(restored.checkins).length;
      if (!confirm(`Remplacer TOUTES les données actuelles par cette sauvegarde (${n} bilan${n > 1 ? 's' : ''}) ?`)) return;
      replaceAll(restored);
      setMsg({ kind: 'success', text: `Sauvegarde restaurée : ${n} bilan${n > 1 ? 's' : ''}, ${restored.goals.length} objectif${restored.goals.length > 1 ? 's' : ''}.` });
    } catch { setMsg({ kind: 'error', text: 'Ce fichier n\'est pas une sauvegarde Tock Tock valide. Il faut le PDF d\'origine (non imprimé, non retouché).' }); }
  }

  return (
    <div className="stack">
      <h1>Réglages</h1>
      {!storageWorks() && <Alert kind="warn">Le stockage du navigateur est indisponible (navigation privée ou bloqué) : tes données ne seront pas conservées après fermeture. Fais une sauvegarde.</Alert>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card title="Profil et apparence">
        <Field label="Prénom ou pseudonyme" id="nm"><input id="nm" value={s.settings.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Thème" id="th"><select id="th" value={s.settings.theme} onChange={(e) => set({ theme: e.target.value as Store['settings']['theme'] })}><option value="auto">Automatique</option><option value="light">Clair</option><option value="dark">Sombre</option></select></Field>
        <Field label="Pays (ressources d'aide)" id="ct"><select id="ct" value={s.settings.country} onChange={(e) => set({ country: e.target.value })}>{Object.keys(HELP_RESOURCES).map((c) => <option key={c}>{c}</option>)}</select></Field>
      </Card>
      <Card title="Chroniques">
        <Toggle id="ca" label="Générer automatiquement les chroniques des jours passés" hint="À l'ouverture de l'application, pour les bilans des 14 derniers jours qui n'en ont pas." checked={s.settings.chronicle_auto} onChange={(v) => set({ chronicle_auto: v })} />
        <Toggle id="cn" label="Inclure mes notes" checked={s.settings.includeNotes} onChange={(v) => set({ includeNotes: v })} />
        <Toggle id="cg" label="Inclure mes objectifs" checked={s.settings.includeGoals} onChange={(v) => set({ includeGoals: v })} />
        <Toggle id="ch" label="Comparer avec mon historique" checked={s.settings.includeHistory} onChange={(v) => set({ includeHistory: v })} />
        <Toggle id="cp" label="Inclure la douleur dans la chronique" hint="Désactivé par défaut." checked={s.settings.includePain} onChange={(v) => set({ includePain: v })} />
        <Toggle id="cd" label="Inclure les éléments sensibles dans le PDF" hint="Douleur et notes personnelles : désactivé par défaut." checked={s.settings.pdfSensitive} onChange={(v) => set({ pdfSensitive: v })} />
      </Card>
      <Card title="Mes indicateurs">
        {cats.map((c) => (
          <div key={c.id}>
            <h4>{c.name}</h4>
            <ul className="plain">{s.indicators.filter((i) => i.category_id === c.id).sort((a, b) => a.sort_order - b.sort_order).map((i) => (
              <li className="item" key={i.id}>
                <span className={i.active ? '' : 'off'}>{i.name}{i.template_key ? '' : ' (perso)'}</span>
                <span className="inline">
                  <label className="check"><input type="checkbox" checked={i.active} onChange={(e) => update((n) => { n.indicators.find((x) => x.id === i.id)!.active = e.target.checked; })} />Actif</label>
                  {(i.response_type === 'scale' || i.response_type === 'choice') && <label className="check"><input type="checkbox" checked={i.include_in_average} onChange={(e) => update((n) => { n.indicators.find((x) => x.id === i.id)!.include_in_average = e.target.checked; })} />Dans la moyenne</label>}
                  {!i.template_key && <button className="linklike" onClick={() => { if (confirm(`Supprimer « ${i.name} » ? Les anciens bilans gardent leurs réponses.`)) update((n) => { n.indicators = n.indicators.filter((x) => x.id !== i.id); }); }}>Supprimer</button>}
                </span>
              </li>
            ))}</ul>
          </div>
        ))}
        <h4>Ajouter un indicateur</h4>
        <div className="row">
          <label>Nom<input value={nName} maxLength={80} onChange={(e) => setNName(e.target.value)} /></label>
          <label>Catégorie<select value={nCat} onChange={(e) => setNCat(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Type<select value={nType} onChange={(e) => setNType(e.target.value)}><option value="scale10">Échelle 0 à 10</option><option value="scale5">Échelle 1 à 5</option><option value="boolean">Oui / non</option><option value="choice">Choix</option><option value="text">Texte libre</option></select></label>
        </div>
        {nType === 'choice' && <Field label="Choix (séparés par des virgules, du plus bas au plus haut)" id="chs"><input id="chs" value={nChoices} onChange={(e) => setNChoices(e.target.value)} placeholder="Mal, Moyen, Bien" /></Field>}
        {(nType === 'scale10' || nType === 'scale5' || nType === 'choice') && <label className="check"><input type="checkbox" checked={nAvg} onChange={(e) => setNAvg(e.target.checked)} />Compter dans la moyenne</label>}
        <div className="row"><Button onClick={addIndicator}>Ajouter</Button><Button variant="ghost" onClick={() => { update((n) => restoreDefaults(n)); setMsg({ kind: 'success', text: 'Indicateurs par défaut rétablis (rien n\'est écrasé).' }); }}>Rétablir les indicateurs par défaut</Button></div>
      </Card>
      <Card title="Code PIN (optionnel)">
        <p className="muted">Masque l'application à l'ouverture, pour un regard de passage. Ce n'est <strong>pas</strong> un chiffrement : quelqu'un qui peut ouvrir les outils du navigateur peut lire les données.</p>
        {s.settings.pinHash ? <Button variant="danger" onClick={() => { set({ pinHash: null, pinSalt: null }); setMsg({ kind: 'success', text: 'Code retiré.' }); }}>Retirer le code</Button> : (
          <div className="row"><label>Nouveau code (4 à 8 chiffres)<input inputMode="numeric" type="password" autoComplete="off" value={pin} maxLength={8} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></label><Button onClick={savePin}>Enregistrer le code</Button></div>
        )}
      </Card>
      <Card title="Sauvegarde et export">
        <p className="muted">Tes données vivent uniquement dans ce navigateur : si tu vides ses données, tout disparaît. La <strong>sauvegarde PDF</strong> est lisible dans n'importe quel lecteur et contient aussi tes données exactes pour la restauration.</p>
        <p className="muted">Dernière sauvegarde : {s.settings.lastBackupAt ? new Date(s.settings.lastBackupAt).toLocaleString('fr-FR') : 'jamais'}. Le PDF contient TOUTES tes données (douleur et notes comprises) : garde-le comme un document privé. Le code PIN n'y figure pas.</p>
        <div className="row">
          <Button onClick={() => { void downloadBackupPdf().then(() => setMsg({ kind: 'success', text: 'Sauvegarde PDF téléchargée. Range-la dans un endroit sûr.' })); }}>Télécharger une sauvegarde (PDF)</Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>Restaurer une sauvegarde…</Button>
          <Button variant="ghost" onClick={() => downloadBlob(`tock-tock-reponses-${today(s)}.csv`, csvExport(s), 'text/csv;charset=utf-8')}>Exporter mes réponses (.csv)</Button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf,application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f); e.target.value = ''; }} />
        </div>
      </Card>
      <Card title="Compte">
        <p className="muted">{s.settings.account ? `Identifiant confirmé : ${s.settings.account.masked}.` : 'Aucun compte : tes données restent sur cet appareil.'}</p>
        <a className="btn btn-ghost" href="#/compte">{s.settings.account ? 'Voir mon compte' : 'Se connecter ou créer un compte'}</a>
      </Card>
      <Card title="Règles d'utilisation">
        <p className="muted">Règles acceptées : version {s.settings.rules_accepted_version ?? '—'} (version actuelle {RULES_VERSION}).</p>
        <a className="btn btn-ghost" href="#/regles">Lire les règles expliquées</a>
      </Card>
      <div className="danger-zone">
        <h3>Zone sensible</h3>
        <p>Efface définitivement toutes les données de Tock Tock sur cet appareil.</p>
        <Button variant="danger" onClick={() => { if (prompt('Pour confirmer, tape SUPPRIMER') === 'SUPPRIMER') { try { localStorage.removeItem('tocktock.v1'); } catch { /* ignore */ } window.location.reload(); } }}>Tout supprimer</Button>
      </div>
    </div>
  );
}

export function About() {
  return (
    <div className="stack">
      <h1>À propos de Tock Tock</h1>
      <Card title="Ce que fait cette version">
        <ul className="help">
          <li>Bilan quotidien privé (20 indicateurs par défaut, douleur séparée, indicateurs personnalisés), moyennes exactes (vide ≠ 0).</li>
          <li>Historique : courbes avec trous, calendrier, observations prudentes, chroniques de minuit sans IA, export PDF.</li>
          <li>Objectifs et étapes, respiration guidée, ancrage, petites victoires, assistant guidé, bibliothèque, aide et écoute.</li>
          <li>Sauvegarde / restauration JSON, export CSV, code PIN, thème clair/sombre.</li>
        </ul>
      </Card>
      <Card title="Ce qui est volontairement absent ici">
        <p>Les fonctions qui exigent un serveur — comptes avec code par e-mail, communauté et modération, partage de fichiers, envoi d'e-mails, chronique par IA — se trouvent dans le dossier <code>source</code> (version Supabase). {authServer ? 'Cette page ne contacte un serveur que pour la connexion par code (identifiant et code) : tes bilans ne quittent jamais ton appareil.' : 'Cette page, elle, ne se connecte à rien : aucune donnée ne quitte ton appareil.'}</p>
      </Card>
      <Card title="Important"><p>Tock Tock est un outil de suivi personnel, pas un dispositif médical. Il ne pose aucun diagnostic et ne remplace pas un professionnel de santé.</p></Card>
    </div>
  );
}
