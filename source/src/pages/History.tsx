import { useMemo, useState } from 'react';
import { callFunction, db } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { todayIn } from '../lib/format';
import { Alert, Button, Card, Loading, useAction, useAsync } from '../components/ui';
import { LineChart, seriesToPoints } from '../components/Chart';
import { aggregatePeriods, buildDailySeries, formatScore, indicatorSeries, periodGeneralAverage, rangeFor, addDays } from '../../supabase/functions/_shared/stats.ts';
import { chronicleToText, formatDateFr, SECTION_LABELS, SECTION_ORDER } from '../../supabase/functions/_shared/chronicle.ts';
import type { Checkin, ChronicleSections } from '../../supabase/functions/_shared/types.ts';

interface ChronicleRow { id: string; chronicle_date: string; title: string; sections: ChronicleSections; source: 'template' | 'ai'; status: 'ready' | 'edited'; data_used: Record<string, boolean> }

export function History() {
  const { me } = useAuth();
  const tz = me!.settings!.timezone;
  const today = todayIn(tz);
  const [preset, setPreset] = useState<'7d' | '30d' | '90d' | 'year' | 'custom'>('30d');
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const [by, setBy] = useState<'day' | 'week' | 'month'>('day');
  const [focus, setFocus] = useState('general');
  const range = preset === 'custom' ? custom : rangeFor(preset, today);
  const tooLong = range.from > range.to;

  const { data, loading, error } = useAsync(async () => {
    const { data: rows, error: e } = await db().from('checkins').select('*, checkin_answers(snapshot,value_num,value_text,value_choice,indicator_id)').gte('checkin_date', range.from).lte('checkin_date', range.to).order('checkin_date');
    if (e) throw e;
    return (rows ?? []).map((r: Record<string, unknown> & { checkin_answers?: { snapshot: never; value_num: string | null; value_text: string | null; value_choice: string | null }[] }) => ({ ...r, answers: (r.checkin_answers ?? []).map((a: { snapshot: never; value_num: string | null; value_text: string | null; value_choice: string | null }) => ({ ...a, value_num: a.value_num === null ? null : Number(a.value_num) })) })) as unknown as (Checkin & { pain_score: number | null })[];
  }, [range.from, range.to]);

  const view = useMemo(() => {
    if (!data || tooLong) return null;
    const series = buildDailySeries(data, range.from, range.to);
    const cats = new Map<string, string>();
    for (const c of data) for (const a of c.answers) cats.set(a.snapshot.category_id ?? `name:${a.snapshot.category_name}`, a.snapshot.category_name ?? 'Sans catégorie');
    const inds = new Map<string, string>();
    for (const c of data) for (const a of c.answers) if (a.snapshot.indicator_id && a.snapshot.response_type === 'scale') inds.set(a.snapshot.indicator_id, a.snapshot.name);
    let points: { label: string; value: number | null }[];
    if (focus.startsWith('ind:')) points = indicatorSeries(data, focus.slice(4), range.from, range.to).map((p) => ({ label: p.date.slice(5).replace('-', '/'), value: p.value }));
    else {
      const pick = focus.startsWith('cat:') ? (p: (typeof series)[number]) => p.categories[focus.slice(4)] ?? null : (p: (typeof series)[number]) => p.general;
      if (by === 'day') points = seriesToPoints(series, pick);
      else {
        const agg = aggregatePeriods(series.map((p) => ({ ...p, general: pick(p) })), by);
        points = agg.map((a) => ({ label: a.key.slice(5), value: a.value }));
      }
    }
    const pain = data.some((c) => c.pain_score !== null && c.pain_score !== undefined)
      ? series.map((s) => ({ label: s.date.slice(5).replace('-', '/'), value: (data.find((c) => c.checkin_date === s.date)?.pain_score as number | null | undefined) ?? null }))
      : null;
    return { series, cats: [...cats], inds: [...inds], points, pain, avg: periodGeneralAverage(series) };
  }, [data, range.from, range.to, focus, by, tooLong]);

  return (
    <div className="stack">
      <Card title="Mon historique">
        <div className="row">
          <label>Période<select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}><option value="7d">7 jours</option><option value="30d">30 jours</option><option value="90d">90 jours</option><option value="year">1 an</option><option value="custom">Personnalisée</option></select></label>
          {preset === 'custom' && <><label>Du<input type="date" value={custom.from} max={today} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label><label>Au<input type="date" value={custom.to} max={today} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label></>}
          <label>Regroupement<select value={by} onChange={(e) => setBy(e.target.value as typeof by)}><option value="day">Par jour</option><option value="week">Par semaine</option><option value="month">Par mois</option></select></label>
          <label>Afficher<select value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="general">Moyenne générale</option>
            {view?.cats.map(([k, n]) => <option key={k} value={`cat:${k}`}>Catégorie : {n}</option>)}
            {view?.inds.map(([k, n]) => <option key={k} value={`ind:${k}`}>Indicateur : {n}</option>)}
          </select></label>
        </div>
        {tooLong && <Alert kind="warn">La date de début doit précéder la date de fin.</Alert>}
        {loading && <Loading />}
        {error && <Alert kind="error">Impossible de charger l'historique.</Alert>}
        {view && (
          <>
            <LineChart title={focus === 'general' ? 'Moyenne générale' : 'Évolution'} points={view.points} />
            <p className="muted">{view.avg.value === null ? 'Moyenne indisponible sur cette période.' : `Moyenne de la période : ${formatScore(view.avg.value)} / 10 (sur ${view.avg.days} jour${view.avg.days > 1 ? 's' : ''} avec données).`}</p>
            {view.pain && <><h3>Douleur (hors moyenne)</h3><LineChart title="Douleur" points={view.pain} height={140} /></>}
          </>
        )}
      </Card>
      <Chronicles today={today} />
    </div>
  );
}

