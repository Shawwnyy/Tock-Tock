// Connexion / inscription par CODE À USAGE UNIQUE reçu par e-mail ou par SMS (aucun mot de passe).
// Ce composant ne génère, ne devine ni n'affiche jamais de code : il n'envoie rien lui-même, il appelle les fonctions
// `send` et `verify` fournies par l'application (Supabase Auth côté serveur) et affiche leur résultat tel quel.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { OTP_LENGTH, checkCode, checkEmail, checkPhone, maskEmail, maskPhone, type CredentialKind } from '../lib/credentials';
import { Alert, Button, Field } from './ui';

export type AuthResult = { ok: true } | { ok: false; message: string };

export interface OtpFlowProps {
  send: (kind: CredentialKind, value: string) => Promise<AuthResult>;
  verify: (kind: CredentialKind, value: string, code: string) => Promise<AuthResult>;
  /** Appelé quand le serveur a confirmé le code. `masked` est une version masquée de l'identifiant (jamais l'identifiant complet). */
  onVerified?: (kind: CredentialKind, masked: string) => void;
  phoneEnabled?: boolean;
  /** Faux si aucun serveur n'est relié : le formulaire contrôle le format mais n'envoie rien (et le dit). */
  available?: boolean;
  expiryMinutes?: number;
  resendSeconds?: number;
  maxAttempts?: number;
  /** « signup » : l'écran vient de « S'inscrire » ; « signin » : de « Se connecter ». Le déroulé est le même (le compte est créé à la validation du code). */
  intent?: 'signin' | 'signup';
}

