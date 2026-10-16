const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

export const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_ANON_KEY = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/** Faux tant que les variables ne sont pas renseignées : l'application affiche alors un écran de configuration honnête. */
export const isConfigured = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;

/** Connexion par SMS : à activer SEULEMENT après avoir configuré un fournisseur de SMS dans Supabase (docs/SETUP.md). */
export const PHONE_LOGIN_ENABLED = (env.VITE_ENABLE_PHONE_LOGIN ?? '').trim() === 'true';
