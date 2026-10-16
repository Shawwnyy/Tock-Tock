// Vérification de FORMAT des identifiants de connexion (e-mail, téléphone) et du code reçu. Fonctions pures, sans réseau.
// Important : un format valide ne prouve PAS que l'adresse ou le numéro existe ni qu'il t'appartient. Seul le code envoyé
// puis vérifié par le serveur d'authentification le prouve. Rien ici ne génère, ne devine ni n'affiche de code.

export type CredentialKind = 'email' | 'phone';
export const OTP_LENGTH = 6; // doit rester égal à [auth.email].otp_length de supabase/config.toml

export type Check<T> = ({ ok: true; value: T } & { hint?: string }) | { ok: false; reason: string };

// Fautes de frappe fréquentes dans les domaines : on SUGGÈRE sans jamais corriger à la place de la personne.
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmailc.om': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.fr.fr': 'hotmail.fr',
  'outlook.con': 'outlook.com', 'outlok.com': 'outlook.com', 'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.fr.fr': 'yahoo.fr',
  'orange.com': 'orange.fr', 'wanadoo.com': 'wanadoo.fr', 'icloud.con': 'icloud.com',
};

export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

export function checkEmail(raw: string): Check<string> {
  const v = normalizeEmail(raw);
  if (!v) return { ok: false, reason: 'Saisis ton adresse e-mail.' };
  if (/\s/.test(v)) return { ok: false, reason: 'Une adresse e-mail ne contient pas d\'espace.' };
  if (v.length > 254) return { ok: false, reason: 'Cette adresse est trop longue.' };
  const at = v.indexOf('@');
  if (at < 0) return { ok: false, reason: 'Il manque le « @ » (exemple : prenom@exemple.fr).' };
  if (at !== v.lastIndexOf('@')) return { ok: false, reason: 'Une adresse e-mail ne contient qu\'un seul « @ ».' };
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (!local) return { ok: false, reason: 'Il manque le début de l\'adresse, avant le « @ ».' };
  if (local.length > 64 || !/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return { ok: false, reason: 'La partie avant le « @ » contient un caractère ou un point non valide.' };
  }
  if (!domain) return { ok: false, reason: 'Il manque le domaine après le « @ » (exemple : exemple.fr).' };
  if (!domain.includes('.')) return { ok: false, reason: 'Il manque la fin du domaine (par exemple « .fr » ou « .com »).' };
  const labels = domain.split('.');
  if (labels.some((l) => !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return { ok: false, reason: 'Le domaine (après le « @ ») n\'est pas valide.' };
  if (!/^[a-z]{2,24}$/.test(labels[labels.length - 1])) return { ok: false, reason: 'La fin du domaine n\'est pas valide (par exemple « .fr » ou « .com »).' };
  const typo = DOMAIN_TYPOS[domain];
  return typo ? { ok: true, value: v, hint: `Tu voulais écrire ${local}@${typo} ?` } : { ok: true, value: v };
}

export interface PhoneValue { e164: string; display: string }

/**
 * Numéro de mobile -> format international E.164 (« +33612345678 »), le seul accepté par les fournisseurs de SMS.
 * Sans « + » ni « 00 », le numéro est lu comme FRANÇAIS. Autres pays : commencer par « + » et l'indicatif.
 * Seul le FORMAT est contrôlé (longueur, préfixe mobile français) : l'existence du numéro n'est pas vérifiable ici.
 */
export function checkPhone(raw: string): Check<PhoneValue> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'Saisis ton numéro de mobile.' };
  if (/[a-z]/i.test(trimmed)) return { ok: false, reason: 'Un numéro ne contient que des chiffres (et éventuellement « + », des espaces, des points ou des tirets).' };
  const compact = trimmed.replace(/[\s.\-()]/g, '');
  if (!/^\+?\d+$/.test(compact)) return { ok: false, reason: 'Caractère non valide dans le numéro. Utilise des chiffres, des espaces, des points ou des tirets.' };

  let digits: string; // chiffres avec indicatif pays, sans « + »
  if (compact.startsWith('+')) digits = compact.slice(1);
  else if (compact.startsWith('00')) digits = compact.slice(2);
  else if (/^0[1-9]\d{8}$/.test(compact)) digits = `33${compact.slice(1)}`; // 06 12 34 56 78
  else if (/^[67]\d{8}$/.test(compact)) digits = `33${compact}`; // 6 12 34 56 78 (le « 0 » a été oublié)
  else {
    return { ok: false, reason: 'Numéro français : 10 chiffres qui commencent par 06 ou 07 (exemple : 06 12 34 56 78). Pour un autre pays, commence par « + » et l\'indicatif (exemple : +32…).' };
  }
  if (digits.startsWith('330')) digits = `33${digits.slice(3)}`; // « +33 06 … » : le 0 en trop est retiré
  if (!/^[1-9]\d{7,14}$/.test(digits)) return { ok: false, reason: 'Un numéro international comporte de 8 à 15 chiffres après le « + » (exemple : +32 470 12 34 56).' };

  if (digits.startsWith('33')) {
    const national = digits.slice(2);
    if (national.length !== 9) return { ok: false, reason: 'Un numéro français comporte 10 chiffres (exemple : 06 12 34 56 78).' };
    if (!/^[67]/.test(national)) {
      return { ok: false, reason: /^[1-5]/.test(national) || national.startsWith('9')
        ? 'Ce numéro est une ligne fixe (ou une box) : elle ne peut pas recevoir de SMS. Utilise un mobile (06 ou 07).'
        : 'Ce numéro n\'est pas un mobile français (06 ou 07).' };
    }
    const n = national;
    return { ok: true, value: { e164: `+${digits}`, display: `+33 ${n[0]} ${n.slice(1, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7, 9)}` } };
  }
  return { ok: true, value: { e164: `+${digits}`, display: `+${digits}` }, hint: 'Format international accepté. Vérifie bien l\'indicatif de ton pays.' };
}

