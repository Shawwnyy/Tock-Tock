import { useMemo, useState } from 'react';
import { db, friendlyError } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { todayIn } from '../lib/format';
import { Alert, Button, Card, Loading, useAction, useAsync } from '../components/ui';
import { computeCheckinStats, explainAverage, formatScore } from '../../supabase/functions/_shared/stats.ts';
import type { Answer } from '../../supabase/functions/_shared/types.ts';
import { Link } from '../lib/router';

interface Indicator { id: string; name: string; description: string | null; category_id: string; response_type: 'scale' | 'text' | 'choice' | 'boolean'; scale_min: number | null; scale_max: number | null; choices: { label: string; score?: number | null }[] | null; include_in_average: boolean; sort_order: number; template_key: string | null; is_required: boolean }
interface Category { id: string; name: string; sort_order: number; template_key: string | null }
type Val = { num?: number | null; text?: string | null; choice?: string | null };

export function Today() {
  const { me } = useAuth();
  const tz = me!.settings!.timezone;
  const [date, setDate] = useState(todayIn(tz));
  const [vals, setVals] = useState<Record<string, Val>>({});
  const [meta, setMeta] = useState({ events: '', day: '', pain: null as number | null, zone: '', painNote: '' });
  const [loadedFor, setLoadedFor] = useState('');
  const act = useAction();

  const { data, loading, error, reload } = useAsync(async () => {
    const [i, c, ck] = await Promise.all([
      db().from('indicators').select('*').eq('is_active', true).is('deleted_at', null).order('sort_order'),
      db().from('indicator_categories').select('id,name,sort_order,template_key').is('deleted_at', null).order('sort_order'),
      db().from('checkins').select('*, checkin_answers(*)').eq('checkin_date', date).maybeSingle(),
    ]);
    if (i.error || c.error || ck.error) throw new Error('load');
    const v: Record<string, Val> = {};
    for (const a of ck.data?.checkin_answers ?? []) if (a.indicator_id) v[a.indicator_id] = { num: a.value_num === null ? null : Number(a.value_num), text: a.value_text, choice: a.value_choice };
    setVals(v);
    setMeta({ events: ck.data?.events_note ?? '', day: ck.data?.day_note ?? '', pain: ck.data?.pain_score ?? null, zone: ck.data?.pain_zone ?? '', painNote: ck.data?.pain_note ?? '' });
    setLoadedFor(date);
    return { indicators: (i.data ?? []) as Indicator[], categories: (c.data ?? []) as Category[], checkin: ck.data as { id: string; checkin_answers: { id: string; indicator_id: string }[] } | null };
  }, [date]);

  const preview = useMemo(() => {
    if (!data) return null;
    const answers: Answer[] = [];
    for (const ind of data.indicators) {
      const v = vals[ind.id];
      if (!v || (v.num === null || v.num === undefined) && !v.text && !v.choice) continue;
      const cat = data.categories.find((c) => c.id === ind.category_id);
      answers.push({
        snapshot: { indicator_id: ind.id, name: ind.name, category_id: ind.category_id, category_name: cat?.name ?? null, response_type: ind.response_type, scale_min: ind.scale_min, scale_max: ind.scale_max, choices: ind.choices, include_in_average: ind.include_in_average },
        value_num: v.num ?? null, value_text: v.text ?? null, value_choice: v.choice ?? null,
      });
    }
    return computeCheckinStats(answers);
  }, [data, vals]);

  const set = (id: string, v: Val) => setVals((s) => ({ ...s, [id]: v }));

  async function save() {
    await act.run(async () => {
      if (!data) return;
      const uid = me!.id;
      const row = { user_id: uid, checkin_date: date, events_note: meta.events.trim() || null, day_note: meta.day.trim() || null,
        pain_score: me!.settings!.track_pain ? meta.pain : null, pain_zone: me!.settings!.track_pain && meta.zone.trim() ? meta.zone.trim() : null, pain_note: me!.settings!.track_pain && meta.painNote.trim() ? meta.painNote.trim() : null };
      let checkinId = data.checkin?.id;
      if (checkinId) {
        const { error: e } = await db().from('checkins').update({ events_note: row.events_note, day_note: row.day_note, pain_score: row.pain_score, pain_zone: row.pain_zone, pain_note: row.pain_note }).eq('id', checkinId);
        if (e) throw new Error(friendlyError(e));
      } else {
        const { data: ins, error: e } = await db().from('checkins').insert(row).select('id').single();
        if (e) throw new Error(friendlyError(e));
        checkinId = ins.id as string;
      }
      const existing = new Map((data.checkin?.checkin_answers ?? []).map((a) => [a.indicator_id, a.id]));
      for (const ind of data.indicators) {
        const v = vals[ind.id];
        const empty = !v || ((v.num === null || v.num === undefined) && !v.text?.trim() && !v.choice);
        const exId = existing.get(ind.id);
        if (empty) {
          // Réponse vidée : on supprime la ligne. Une réponse vide n'est JAMAIS enregistrée comme zéro.
          if (exId) await db().from('checkin_answers').delete().eq('id', exId);
          continue;
        }
        const payload = { value_num: v!.num ?? null, value_text: v!.text?.trim() || null, value_choice: v!.choice ?? null };
        const { error: e } = exId
          ? await db().from('checkin_answers').update(payload).eq('id', exId)
          : await db().from('checkin_answers').insert({ checkin_id: checkinId, user_id: uid, indicator_id: ind.id, ...payload });
        if (e) throw new Error(friendlyError(e));
      }
      reload();
      return 'Bilan enregistré. Tu peux le modifier quand tu veux.';
    });
  }

  if (loading && !data) return <Loading />;
  if (error || !data) return <Alert kind="error">Impossible de charger ton bilan. Réessaie dans un instant.</Alert>;
  const track = me!.settings!.track_pain;
  const byCat = data.categories.map((c) => ({ c, items: data.indicators.filter((i) => i.category_id === c.id) })).filter((x) => x.items.length);

  return (
    <div className="stack">
      <Card title="Mon bilan">
        <p className="muted">Réponds seulement à ce que tu veux : une question laissée vide n'est jamais comptée comme un zéro. Rien n'est obligatoire.</p>
        <label className="inline">Jour du bilan <input type="date" value={date} max={todayIn(tz)} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
        {loadedFor !== date && <Loading />}
      </Card>

      {byCat.length === 0 && <Alert kind="info">Tu n'as aucun indicateur actif. <Link to="/indicateurs">Gérer mes indicateurs</Link></Alert>}

      {byCat.map(({ c, items }) => (
        <Card key={c.id} title={c.name}>
          {items.map((ind) => (
            <fieldset key={ind.id} className="indicator">
              <legend>{ind.name}{ind.is_required && <span className="muted"> · rappel personnel</span>}</legend>
              {ind.description && <p className="hint">{ind.description}</p>}
              {ind.response_type === 'scale' && (
                <div className="scale" role="radiogroup" aria-label={ind.name}>
                  {Array.from({ length: (ind.scale_max ?? 10) - (ind.scale_min ?? 0) + 1 }, (_, k) => (ind.scale_min ?? 0) + k).map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={vals[ind.id]?.num === n} className={`pill ${vals[ind.id]?.num === n ? 'on' : ''}`} onClick={() => set(ind.id, { num: n })}>{n}</button>
                  ))}
                  <button type="button" className="pill clear" onClick={() => set(ind.id, {})}>Passer</button>
                </div>
              )}
              {ind.response_type === 'boolean' && (
                <div className="scale" role="radiogroup" aria-label={ind.name}>
                  {[['Oui', 1], ['Non', 0]].map(([l, n]) => <button key={l} type="button" role="radio" aria-checked={vals[ind.id]?.num === n} className={`pill ${vals[ind.id]?.num === n ? 'on' : ''}`} onClick={() => set(ind.id, { num: n as number })}>{l}</button>)}
                  <button type="button" className="pill clear" onClick={() => set(ind.id, {})}>Passer</button>
                </div>
              )}
              {ind.response_type === 'choice' && (
                <div className="scale" role="radiogroup" aria-label={ind.name}>
                  {(ind.choices ?? []).map((ch) => <button key={ch.label} type="button" role="radio" aria-checked={vals[ind.id]?.choice === ch.label} className={`pill ${vals[ind.id]?.choice === ch.label ? 'on' : ''}`} onClick={() => set(ind.id, { choice: ch.label })}>{ch.label}</button>)}
                  <button type="button" className="pill clear" onClick={() => set(ind.id, {})}>Passer</button>
                </div>
              )}
              {ind.response_type === 'text' && <textarea rows={2} maxLength={1000} aria-label={ind.name} value={vals[ind.id]?.text ?? ''} onChange={(e) => set(ind.id, { text: e.target.value })} />}
            </fieldset>
          ))}
        </Card>
      ))}

      {track && (
        <Card title="Douleur (privée, hors moyenne)">
          <p className="hint">La douleur est notée à part : elle n'entre dans aucune moyenne et n'est jamais visible par les autres.</p>
          <div className="scale" role="radiogroup" aria-label="Douleur de 0 à 10">
            {Array.from({ length: 11 }, (_, n) => <button key={n} type="button" role="radio" aria-checked={meta.pain === n} className={`pill ${meta.pain === n ? 'on' : ''}`} onClick={() => setMeta({ ...meta, pain: n })}>{n}</button>)}
            <button type="button" className="pill clear" onClick={() => setMeta({ ...meta, pain: null })}>Passer</button>
          </div>
          <label>Zone (facultatif)<input maxLength={60} value={meta.zone} onChange={(e) => setMeta({ ...meta, zone: e.target.value })} /></label>
          <label>Note (facultatif)<textarea rows={2} maxLength={500} value={meta.painNote} onChange={(e) => setMeta({ ...meta, painNote: e.target.value })} /></label>
        </Card>
      )}

      <Card title="Mes mots">
        <label>Événements de la journée<textarea rows={3} maxLength={2000} value={meta.events} onChange={(e) => setMeta({ ...meta, events: e.target.value })} /></label>
        <label>Un mot sur ma journée<textarea rows={3} maxLength={2000} value={meta.day} onChange={(e) => setMeta({ ...meta, day: e.target.value })} /></label>
      </Card>

      {preview && (
        <Card title="Aperçu de la moyenne">
          <p className="big">{preview.general === null ? 'Moyenne indisponible' : `${formatScore(preview.general)} / 10`}</p>
          <p className="muted">{explainAverage(preview)}</p>
        </Card>
      )}

      {act.error && <Alert kind="error">{act.error}</Alert>}
      {act.done && <Alert kind="success">{act.done}</Alert>}
      <div className="sticky-actions"><Button onClick={save} busy={act.busy}>Enregistrer mon bilan</Button></div>
    </div>
  );
}
