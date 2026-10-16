import { useEffect, useMemo, useState } from 'react';
import type { Answer, Chronicle } from '../../supabase/functions/_shared/types.ts';
import { addDays, aggregatePeriods, buildDailySeries, computeCheckinStats, explainAverage, formatScore, indicatorSeries, periodGeneralAverage, rangeFor, toEpochDay, type RangePreset } from '../../supabase/functions/_shared/stats.ts';
import { SECTION_LABELS, SECTION_ORDER, chronicleToText, formatDateFr } from '../../supabase/functions/_shared/chronicle.ts';
import { Alert, Button, Card, Field } from '../components/ui';
import { LineChart, seriesToPoints } from '../components/Chart';
import { MdLite } from '../components/MdLite';
import { BODY_ZONES, TAGS } from './data';
import { buildReportPdf } from './report';
import { LocalCheckin, activeIndicators, getState, checkinsSorted, computeInsights, downloadBlob, makeChronicle, snapshotOf, streaks, today, update, useStore, type Indicator, type Store } from './store';

// ---------------------------------------------------------------------------
// Paramètre « ?date= » dans le hash (le routeur ne lit que le chemin)
// ---------------------------------------------------------------------------
export function useHashDate(): string | null {
  const read = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('date');
  const [d, setD] = useState<string | null>(read);
  useEffect(() => { const on = () => setD(read()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

type Val = { num?: number | null; text?: string; choice?: string | null };
const QUICK_KEYS = ['mood', 'energy', 'sleep', 'serenity', 'satisfaction'];
/** Signature normalisée d'un formulaire de bilan : sert à savoir s'il a été modifié (pour le brouillon automatique). */
const formSig = (vals: Record<string, Val>, events: string, note: string, pain: number | null, zone: string, painNote: string, tags: string[]) =>
  JSON.stringify([Object.entries(vals).filter(([, v]) => v && ((v.num ?? null) !== null || (v.text ?? '').trim() || v.choice)).map(([k, v]) => [k, v.num ?? null, (v.text ?? '').trim(), v.choice ?? null]).sort((a, b) => (a[0] as string).localeCompare(b[0] as string)), events.trim(), note.trim(), pain, pain === null ? '' : zone, pain === null ? '' : painNote.trim(), [...tags].sort()]);

function valsFrom(c: LocalCheckin | undefined): Record<string, Val> {
  const out: Record<string, Val> = {};
  for (const a of c?.answers ?? []) {
    const id = a.snapshot.indicator_id;
    if (id) out[id] = { num: a.value_num, text: a.value_text ?? '', choice: a.value_choice };
  }
  return out;
}

function buildAnswers(s: Store, vals: Record<string, Val>, existing?: LocalCheckin): Answer[] {
  const out: Answer[] = [];
  const active = activeIndicators(s);
  const ids = new Set(active.map((i) => i.id));
  for (const ind of active) {
    const v = vals[ind.id];
    if (!v) continue;
    const a: Answer = { snapshot: snapshotOf(s, ind), value_num: null, value_text: null, value_choice: null };
    if (ind.response_type === 'scale' || ind.response_type === 'boolean') { if (v.num === null || v.num === undefined) continue; a.value_num = v.num; }
    else if (ind.response_type === 'text') { if (!v.text?.trim()) continue; a.value_text = v.text.trim(); }
    else { if (!v.choice) continue; a.value_choice = v.choice; }
    out.push(a);
  }
  // Les réponses d'indicateurs désactivés ou supprimés depuis sont conservées telles quelles (instantané d'origine).
  for (const a of existing?.answers ?? []) if (!a.snapshot.indicator_id || !ids.has(a.snapshot.indicator_id)) out.push(a);
  return out;
}

function IndicatorInput({ ind, v, onChange }: { ind: Indicator; v: Val | undefined; onChange: (v: Val | null) => void }) {
  const id = `ind-${ind.id}`;
  if (ind.response_type === 'text') {
    return <Field label={ind.name} hint={ind.description} id={id}><textarea id={id} rows={2} maxLength={1000} value={v?.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} /></Field>;
  }
  const opts: { label: string; num?: number; choice?: string }[] =
    ind.response_type === 'boolean' ? [{ label: 'Non', num: 0 }, { label: 'Oui', num: 1 }]
      : ind.response_type === 'choice' ? (ind.choices ?? []).map((c) => ({ label: c.label, choice: c.label }))
        : Array.from({ length: (ind.scale_max ?? 10) - (ind.scale_min ?? 0) + 1 }, (_, i) => ({ label: String((ind.scale_min ?? 0) + i), num: (ind.scale_min ?? 0) + i }));
  return (
    <fieldset className="indicator">
      <legend>{ind.name}</legend>
      {ind.description && <span className="hint">{ind.description}</span>}
      <div className="scale" role="group" aria-label={ind.name}>
        {opts.map((o) => {
          const on = o.choice !== undefined ? v?.choice === o.choice : v?.num === o.num;
          return <button type="button" key={o.label} className={`pill${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onChange(o.choice !== undefined ? { choice: o.choice } : { num: o.num })}>{o.label}</button>;
        })}
        <button type="button" className="pill clear" onClick={() => onChange(null)}>Passer</button>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Aujourd'hui (ou un jour passé choisi)
// ---------------------------------------------------------------------------
export function Today() {
  const s = useStore();
  const t = today(s);
  const qd = useHashDate();
  const [date, setDate] = useState(qd && qd <= t ? qd : t);
  useEffect(() => { if (qd && qd <= t) setDate(qd); }, [qd, t]);
  const existing = s.checkins[date];
  const [vals, setVals] = useState<Record<string, Val>>(() => valsFrom(existing));
  const [events, setEvents] = useState(existing?.events_note ?? '');
  const [note, setNote] = useState(existing?.day_note ?? '');
  const [pain, setPain] = useState<number | null>(existing?.pain_score ?? null);
  const [zone, setZone] = useState(existing?.pain_zone ?? '');
  const [painNote, setPainNote] = useState(existing?.pain_note ?? '');
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warn'; text: string } | null>(null);
  useEffect(() => {
    const c = getCheckin(date);
    const d = getState().drafts[date];
    const useDraft = !!d && (!c || d.at > c.updated_at);
    if (useDraft && d) {
      setVals(d.vals); setEvents(d.events); setNote(d.note); setPain(d.pain); setZone(d.zone); setPainNote(d.painNote); setTags(d.tags);
      setMsg({ kind: 'warn', text: 'Brouillon retrouvé : tu n\'avais pas enregistré ce bilan. Vérifie puis enregistre.' });
    } else {
      setVals(valsFrom(c)); setEvents(c?.events_note ?? ''); setNote(c?.day_note ?? ''); setPain(c?.pain_score ?? null); setZone(c?.pain_zone ?? ''); setPainNote(c?.pain_note ?? ''); setTags(c?.tags ?? []); setMsg(null);
    }
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  // Brouillon automatique : toute modification non enregistrée est conservée (fermeture accidentelle, changement de page…).
  const dirty = formSig(vals, events, note, pain, zone, painNote, tags) !== formSig(valsFrom(existing), existing?.events_note ?? '', existing?.day_note ?? '', existing?.pain_score ?? null, existing?.pain_zone ?? '', existing?.pain_note ?? '', existing?.tags ?? []);
  const draftAt = s.drafts[date]?.at;
  useEffect(() => {
    if (!dirty) { if (getState().drafts[date]) update((n) => { delete n.drafts[date]; }); return; }
    const h = window.setTimeout(() => update((n) => { n.drafts[date] = { vals, events, note, pain, zone, painNote, tags, at: new Date().toISOString() }; }), 700);
    return () => window.clearTimeout(h);
  }, [dirty, vals, events, note, pain, zone, painNote, tags, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = activeIndicators(s);
  const answers = useMemo(() => buildAnswers(s, vals, existing), [s, vals, existing]);
  const stats = useMemo(() => computeCheckinStats(answers), [answers]);
  const st = streaks(Object.keys(s.checkins), t);
  const cats = s.categories.slice().sort((a, b) => a.sort_order - b.sort_order);

  function save() {
    const hasAnything = answers.length > 0 || events.trim() || note.trim() || pain !== null || tags.length > 0;
    if (!hasAnything) { setMsg({ kind: 'warn', text: 'Rien à enregistrer pour le moment : réponds à au moins une question ou écris une note.' }); return; }
    update((n) => {
      n.checkins[date] = {
        checkin_date: date, events_note: events.trim() || null, day_note: note.trim() || null, pain_score: pain, pain_zone: pain !== null ? zone || null : null,
        pain_note: pain !== null ? painNote.trim() || null : null, answers, tags, updated_at: new Date().toISOString(),
      };
      delete n.drafts[date];
    });
    setMsg({ kind: 'success', text: date === t ? 'Bilan enregistré. Bravo d\'avoir pris ce moment pour toi.' : `Bilan du ${formatDateFr(date)} enregistré.` });
  }

  return (
    <div className="stack">
      <h1>{date === t ? 'Mon bilan du jour' : `Bilan du ${formatDateFr(date)}`}</h1>
      <div className="row">
        <label>Jour du bilan<input type="date" value={date} max={t} min={addDays(t, -365)} onChange={(e) => e.target.value && setDate(e.target.value <= t ? e.target.value : t)} /></label>
        <div className="muted">Série en cours : <strong>{st.current}</strong> jour{st.current > 1 ? 's' : ''} · meilleure : {st.best} · {st.total} bilan{st.total > 1 ? 's' : ''}. Une pause n'efface rien.</div>
      </div>
      {existing && <Alert>Un bilan existe déjà pour ce jour : tu peux le modifier.</Alert>}
      <div className="tabs" role="group" aria-label="Type de bilan">
        <button className={!s.settings.quickMode ? 'on' : ''} aria-pressed={!s.settings.quickMode} onClick={() => update((n) => { n.settings.quickMode = false; })}>Bilan complet ({active.length} questions)</button>
        <button className={s.settings.quickMode ? 'on' : ''} aria-pressed={s.settings.quickMode} onClick={() => update((n) => { n.settings.quickMode = true; })}>Bilan rapide (5 questions + les miennes)</button>
      </div>
      {cats.map((cat) => {
        const inds = active.filter((i) => i.category_id === cat.id && (!s.settings.quickMode || !i.template_key || QUICK_KEYS.includes(i.template_key)));
        if (!inds.length) return null;
        const cs = stats.categories.find((c) => c.key === cat.id);
        return (
          <Card key={cat.id} title={cat.name} actions={<span className="muted">{cs && cs.average !== null ? `moyenne ${formatScore(cs.average)}/10` : 'pas de moyenne'}</span>}>
            {inds.map((ind) => <IndicatorInput key={ind.id} ind={ind} v={vals[ind.id]} onChange={(v) => setVals((p) => { const n = { ...p }; if (v === null) delete n[ind.id]; else n[ind.id] = v; return n; })} />)}
          </Card>
        );
      })}
      <Card title="Douleur (séparée des moyennes)">
        <p className="muted">Optionnel. La douleur n'entre jamais dans tes moyennes.</p>
        <div className="scale" role="group" aria-label="Intensité de la douleur">
          {Array.from({ length: 11 }, (_, i) => <button type="button" key={i} className={`pill${pain === i ? ' on' : ''}`} aria-pressed={pain === i} onClick={() => setPain(i)}>{i}</button>)}
          <button type="button" className="pill clear" onClick={() => setPain(null)}>Aucune / passer</button>
        </div>
        {pain !== null && (
          <>
            <Field label="Zone" id="zone"><select id="zone" value={zone} onChange={(e) => setZone(e.target.value)}><option value="">—</option>{BODY_ZONES.map((z) => <option key={z}>{z}</option>)}</select></Field>
            <Field label="Précisions" id="pnote"><textarea id="pnote" rows={2} maxLength={1000} value={painNote} onChange={(e) => setPainNote(e.target.value)} /></Field>
          </>
        )}
      </Card>
      <Card title="Ma journée">
        <fieldset><legend>Étiquettes</legend>
          <div className="scale">{TAGS.map((tg) => <button type="button" key={tg} className={`pill${tags.includes(tg) ? ' on' : ''}`} aria-pressed={tags.includes(tg)} onClick={() => setTags((p) => (p.includes(tg) ? p.filter((x) => x !== tg) : [...p, tg]))}>{tg}</button>)}</div>
        </fieldset>
        <Field label="Événements marquants" id="events"><textarea id="events" rows={2} maxLength={2000} value={events} onChange={(e) => setEvents(e.target.value)} /></Field>
        <Field label="Note libre" hint="Ce que tu veux retenir ou déposer." id="note"><textarea id="note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Card>
      <Card title="Aperçu des moyennes">
        <p className="big" aria-live="polite">{stats.general === null ? 'Moyenne indisponible' : `${formatScore(stats.general)} / 10`}</p>
        <p className="muted">{explainAverage(stats)}</p>
      </Card>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {dirty && <p className="muted" role="status">{draftAt ? `Brouillon conservé automatiquement à ${new Date(draftAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — pense à enregistrer.` : 'Modifications non enregistrées.'}</p>}
      <div className="sticky-actions row">
        <Button onClick={save}>Enregistrer mon bilan</Button>
        {existing && <Button variant="ghost" onClick={() => { update((n) => { const c = makeChronicle(n, date); if (c.insufficient) return; n.chronicles[date] = c; }); setMsg({ kind: 'success', text: 'Chronique générée : retrouve-la dans Historique → Chroniques.' }); }}>Générer la chronique de ce jour</Button>}
      </div>
    </div>
  );
}
const getCheckin = (d: string): LocalCheckin | undefined => getState().checkins[d];

// ---------------------------------------------------------------------------
// Historique : courbes, calendrier, observations, chroniques
// ---------------------------------------------------------------------------
type Tab = 'courbes' | 'calendrier' | 'observations' | 'chroniques' | 'recherche' | 'rapport';

export function History() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>('courbes');
  const [sel, setSel] = useState<string | null>(null);
  const tabs: [Tab, string][] = [['courbes', 'Courbes'], ['calendrier', 'Calendrier'], ['observations', 'Observations'], ['chroniques', 'Chroniques'], ['recherche', 'Recherche'], ['rapport', 'Rapport PDF']];
  if (!Object.keys(s.checkins).length) return <div className="stack"><h1>Historique</h1><Alert>Aucun bilan pour l'instant. Fais ton premier bilan dans « Aujourd'hui » : les courbes apparaîtront ici.</Alert></div>;
  return (
    <div className="stack">
      <h1>Historique</h1>
      <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'courbes' && <Curves s={s} />}
      {tab === 'calendrier' && <Calendar s={s} sel={sel} setSel={setSel} />}
      {tab === 'observations' && <Observations s={s} />}
      {tab === 'chroniques' && <Chronicles s={s} focus={sel} />}
      {tab === 'recherche' && <Search s={s} />}
      {tab === 'rapport' && <Report s={s} />}
    </div>
  );
}

function Curves({ s }: { s: Store }) {
  const t = today(s);
  const [preset, setPreset] = useState<Exclude<RangePreset, 'custom'>>('30d');
  const [which, setWhich] = useState('general');
  const { from, to } = rangeFor(preset, t);
  const list = checkinsSorted(s);
  const series = useMemo(() => buildDailySeries(list, from, to), [list, from, to]);
  const avg = periodGeneralAverage(series);
  const weekly = aggregatePeriods(series, 'week');
  const cats = s.categories.slice().sort((a, b) => a.sort_order - b.sort_order);
  const inds = activeIndicators(s).filter((i) => i.response_type === 'scale' || i.response_type === 'choice');
  let points = seriesToPoints(series, (p) => p.general);
  let title = 'Moyenne générale';
  if (which.startsWith('cat:')) { const id = which.slice(4); points = seriesToPoints(series, (p) => p.categories[id] ?? null); title = cats.find((c) => c.id === id)?.name ?? ''; }
  if (which.startsWith('ind:')) { const id = which.slice(4); points = indicatorSeries(list, id, from, to).map((p) => ({ label: p.date.slice(5).replace('-', '/'), value: p.value })); title = inds.find((i) => i.id === id)?.name ?? ''; }
  return (
    <>
      <div className="row">
        <label>Période<select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}><option value="7d">7 jours</option><option value="30d">30 jours</option><option value="90d">90 jours</option><option value="year">1 an</option></select></label>
        <label>Courbe<select value={which} onChange={(e) => setWhich(e.target.value)}>
          <option value="general">Moyenne générale</option>
          <optgroup label="Catégories">{cats.map((c) => <option key={c.id} value={`cat:${c.id}`}>{c.name}</option>)}</optgroup>
          <optgroup label="Indicateurs">{inds.map((i) => <option key={i.id} value={`ind:${i.id}`}>{i.name}</option>)}</optgroup>
        </select></label>
      </div>
      <Card title={title}><LineChart points={points} title={title} /></Card>
      <Card title="Sur la période">
        <p>{avg.value === null ? 'Moyenne indisponible : aucun bilan numérique sur cette période.' : <>Moyenne : <strong>{formatScore(avg.value)}/10</strong> sur {avg.days} jour{avg.days > 1 ? 's' : ''} avec données.</>}</p>
        <ul className="plain">{weekly.filter((w) => w.value !== null).slice(-8).map((w) => <li className="item" key={w.key}><span>Semaine du {w.key.split('-').reverse().join('/')}</span><span>{formatScore(w.value)}/10 · {w.days} j</span></li>)}</ul>
      </Card>
    </>
  );
}

function Calendar({ s, sel, setSel }: { s: Store; sel: string | null; setSel: (d: string | null) => void }) {
  const t = today(s);
  const [month, setMonth] = useState(t.slice(0, 7));
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const lead = (toEpochDay(first) + 3) % 7;
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: nDays }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const shift = (k: number) => { const d = new Date(Date.UTC(y, m - 1 + k, 1)); setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); };
  const chosen = sel ? s.checkins[sel] : undefined;
  const cs = chosen ? computeCheckinStats(chosen.answers) : null;
  return (
    <>
      <div className="row"><Button variant="ghost" onClick={() => shift(-1)} aria-label="Mois précédent">←</Button><strong>{new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><Button variant="ghost" onClick={() => shift(1)} aria-label="Mois suivant">→</Button></div>
      <div className="cal" role="grid" aria-label="Calendrier des bilans">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => <div key={i} className="cal-h">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const c = s.checkins[d];
          const g = c ? computeCheckinStats(c.answers).general : null;
          const style = g !== null ? { background: `color-mix(in srgb, var(--brand) ${Math.round(g * 9 + 8)}%, var(--surface))` } : undefined;
          return <button key={i} className={`cal-d${c ? ' has' : ''}${sel === d ? ' sel' : ''}`} style={style} disabled={d > t} onClick={() => setSel(d)} aria-label={`${formatDateFr(d)}${c ? (g !== null ? `, moyenne ${formatScore(g)}` : ', bilan sans moyenne') : ', pas de bilan'}`}><span>{Number(d.slice(8))}</span>{c && <small>{g !== null ? formatScore(g, 0) : '·'}</small>}</button>;
        })}
      </div>
      <p className="muted">Plus la couleur est soutenue, plus la moyenne du jour est haute. Un jour sans couleur = pas de bilan (ce n'est pas un zéro).</p>
      {sel && (
        <Card title={formatDateFr(sel)} actions={<a className="btn btn-ghost" href={`#/aujourdhui?date=${sel}`}>{chosen ? 'Modifier' : 'Faire ce bilan'}</a>}>
          {!chosen ? <p className="muted">Pas de bilan ce jour-là.</p> : (
            <>
              <p>{cs && cs.general !== null ? <>Moyenne générale : <strong>{formatScore(cs.general)}/10</strong></> : 'Moyenne indisponible.'}</p>
              {chosen.tags?.length > 0 && <p className="muted">Étiquettes : {chosen.tags.join(', ')}</p>}
              {chosen.pain_score !== null && chosen.pain_score !== undefined && <p className="muted">Douleur : {chosen.pain_score}/10{chosen.pain_zone ? ` (${chosen.pain_zone})` : ''}</p>}
              {chosen.day_note && <blockquote className="pre">{chosen.day_note}</blockquote>}
            </>
          )}
        </Card>
      )}
    </>
  );
}

function Observations({ s }: { s: Store }) {
  const ins = useMemo(() => computeInsights(s, today(s)), [s]);
  if (ins.days < 7) return <Alert>Il faut au moins 7 jours de bilans pour des observations fiables ({ins.days} pour l'instant). Elles apparaîtront ici automatiquement.</Alert>;
  const best = ins.weekdays.filter((d) => d.value !== null && d.days >= 2);
  const maxD = best.length ? best.reduce((a, b) => ((a.value as number) >= (b.value as number) ? a : b)) : null;
  const minD = best.length ? best.reduce((a, b) => ((a.value as number) <= (b.value as number) ? a : b)) : null;
  return (
    <div className="stack">
      <Alert>Ces observations décrivent TES données. Ce sont des liens constatés, jamais des causes, et ce n'est pas un avis médical.</Alert>
      <Card title="Tendance (14 derniers jours)">
        {ins.trend.diff === null ? <p className="muted">Pas assez de jours avec données sur les deux périodes (5 minimum chacune).</p>
          : <p>Moyenne : <strong>{formatScore(ins.trend.recent)}</strong> contre {formatScore(ins.trend.previous)} les 14 jours d'avant ({ins.trend.diff >= 0 ? '+' : '−'}{formatScore(Math.abs(ins.trend.diff))}).</p>}
      </Card>
      <Card title="Selon le jour de la semaine">
        <ul className="plain">{ins.weekdays.map((d) => <li className="item" key={d.label}><span style={{ textTransform: 'capitalize' }}>{d.label}</span>{d.value === null ? <span className="muted">pas de donnée</span> : <span className="bar"><progress max={10} value={d.value} aria-label={d.label} /> {formatScore(d.value)} <small className="muted">({d.days} j)</small></span>}</li>)}</ul>
        {maxD && minD && maxD.label !== minD.label && <p className="muted">Jour le plus haut : {maxD.label} · le plus bas : {minD.label}. Quelques semaines de recul sont nécessaires pour que ce soit parlant.</p>}
      </Card>
      <Card title="Indicateurs sur 30 jours">
        {ins.indicators.length < 2 ? <p className="muted">Pas assez de réponses.</p> : (
          <>
            <p><strong>Les plus hauts :</strong> {ins.indicators.slice(0, 3).map((i) => `${i.name} (${formatScore(i.value)})`).join(' · ')}</p>
            <p><strong>Les plus bas :</strong> {ins.indicators.slice(-3).reverse().map((i) => `${i.name} (${formatScore(i.value)})`).join(' · ')}</p>
          </>
        )}
      </Card>
      {ins.tags.length > 0 && (
        <Card title="Selon tes étiquettes">
          <ul className="plain">{ins.tags.slice(0, 6).map((t) => <li key={t.tag} className="item"><span>« {t.tag} »</span><span>{formatScore(t.withAvg)} ({t.withDays} j) contre {formatScore(t.withoutAvg)} ({t.withoutDays} j)</span></li>)}</ul>
          <p className="muted">Seuls les écarts d'au moins 0,5 point avec au moins 3 jours de chaque côté sont affichés.</p>
        </Card>
      )}
      {ins.sleepMood && (
        <Card title="Sommeil et moral">
          <p>Sur {ins.sleepMood.n} jours, les deux vont plutôt {ins.sleepMood.r > 0.3 ? 'ensemble' : ins.sleepMood.r < -0.3 ? 'en sens inverse' : 'dans des sens indépendants'} (corrélation {ins.sleepMood.r.toFixed(2).replace('.', ',')}). Cela ne dit pas lequel influence l'autre.</p>
        </Card>
      )}
    </div>
  );
}

export function ChronicleView({ c, date }: { c: Chronicle; date: string }) {
  const s = useStore();
  async function pdf() {
    const { buildChroniclePdf } = await import('../../supabase/functions/_shared/pdf.ts');
    const bytes = await buildChroniclePdf({ title: c.title, sections: c.sections, date }, { includeSensitive: s.settings.pdfSensitive });
    downloadBlob(`chronique-${date}.pdf`, bytes as BlobPart, 'application/pdf');
  }
  return (
    <Card title={c.title} actions={<span className="muted">{c.source === 'ai' ? 'IA' : 'Modèle sans IA'}</span>}>
      {SECTION_ORDER.map((k) => (c.sections[k] ? <section key={k}><h4>{SECTION_LABELS[k]}</h4><MdLite text={c.sections[k] as string} /></section> : null))}
      <div className="row">
        <Button variant="ghost" onClick={pdf}>Télécharger en PDF</Button>
        <Button variant="ghost" onClick={() => { navigator.clipboard?.writeText(chronicleToText(c)).catch(() => undefined); }}>Copier le texte</Button>
        <Button variant="ghost" onClick={() => update((n) => { const nc = makeChronicle(n, date); if (!nc.insufficient) n.chronicles[date] = nc; })}>Régénérer</Button>
        <Button variant="danger" onClick={() => { if (confirm('Supprimer cette chronique ? Ton bilan est conservé.')) update((n) => { delete n.chronicles[date]; }); }}>Supprimer</Button>
      </div>
    </Card>
  );
}

function Chronicles({ s, focus }: { s: Store; focus: string | null }) {
  const dates = Object.keys(s.chronicles).sort().reverse();
  const missing = Object.keys(s.checkins).filter((d) => !s.chronicles[d]).sort().reverse().slice(0, 7);
  return (
    <div className="stack">
      <p className="muted">Une chronique est écrite à partir de ce que tu as saisi : elle n'invente rien. Les jours passés sont rattrapés automatiquement à l'ouverture (réglable).</p>
      {missing.length > 0 && <Card title="Bilans sans chronique">{missing.map((d) => <div className="item" key={d}><span>{formatDateFr(d)}</span><Button variant="ghost" onClick={() => update((n) => { const c = makeChronicle(n, d); if (!c.insufficient) n.chronicles[d] = c; })}>Générer</Button></div>)}</Card>}
      {dates.length === 0 && <Alert>Aucune chronique pour l'instant.</Alert>}
      {dates.map((d) => <div key={d} style={focus === d ? { outline: '2px solid var(--brand)', borderRadius: 12 } : undefined}><ChronicleView c={s.chronicles[d]} date={d} /></div>)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recherche dans mes notes, victoires, objectifs et chroniques (sur l'appareil, rien ne sort)
// ---------------------------------------------------------------------------
const fold = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function Highlight({ text, q }: { text: string; q: string }) {
  const f = fold(text), fq = fold(q);
  const i = fq ? f.indexOf(fq) : -1;
  if (i < 0) return <>{text.slice(0, 160)}</>;
  const from = Math.max(0, i - 50);
  return <>{from > 0 ? '…' : ''}{text.slice(from, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length, i + q.length + 90)}</>;
}

function Search({ s }: { s: Store }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const fq = fold(q.trim());
    if (fq.length < 2) return [];
    const out: { kind: string; date: string; text: string; href?: string }[] = [];
    for (const c of checkinsSorted(s).reverse()) {
      for (const [label, v] of [['Note', c.day_note], ['Événements', c.events_note], ['Douleur', c.pain_note]] as [string, string | null | undefined][]) if (v && fold(v).includes(fq)) out.push({ kind: label, date: c.checkin_date, text: v, href: `#/aujourdhui?date=${c.checkin_date}` });
      for (const a of c.answers) if (a.value_text && fold(a.value_text).includes(fq)) out.push({ kind: a.snapshot.name, date: c.checkin_date, text: a.value_text, href: `#/aujourdhui?date=${c.checkin_date}` });
    }
    for (const v of s.victories) if (fold(v.text).includes(fq)) out.push({ kind: 'Victoire', date: v.date, text: v.text });
    for (const g of s.goals) { if (fold(g.title).includes(fq)) out.push({ kind: 'Objectif', date: g.created_at.slice(0, 10), text: g.title }); for (const st of g.steps) if (fold(st.title).includes(fq)) out.push({ kind: `Étape de « ${g.title} »`, date: g.created_at.slice(0, 10), text: st.title }); }
    for (const [d, c] of Object.entries(s.chronicles)) { const t = chronicleToText(c); if (fold(t).includes(fq)) out.push({ kind: 'Chronique', date: d, text: t }); }
    return out.slice(0, 60);
  }, [s, q]);
  return (
    <div className="stack">
      <Field label="Rechercher un mot dans mes notes, victoires, objectifs et chroniques" id="srch"><input id="srch" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex. sport, médecin, projet…" /></Field>
      {q.trim().length >= 2 && hits.length === 0 && <Alert>Aucun résultat pour « {q.trim()} ».</Alert>}
      <ul className="plain">{hits.map((h, i) => <li className="item" key={i} style={{ display: 'block' }}><span className="muted">{formatDateFr(h.date)} · {h.kind}</span><br />{h.href ? <a href={h.href}><Highlight text={h.text} q={q.trim()} /></a> : <Highlight text={h.text} q={q.trim()} />}</li>)}</ul>
      {hits.length === 60 && <p className="muted">Seuls les 60 premiers résultats sont affichés : précise ta recherche.</p>}
    </div>
  );
}

function Report({ s }: { s: Store }) {
  const [days, setDays] = useState<30 | 90 | 365>(30);
  const [pain, setPain] = useState(false);
  const [notes, setNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Rapport de période (PDF)">
      <p className="muted">Un résumé d'une ou deux pages à garder ou à montrer à un professionnel de santé : moyennes, courbe, semaine par semaine. Par défaut, ni la douleur ni tes notes n'y figurent : tu choisis ce que tu partages.</p>
      <Field label="Période" id="rp"><select id="rp" value={days} onChange={(e) => setDays(Number(e.target.value) as 30 | 90 | 365)}><option value={30}>30 derniers jours</option><option value={90}>90 derniers jours</option><option value={365}>1 an</option></select></Field>
      <label className="check"><input type="checkbox" checked={pain} onChange={(e) => setPain(e.target.checked)} />Inclure la douleur (intensité, zone)</label>
      <label className="check"><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />Inclure mes notes personnelles</label>
      <Button busy={busy} onClick={async () => { setBusy(true); try { downloadBlob(`tock-tock-rapport-${today(s)}.pdf`, (await buildReportPdf(s, { days, includePain: pain, includeNotes: notes })) as BlobPart, 'application/pdf'); } finally { setBusy(false); } }}>Télécharger le rapport</Button>
    </Card>
  );
}