export function OtpFlow({ send, verify, onVerified, phoneEnabled = true, available = true, expiryMinutes = 10, resendSeconds = 60, maxAttempts = 5, intent }: OtpFlowProps) {
  const [kind, setKind] = useState<CredentialKind>('email');
  const [step, setStep] = useState<'identify' | 'code'>('identify');
  const [raw, setRaw] = useState('');
  const [touched, setTouched] = useState(false);
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [target, setTarget] = useState<{ kind: CredentialKind; value: string; shown: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [failures, setFailures] = useState(0);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  const emailCheck = kind === 'email' ? checkEmail(raw) : null;
  const phoneCheck = kind === 'phone' ? checkPhone(raw) : null;
  const check = emailCheck ?? phoneCheck!;
  const showProblem = touched && !check.ok;
  const codeCheck = checkCode(code);
  const showCodeProblem = codeTouched && !codeCheck.ok;
  const locked = failures >= maxAttempts;

  function switchKind(k: CredentialKind) { setKind(k); setRaw(''); setTouched(false); setError(null); setInfo(null); }

  async function submitIdentify(e?: FormEvent) {
    e?.preventDefault();
    if (busy || cooldown > 0) return;
    setTouched(true);
    setError(null);
    if (!check.ok) { inputRef.current?.focus(); return; }
    if (!available) return;
    const value = kind === 'email' ? (check.value as string) : (check.value as { e164: string }).e164;
    const shown = kind === 'email' ? maskEmail(value) : maskPhone(value);
    setBusy(true);
    const r = await send(kind, value);
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    setTarget({ kind, value, shown });
    setStep('code');
    setCode(''); setCodeTouched(false); setFailures(0); setCooldown(resendSeconds);
    setInfo(null);
  }

  async function resend() {
    if (!target || busy || cooldown > 0) return;
    setBusy(true); setError(null);
    const r = await send(target.kind, target.value);
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    setCode(''); setCodeTouched(false); setFailures(0); setCooldown(resendSeconds);
    setInfo('Un nouveau code vient d\'être demandé. Utilise le dernier code reçu.');
    codeRef.current?.focus();
  }

  async function submitCode(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !target || locked) return;
    setCodeTouched(true);
    setError(null); setInfo(null);
    if (!codeCheck.ok) { codeRef.current?.focus(); return; }
    setBusy(true);
    const r = await verify(target.kind, target.value, codeCheck.value);
    setBusy(false);
    if (!r.ok) { setFailures((n) => n + 1); setError(r.message); setCode(''); codeRef.current?.focus(); return; }
    setDone(true);
    onVerified?.(target.kind, target.shown);
  }

  if (done && target) {
    return <Alert kind="success"><strong>Code vérifié.</strong> {target.kind === 'email' ? 'Ton adresse' : 'Ton numéro'} {target.shown} est confirmé{target.kind === 'email' ? 'e' : ''}.</Alert>;
  }

  if (step === 'code' && target) {
    return (
      <form onSubmit={submitCode} noValidate aria-label="Saisie du code reçu">
        <p>{target.kind === 'email'
          ? <>Si l'adresse <strong>{target.shown}</strong> est correcte, un e-mail avec un code à {OTP_LENGTH} chiffres vient de partir. Pense à regarder tes courriers indésirables.</>
          : <>Si le numéro <strong>{target.shown}</strong> est correct, un SMS avec un code à {OTP_LENGTH} chiffres vient de partir. Il peut mettre une minute à arriver.</>}</p>
        <Field id="otp" label={`Code à ${OTP_LENGTH} chiffres`} hint={`Le code expire au bout de ${expiryMinutes} minutes et ne sert qu'une fois. Ne le partage avec personne : personne de Tock Tock ne te le demandera jamais.`}>
          <input id="otp" ref={codeRef} inputMode="numeric" autoComplete="one-time-code" maxLength={OTP_LENGTH + 4} value={code} disabled={locked}
            aria-invalid={showCodeProblem || undefined} aria-describedby={showCodeProblem ? 'otp-problem otp-hint' : 'otp-hint'}
            onChange={(e) => { setCode(e.target.value); setError(null); }} onBlur={() => setCodeTouched(code.length > 0)} />
        </Field>
        {showCodeProblem && !codeCheck.ok && <p className="hint field-problem" id="otp-problem" role="alert">{codeCheck.reason}</p>}
        {error && <Alert kind="error">{error}</Alert>}
        {info && <Alert>{info}</Alert>}
        {locked && <Alert kind="warn">Trop d'essais avec ce code. Demande un nouveau code pour continuer.</Alert>}
        <div className="row">
          <Button type="submit" busy={busy} disabled={locked}>Valider le code</Button>
          <Button type="button" variant="ghost" onClick={resend} disabled={cooldown > 0 || busy}>{cooldown > 0 ? `Renvoyer un code dans ${cooldown} s` : 'Renvoyer un code'}</Button>
          <Button type="button" variant="ghost" onClick={() => { setStep('identify'); setCode(''); setError(null); setInfo(null); setFailures(0); }}>{target.kind === 'email' ? 'Changer d\'adresse' : 'Changer de numéro'}</Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitIdentify} noValidate aria-label="Connexion ou inscription">
      {phoneEnabled && (
        <div className="tabs" role="tablist" aria-label="Moyen de connexion">
          {(['email', 'phone'] as const).map((k) => (
            <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={kind === k} aria-controls="auth-panel" className={`tab ${kind === k ? 'on' : ''}`} onClick={() => switchKind(k)}>{k === 'email' ? 'E-mail' : 'Téléphone'}</button>
          ))}
        </div>
      )}
      <div id="auth-panel" role={phoneEnabled ? 'tabpanel' : undefined} aria-labelledby={phoneEnabled ? `tab-${kind}` : undefined}>
        {kind === 'email' ? (
          <Field id="identifier" label="Ton adresse e-mail" hint="Tu reçois un code à usage unique. Pas de mot de passe à retenir. Ton adresse n'est jamais visible par les autres membres.">
            <input id="identifier" ref={inputRef} type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={raw}
              aria-invalid={showProblem || undefined} aria-describedby={showProblem ? 'identifier-problem identifier-hint' : 'identifier-hint'}
              onChange={(e) => setRaw(e.target.value)} onBlur={() => setTouched(raw.length > 0)} />
          </Field>
        ) : (
          <Field id="identifier" label="Ton numéro de mobile" hint="Numéro français : 06 12 34 56 78. Autre pays : commence par « + » et l'indicatif (exemple : +32 470 12 34 56). Un seul SMS, qui ne contient que le code.">
            <input id="identifier" ref={inputRef} type="tel" autoComplete="tel" inputMode="tel" value={raw}
              aria-invalid={showProblem || undefined} aria-describedby={showProblem ? 'identifier-problem identifier-hint' : 'identifier-hint'}
              onChange={(e) => setRaw(e.target.value)} onBlur={() => setTouched(raw.length > 0)} />
          </Field>
        )}
        {showProblem && !check.ok && <p className="hint field-problem" id="identifier-problem" role="alert">{check.reason}</p>}
        {check.ok && raw.trim() && (
          <p className="hint field-good" role="status">
            ✓ Format valide{kind === 'phone' ? <> : le code sera envoyé au <strong>{(check.value as { display: string }).display}</strong></> : ''}.{check.hint ? ` ${check.hint}` : ''}
          </p>
        )}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {!available && <Alert kind="warn"><strong>Envoi de code indisponible ici.</strong> Cette version n'est reliée à aucun serveur : elle peut contrôler le format, mais ne peut envoyer ni vérifier aucun code. Rien n'est simulé.</Alert>}
      <p className="muted">{intent === 'signup' ? 'Un compte est créé automatiquement quand tu valides le code. Si cette adresse ou ce numéro en a déjà un, tu y seras simplement connecté.' : intent === 'signin' ? 'Si tu n\'as pas encore de compte, il sera créé automatiquement quand tu valides le code.' : 'Pas encore de compte ? Il est créé automatiquement quand tu valides le code.'}</p>
      <Button type="submit" busy={busy} disabled={!available || cooldown > 0}>{!available ? 'Envoi indisponible (hors ligne)' : cooldown > 0 ? `Nouveau code possible dans ${cooldown} s` : 'Recevoir mon code'}</Button>
    </form>
  );
}
