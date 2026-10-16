// Exercices guidés (scan corporel, relaxation, étirements, écriture…) : étapes une à une, minuteur facultatif, suivi des exercices faits.
import { useEffect, useState } from 'react';
import { Alert, Button, Card } from '../components/ui';
import { EXERCISES, type Exercise } from './data';
import { today, update, useStore } from './store';

function Runner({ ex, onDone }: { ex: Exercise; onDone: () => void }) {
  const s = useStore();
  const [i, setI] = useState(-1); // -1 : présentation
  const [left, setLeft] = useState(0);
  const [texts, setTexts] = useState<string[]>(() => (ex.write ? ex.write.prompts.map(() => '') : []));
  const step = i >= 0 && i < ex.steps.length ? ex.steps[i] : null;
  useEffect(() => { setLeft(step?.seconds ?? 0); }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!step?.seconds) return;
    const t = setInterval(() => setLeft((x) => (x > 0 ? x - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  const finished = i >= ex.steps.length;
  const finish = () => update((n) => { n.exlog.push({ date: today(n), id: ex.id, ...(ex.write?.keep && texts.some((x) => x.trim()) ? { text: texts.filter((x) => x.trim()).join(' | ').slice(0, 600) } : {}) }); n.exlog = n.exlog.slice(-500); });
  return (
    <Card title={`${ex.name} · ${ex.minutes} min`} actions={<Button variant="ghost" onClick={onDone}>Fermer</Button>}>
      {i < 0 && (<><p>{ex.intro}</p><Alert>Un exercice de détente n'est pas un traitement. Arrête-toi à la moindre gêne ; en cas de détresse, ouvre l'onglet « Aide ».</Alert><Button onClick={() => setI(0)}>Commencer</Button></>)}
      {step && (
        <div>
          <p className="muted">Étape {i + 1} sur {ex.steps.length}</p>
          <p className="lead">{step.text}</p>
          {step.seconds ? <p aria-live="off"><strong className="clock">{left > 0 ? `${left} s` : 'Prends le temps qu\'il te faut'}</strong></p> : null}
          {ex.write && i === ex.steps.length - 1 && ex.write.prompts.map((p, k) => (
            <div className="field" key={p}><label htmlFor={`w${k}`}>{p}</label><textarea id={`w${k}`} rows={2} maxLength={400} value={texts[k]} onChange={(e) => setTexts((t) => t.map((x, j) => (j === k ? e.target.value : x)))} /></div>
          ))}
          <div className="row">
            {i > 0 && <Button variant="ghost" onClick={() => setI(i - 1)}>Précédent</Button>}
            <Button onClick={() => { if (i === ex.steps.length - 1) finish(); setI(i + 1); }}>{i === ex.steps.length - 1 ? 'Terminer' : 'Suivant'}</Button>
          </div>
        </div>
      )}
      {finished && (<><Alert kind="success"><strong>Exercice terminé.</strong> Bravo d'avoir pris ce moment.{ex.write && !ex.write.keep ? ' Ton texte n\'a pas été enregistré.' : ''}</Alert><p className="muted">Exercices faits cette semaine : {weekCount(s.exlog, today(s))}.</p><Button onClick={onDone}>Retour aux exercices</Button></>)}
    </Card>
  );
}

export function weekCount(log: { date: string }[], t: string): number {
  const from = new Date(`${t}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - 6);
  const f = from.toISOString().slice(0, 10);
  return log.filter((x) => x.date >= f && x.date <= t).length;
}

export function Exercises() {
  const s = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const ex = EXERCISES.find((e) => e.id === open);
  const gratitude = s.exlog.filter((x) => x.id === 'gratitude' && x.text).slice(-5).reverse();
  return (
    <>
      {ex ? <Runner ex={ex} key={ex.id} onDone={() => setOpen(null)} /> : (
        <Card title="Exercices guidés">
          <p className="muted">Des exercices courts pour te poser. Ce sont des outils de détente, pas un traitement. Cette semaine : <strong>{weekCount(s.exlog, today(s))}</strong> exercice(s) terminé(s).</p>
          <ul className="plain ex-list">{EXERCISES.map((e) => (
            <li key={e.id} className="item"><span><strong>{e.name}</strong> <small className="muted">· {e.kind} · {e.minutes} min</small><br /><span className="muted">{e.intro}</span></span><Button variant="ghost" onClick={() => setOpen(e.id)}>Commencer</Button></li>
          ))}</ul>
        </Card>
      )}
      {!ex && gratitude.length > 0 && <Card title="Mes dernières bonnes choses"><ul className="plain">{gratitude.map((g, i) => <li key={i}><small className="muted">{g.date}</small> — {g.text}</li>)}</ul></Card>}
    </>
  );
}
