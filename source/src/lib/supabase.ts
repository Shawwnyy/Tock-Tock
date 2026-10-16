import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';

export const supabase: SupabaseClient | null = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  : null;

export function db(): SupabaseClient {
  if (!supabase) throw new Error('Supabase n\'est pas configuré.');
  return supabase;
}

/** Appel d'une Edge Function avec le jeton de la personne. */
export async function callFunction<T = Record<string, unknown>>(name: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const { data: sess } = await db().auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${sess.session?.access_token ?? ''}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    /* corps vide */
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

/** Message d'erreur lisible à partir d'une erreur Postgres/Supabase (les codes techniques ne sont pas montrés). */
export function friendlyError(e: unknown): string {
  const m = ((e as { message?: string })?.message ?? String(e ?? '')).toLowerCase();
  if (m.includes('rate') || m.includes('too_many')) return 'Trop de tentatives. Patiente un peu avant de réessayer.';
  if (m.includes('posting_limit') || m.includes('max_per')) return 'Tu as atteint la limite pour aujourd\'hui. Réessaie plus tard.';
  if (m.includes('restricted') || m.includes('permission') || m.includes('row-level security')) return 'Cette action n\'est pas disponible pour ton compte pour le moment.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Connexion impossible. Vérifie ta connexion internet.';
  if (m.includes('explanation_required')) return 'Une explication d\'au moins 10 caractères est nécessaire.';
  if (m.includes('display_name')) return 'Ce pseudonyme n\'est pas disponible ou n\'est pas autorisé.';
  return 'Une erreur est survenue. Réessaie dans un instant.';
}
