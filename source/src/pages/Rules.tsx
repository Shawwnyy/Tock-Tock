import { useState } from 'react';
import { db, friendlyError } from '../lib/supabase';
import { useAuth, type LegalDoc } from '../lib/auth';
import { MdLite } from '../components/MdLite';
import { Alert, Button } from '../components/ui';

const LABEL: Record<string, string> = { community_rules: 'Règles de la communauté', privacy_policy: 'Confidentialité et données', chatbot_limits: 'Limites de l\'assistant' };

export function Rules() {
  const { me, refresh, signOut } = useAuth();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docs = me!.latestDocs;
  const allChecked = docs.every((d) => checked[d.id]);

  async function accept() {
    setBusy(true);
    setError(null);
    const versions: Record<string, string> = {};
    for (const d of docs) versions[d.kind] = d.version;
    const { error: err } = await db().rpc('accept_rules', { p_versions: versions });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    await refresh();
  }

  return (
    <main className="narrow">
      <h1>Avant de commencer</h1>
      <p>Pour protéger tout le monde, merci de lire et d'accepter ces documents. Tu peux consulter l'historique des versions dans tes réglages.</p>
      {docs.map((d: LegalDoc) => (
        <details key={d.id} className="doc" open={docs.length === 1}>
          <summary>{LABEL[d.kind] ?? d.title} <span className="muted">(version {d.version})</span></summary>
          <div className="doc-body" tabIndex={0}><MdLite text={d.body_md} /></div>
          <label className="check">
            <input type="checkbox" checked={!!checked[d.id]} onChange={(e) => setChecked({ ...checked, [d.id]: e.target.checked })} /> J'ai lu et j'accepte : {LABEL[d.kind] ?? d.title}
          </label>
        </details>
      ))}
      {error && <Alert kind="error">{error}</Alert>}
      <div className="row">
        <Button onClick={accept} busy={busy} disabled={!allChecked}>Continuer</Button>
        <Button variant="ghost" onClick={signOut}>Me déconnecter</Button>
      </div>
    </main>
  );
}
