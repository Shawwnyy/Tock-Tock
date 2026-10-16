// Client minimal du serveur d'authentification (GoTrue / Supabase Auth) pour la version locale : deux appels HTTP, pas de bibliothèque.
//  POST {url}/auth/v1/otp     -> le SERVEUR envoie le code par e-mail ou par SMS
//  POST {url}/auth/v1/verify  -> le SERVEUR vérifie le code
// Ce fichier ne génère, ne devine ni ne compare jamais de code. Le jeton de session renvoyé est IGNORÉ et jamais stocké.
import { authErrorMessage, type CredentialKind } from '../lib/credentials';
import type { AuthResult } from '../components/OtpFlow';

export interface AuthServer { url: string; key: string }

// Remplacé à la fabrication par scripts/build-standalone.mjs (variables TOCK_AUTH_URL / TOCK_AUTH_KEY) ; absent = hors ligne.
declare const __TOCK_AUTH__: AuthServer | null | undefined;
export const authServer: AuthServer | null = typeof __TOCK_AUTH__ !== 'undefined' && __TOCK_AUTH__ ? __TOCK_AUTH__ : null;

type Fetch = typeof fetch;

async function call(srv: AuthServer, path: string, body: unknown, f: Fetch, step: 'send' | 'verify'): Promise<AuthResult> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
  try {
    const res = await f(`${srv.url.replace(/\/$/, '')}/auth/v1/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: srv.key, Authorization: `Bearer ${srv.key}` },
      body: JSON.stringify(body), signal: ctl?.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (res.ok) return { ok: true };
    let detail: Record<string, unknown> = {};
    try { detail = (await res.json()) as Record<string, unknown>; } catch { /* corps vide ou non JSON */ }
    return { ok: false, message: authErrorMessage({ status: res.status, error_code: String(detail.error_code ?? ''), code: detail.code as never, msg: String(detail.msg ?? detail.message ?? detail.error_description ?? '') }, step) };
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError';
    return { ok: false, message: authErrorMessage({ error_code: aborted ? 'timeout' : 'network', message: String((e as Error)?.message ?? e) }, step) };
  } finally { if (timer) clearTimeout(timer); }
}

export const sendCode = (srv: AuthServer, kind: CredentialKind, value: string, f: Fetch = fetch): Promise<AuthResult> =>
  call(srv, 'otp', kind === 'email' ? { email: value, create_user: true } : { phone: value, create_user: true, channel: 'sms' }, f, 'send');

export const verifyCode = (srv: AuthServer, kind: CredentialKind, value: string, token: string, f: Fetch = fetch): Promise<AuthResult> =>
  call(srv, 'verify', kind === 'email' ? { type: 'email', email: value, token } : { type: 'sms', phone: value, token }, f, 'verify');