/** Le code se saisit avec ou sans espaces ou tirets (« 123 456 »). Tout autre caractère est refusé. */
export function checkCode(raw: string, length = OTP_LENGTH): Check<string> {
  if (!raw.trim()) return { ok: false, reason: 'Saisis le code reçu.' };
  if (/[^\d\s-]/.test(raw)) return { ok: false, reason: 'Le code ne contient que des chiffres.' };
  const d = raw.replace(/\D/g, '');
  if (d.length < length) return { ok: false, reason: `Le code comporte ${length} chiffres (il en manque ${length - d.length}).` };
  if (d.length > length) return { ok: false, reason: `Trop de chiffres : le code en comporte ${length}.` };
  return { ok: true, value: d };
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '••••';
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}
export function maskPhone(e164: string): string {
  return e164.length <= 6 ? '••••' : `${e164.slice(0, 3)}${'•'.repeat(Math.max(3, e164.length - 5))}${e164.slice(-2)}`;
}

export interface AuthErrorLike { status?: number; code?: string | number; error_code?: string; message?: string; msg?: string }

/**
 * Message FRANÇAIS pour une erreur du serveur d'authentification (GoTrue / Supabase Auth). Volontairement générique :
 * on ne dit jamais si une adresse ou un numéro a déjà un compte (pas d'énumération de comptes).
 */
export function authErrorMessage(err: AuthErrorLike | null | undefined, step: 'send' | 'verify'): string {
  const code = String(err?.error_code ?? (typeof err?.code === 'string' ? err.code : '') ?? '').toLowerCase();
  const text = String(err?.message ?? err?.msg ?? '').toLowerCase();
  const status = err?.status ?? (typeof err?.code === 'number' ? err.code : undefined);
  if (code.includes('rate_limit') || status === 429 || text.includes('rate limit') || text.includes('too many') || text.includes('security purposes')) {
    return 'Trop de demandes. Attends une minute avant de demander un nouveau code.';
  }
  if (text.includes('failed to fetch') || text.includes('networkerror') || text.includes('network request failed') || code === 'network' || code === 'timeout') {
    return 'Connexion impossible. Vérifie ta connexion internet puis réessaie.';
  }
  if (step === 'verify') {
    if (code === 'otp_expired' || status === 403 || status === 400 || status === 422 || text.includes('expired') || text.includes('invalid')) {
      return 'Code incorrect ou expiré. Vérifie le code, ou demande-en un nouveau.';
    }
    return 'La vérification n\'a pas pu aboutir. Réessaie dans un instant.';
  }
  if (code === 'sms_send_failed' || code === 'phone_provider_disabled' || code === 'sms_provider_disabled' || text.includes('sms')) {
    return 'L\'envoi de SMS n\'est pas disponible pour le moment. Utilise ton adresse e-mail.';
  }
  if (code === 'email_provider_disabled' || code === 'signup_disabled' || code === 'otp_disabled') return 'La connexion par ce moyen est désactivée sur ce service.';
  if (code === 'captcha_failed') return 'La vérification anti-robot a échoué. Réessaie.';
  if (code === 'user_banned') return 'Ce compte ne peut pas se connecter pour le moment.';
  return 'Impossible d\'envoyer le code pour le moment. Réessaie dans un instant.';
}
