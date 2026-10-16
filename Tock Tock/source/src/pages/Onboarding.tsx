import { useState, type FormEvent } from 'react';
import { db, friendlyError } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { browserTimezone } from '../lib/format';
import { Alert, Button, Field } from '../components/ui';

export function Onboarding() {
  const { refresh } = useAuth();
  const [name, setName] = useState('');
  const [age, setAge] = useState<'under_15' | '15_17' | '18_plus' | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!age) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await db().rpc('complete_onboarding', { p_display_name: name.trim(), p_age_band: age, p_timezone: browserTimezone() });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    setHandle((data as { handle: string }).handle);
  }

  if (handle) {
    return (
      <main className="narrow">
        <h1>Bienvenue 🎉</h1>
        <p>Ton identifiant public est <strong className="handle">{handle}</strong>. Il est unique et ne change jamais ; ton pseudonyme, lui, peut être modifié.</p>
        <p className="muted">Ton adresse e-mail reste privée.</p>
        <Button onClick={() => refresh()}>Entrer dans Tock Tock</Button>
      </main>
    );
  }
  return (
    <main className="narrow">
      <h1>Choisis ton pseudonyme</h1>
      <form onSubmit={submit}>
        <Field id="name" label="Pseudonyme" hint="2 à 30 caractères. Il sera visible des autres membres : pas de nom de famille ni d'information personnelle.">
          <input id="name" required minLength={2} maxLength={30} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} aria-describedby="name-hint" />
        </Field>
        <fieldset>
          <legend>Ton âge (déclaratif)</legend>
          {([['18_plus', '18 ans ou plus'], ['15_17', 'Entre 15 et 17 ans'], ['under_15', 'Moins de 15 ans']] as const).map(([v, l]) => (
            <label key={v} className="check"><input type="radio" name="age" value={v} checked={age === v} onChange={() => setAge(v)} /> {l}</label>
          ))}
          <p className="hint">Cette déclaration n'est pas vérifiée. Elle sert à adapter la protection : pour les moins de 15 ans, la communauté reste fermée tant qu'un accord parental n'est pas prévu ; ton espace privé reste utilisable.</p>
        </fieldset>
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" busy={busy} disabled={!age || name.trim().length < 2}>Créer mon profil</Button>
      </form>
    </main>
  );
}
