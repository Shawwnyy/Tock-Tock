export function Setup() {
  return (
    <main className="narrow">
      <h1>Tock Tock — configuration requise</h1>
      <p>
        Cette application n'est pas encore reliée à une base de données. <strong>Rien ne fonctionne en mode démonstration</strong> : aucune
        donnée n'est simulée et aucun compte ne peut être créé tant que la configuration n'est pas faite.
      </p>
      <ol>
        <li>Créez un projet Supabase gratuit.</li>
        <li>Appliquez les migrations du dossier <code>supabase/migrations</code> (voir <code>docs/SETUP.md</code>).</li>
        <li>Copiez <code>.env.example</code> en <code>.env</code> et renseignez <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_ANON_KEY</code>.</li>
        <li>Relancez l'application (<code>npm run dev</code>) ou, pour GitHub Pages, ajoutez ces deux valeurs dans les « variables » du dépôt.</li>
      </ol>
      <p className="muted">Les clés secrètes (service_role, Resend, IA) ne vont jamais dans l'interface : voir la documentation.</p>
    </main>
  );
}