function Chronicles({ today }: { today: string }) {
  const { me } = useAuth();
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChronicleRow | null>(null);
  const [genDate, setGenDate] = useState(today);
  const { data, loading, reload } = useAsync(async () => {
    const { data: r } = await db().from('chronicles').select('*').order('chronicle_date', { ascending: false }).limit(60);
    return (r ?? []) as ChronicleRow[];
  }, []);

  async function generate(date: string, regenerate: boolean, confirmOverwrite = false) {
    await act.run(async () => {
      const r = await callFunction<{ stored?: boolean; message?: string; error?: string; ai?: { requested: boolean; used: boolean; reason?: string } }>('generate-chronicle', { date, regenerate, confirmOverwrite, useAi: !!me!.settings!.ai_consent });
      if (r.status === 409 && r.data.error === 'edited_chronicle') {
        if (confirm('Cette chronique a été modifiée par toi. La remplacer ?')) return void (await generate(date, true, true));
        return;
      }
      if (!r.ok) throw new Error(r.data.message ?? 'La génération a échoué. Réessaie plus tard.');
      reload();
      const ai = r.data.ai;
      return r.data.stored === false ? (r.data.message ?? 'Données insuffisantes.') : ai?.requested && !ai.used ? 'Chronique créée avec le modèle standard (l\'IA n\'a pas été utilisée).' : 'Chronique prête.';
    });
  }

  async function pdf(c: ChronicleRow) {
    const { buildChroniclePdf } = await import('../../supabase/functions/_shared/pdf.ts');
    const bytes = await buildChroniclePdf({ title: c.title, sections: c.sections, date: c.chronicle_date }, { includeSensitive: true });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = `chronique-${c.chronicle_date}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <Card title="Chroniques de minuit">
      <p className="muted">Une chronique résume ton bilan avec tes propres données, sans rien inventer. {me!.settings!.chronicle_enabled ? 'Elle est générée automatiquement chaque jour.' : 'La génération automatique est désactivée (réglages).'}</p>
      <div className="row">
        <label>Créer pour le jour<input type="date" value={genDate} max={today} onChange={(e) => setGenDate(e.target.value)} /></label>
        <Button busy={act.busy} onClick={() => generate(genDate, false)}>Générer</Button>
      </div>
      {act.error && <Alert kind="error">{act.error}</Alert>}
      {act.done && <Alert kind="info">{act.done}</Alert>}
      {loading && <Loading />}
      {data?.length === 0 && <p className="muted">Aucune chronique pour l'instant.</p>}
      <ul className="plain">
        {data?.map((c) => (
          <li key={c.id} className="chronicle">
            <button className="linklike" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>{formatDateFr(c.chronicle_date)}</button>
            <span className="muted"> · {c.source === 'ai' ? 'rédigée avec l\'IA' : 'modèle standard'}{c.status === 'edited' ? ' · modifiée par toi' : ''}</span>
            {open === c.id && (
              <div className="chronicle-body">
                {editing?.id === c.id ? (
                  <>
                    {SECTION_ORDER.filter((k) => editing.sections[k] !== undefined).map((k) => (
                      <label key={k}>{SECTION_LABELS[k]}<textarea rows={3} value={editing.sections[k] ?? ''} onChange={(e) => setEditing({ ...editing, sections: { ...editing.sections, [k]: e.target.value } })} /></label>
                    ))}
                    <div className="row">
                      <Button onClick={() => act.run(async () => { const { error } = await db().from('chronicles').update({ sections: editing.sections, status: 'edited' }).eq('id', c.id); if (error) throw error; setEditing(null); reload(); return 'Modifications enregistrées.'; })}>Enregistrer</Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>Annuler</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>{c.title}</h3>
                    {SECTION_ORDER.map((k) => (c.sections[k] ? <div key={k}><h4>{SECTION_LABELS[k]}</h4><p className="pre">{c.sections[k]}</p></div> : null))}
                    <p className="muted">Données utilisées : {Object.entries(c.data_used ?? {}).filter(([, v]) => v).map(([k]) => ({ checkin: 'bilan', notes: 'notes', goals: 'objectifs', pain: 'douleur', history: 'historique' } as Record<string, string>)[k] ?? k).join(', ') || 'aucune'}.</p>
                    <div className="row">
                      <Button variant="ghost" onClick={() => setEditing(c)}>Modifier</Button>
                      <Button variant="ghost" onClick={() => generate(c.chronicle_date, true)}>Régénérer</Button>
                      <Button variant="ghost" onClick={() => pdf(c)}>Télécharger en PDF</Button>
                      <Button variant="ghost" onClick={() => navigator.clipboard?.writeText(chronicleToText(c))}>Copier le texte</Button>
                      <Button variant="danger" onClick={() => { if (confirm('Supprimer définitivement cette chronique ?')) act.run(async () => { await db().from('chronicles').delete().eq('id', c.id); reload(); }); }}>Supprimer</Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
