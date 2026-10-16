// Utilitaires communs aux Edge Functions (Deno). Aucune logique métier ici.
import { createClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CRON_SECRET?: string;
  APP_URL?: string;
  ALLOWED_ORIGINS?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  AI_PROVIDER?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  AI_BASE_URL?: string;
}

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;

export function readEnv(): Env {
  const get = (k: string) => Deno.env.get(k) ?? undefined;
  const env: Env = {
    SUPABASE_URL: get('SUPABASE_URL') ?? '',
    SUPABASE_ANON_KEY: get('SUPABASE_ANON_KEY') ?? '',
    SUPABASE_SERVICE_ROLE_KEY: get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  };
  env.CRON_SECRET = get('CRON_SECRET');
  env.APP_URL = get('APP_URL');
  env.ALLOWED_ORIGINS = get('ALLOWED_ORIGINS');
  env.RESEND_API_KEY = get('RESEND_API_KEY');
  env.EMAIL_FROM = get('EMAIL_FROM');
  env.AI_PROVIDER = get('AI_PROVIDER');
  env.AI_API_KEY = get('AI_API_KEY');
  env.AI_MODEL = get('AI_MODEL');
  env.AI_BASE_URL = get('AI_BASE_URL');
  return env;
}

/** CORS : uniquement les origines listées dans ALLOWED_ORIGINS (ex. https://moi.github.io). Jamais « * ». */
export function corsFor(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const h: Record<string, string> = { vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    h['access-control-allow-origin'] = origin;
    h['access-control-allow-headers'] = 'authorization, content-type, apikey, x-client-info';
    h['access-control-allow-methods'] = 'POST, OPTIONS';
  }
  return h;
}

export function reply(req: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsFor(req, env) } });
}

export function preflight(req: Request, env: Env): Response | null {
  return req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: corsFor(req, env) }) : null;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function adminClient(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Client « au nom de la personne » : la RLS s'applique. Renvoie null si le jeton est absent ou invalide. */
export async function userContext(req: Request, env: Env) {
  const auth = req.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  if (!token) return null;
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  return { db, userId: data.user.id, email: data.user.email ?? null };
}

export async function readJson(req: Request, maxBytes = 20_000): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
