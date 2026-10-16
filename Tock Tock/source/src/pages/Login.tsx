import { OtpFlow, type AuthResult } from '../components/OtpFlow';
import { PHONE_LOGIN_ENABLED } from '../config';
import { authErrorMessage, type CredentialKind } from '../lib/credentials';
import { db } from '../lib/supabase';

// Les codes sont envoyés ET vérifiés par Supabase Auth : l'interface ne les voit, ne les génère et ne les compare jamais.
async function send(kind: CredentialKind, value: string): Promise<AuthResult> {
  const { error } = kind === 'email'
    ? await db().auth.signInWithOtp({ email: value, options: { shouldCreateUser: true } })
    : await db().auth.signInWithOtp({ phone: value, options: { shouldCreateUser: true, channel: 'sms' } });
  return error ? { ok: false, message: authErrorMessage(error as never, 'send') } : { ok: true };
}

async function verify(kind: CredentialKind, value: string, token: string): Promise<AuthResult> {
  const { error } = kind === 'email'
    ? await db().auth.verifyOtp({ email: value, token, type: 'email' })
    : await db().auth.verifyOtp({ phone: value, token, type: 'sms' });
  return error ? { ok: false, message: authErrorMessage(error as never, 'verify') } : { ok: true };
}

export function Login() {
  return (
    <main className="narrow">
      <h1>Tock Tock</h1>
      <p className="lead">Ton espace privé pour faire le point, avancer à ton rythme et partager avec bienveillance.</p>
      <h2>Connexion ou inscription</h2>
      <OtpFlow send={send} verify={verify} phoneEnabled={PHONE_LOGIN_ENABLED} />
    </main>
  );
}
