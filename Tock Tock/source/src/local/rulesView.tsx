import { Alert, Button, Card } from '../components/ui';
import { PRINCIPLES, RULES_CHANGES, RULES_VERSION, RULE_SECTIONS, rulesAsText } from './rules';

/** Toutes les règles, chacune avec son « pourquoi » (dépliable). */
export function RulesView() {
  return (
    <div className="stack">
      <Card title="Le principe : 5 idées dont découlent toutes les règles">
        <p className="muted">Si une règle te semble étrange, cherche le principe qu'elle protège. Chaque règle, une fois dépliée, dit pourquoi elle existe et à quel principe elle se rattache.</p>
        <ol className="help principles">{PRINCIPLES.map((p) => <li key={p.id}><strong>{p.title}.</strong> {p.text}</li>)}</ol>
      </Card>
      {RULE_SECTIONS.map((sec) => (
        <Card key={sec.id} title={sec.title} actions={sec.scope ? <span className="muted">{sec.scope}</span> : undefined}>
          <p className="muted">{sec.intro}</p>
          {sec.rules.map((r) => <details className="doc" key={r.rule}><summary><strong>{r.rule}</strong></summary><p><em>Pourquoi ?</em> {r.why}</p><p className="muted">Principe : {PRINCIPLES.find((p) => p.id === r.p)?.title}.</p></details>)}
        </Card>
      ))}
    </div>
  );
}

export function RulesPage() {
  return (
    <div className="stack">
      <h1>Règles de Tock Tock</h1>
      <p className="lead">Version {RULES_VERSION}. Chaque règle peut être dépliée pour comprendre pourquoi elle existe.</p>
      <div className="row"><Button variant="ghost" onClick={() => navigator.clipboard?.writeText(rulesAsText()).catch(() => undefined)}>Copier toutes les règles</Button></div>
      <RulesView />
    </div>
  );
}

/** Écran bloquant quand les règles ont changé depuis la dernière acceptation. */
export function RulesGate({ previous, onAccept, onBackup }: { previous: string | null; onAccept: () => void; onBackup: () => void }) {
  return (
    <main className="narrow stack" id="main">
      <h1>Les règles ont changé</h1>
      <p className="lead">{previous ? `Tu avais accepté la version ${previous}. ` : ''}La version actuelle est la {RULES_VERSION}.</p>
      <Card title="Ce qui change">
        <ul className="help">{RULES_CHANGES.map((c) => <li key={c}>{c}</li>)}</ul>
      </Card>
      <details className="doc"><summary><strong>Lire toutes les règles</strong></summary><RulesView /></details>
      <Alert>Tu dois accepter la nouvelle version pour continuer. Si tu préfères ne pas le faire, tu peux récupérer tes données avant de quitter.</Alert>
      <div className="row"><Button onClick={onAccept}>J'accepte les règles mises à jour</Button><Button variant="ghost" onClick={onBackup}>Télécharger mes données (PDF) sans accepter</Button></div>
    </main>
  );
}
