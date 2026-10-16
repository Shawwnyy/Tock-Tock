// E-mails transactionnels via Resend. Les e-mails « notify » ne contiennent AUCUNE donnée personnelle de bien-être :
// ni score, ni humeur, ni extrait de chronique, ni douleur. Seul l'e-mail « pdf » (choisi explicitement) joint un PDF.
export interface EmailEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string; // ex. « Tock Tock <bonjour@votre-domaine.fr> » (domaine vérifié chez Resend)
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Uint8Array }[];
}

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string; retryable: boolean };

export function emailConfigured(env: EmailEnv): boolean {
  return !!(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

export async function sendEmail(env: EmailEnv, mail: OutgoingEmail, fetchImpl?: FetchLike, idempotencyKey?: string): Promise<SendResult> {
  if (!emailConfigured(env)) return { ok: false, error: 'email_not_configured', retryable: false };
  const f: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init) as any);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${env.RESEND_API_KEY}` };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments?.map((a) => ({ filename: a.filename, content: toBase64(a.content) })),
      }),
    });
    if (res.ok) return { ok: true, id: (await res.json())?.id ?? null };
    const detail = (await res.text()).slice(0, 200);
    // 429 (quota Resend gratuit : 100/jour) et 5xx : on réessaiera ; 4xx : inutile.
    return { ok: false, error: `resend_${res.status}: ${detail}`, retryable: res.status === 429 || res.status >= 500 };
  } catch (e) {
    return { ok: false, error: `network: ${(e as Error).message}`.slice(0, 200), retryable: true };
  }
}

const wrapHtml = (body: string) =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2330;line-height:1.5">${body}` +
  `<p style="color:#6b7080;font-size:12px;margin-top:32px">Tu reçois ce message car tu as activé cette option dans les réglages de Tock Tock. Tu peux la désactiver à tout moment.</p></div>`;

export function chronicleNotifyEmail(to: string, appUrl: string): OutgoingEmail {
  const link = appUrl.replace(/\/$/, '') + '/#/historique';
  return {
    to,
    subject: 'Ta chronique de minuit est prête',
    text: `Ta chronique de minuit est prête. Pour la lire, connecte-toi à Tock Tock : ${link}\n\nPour ta vie privée, ce message ne contient aucune de tes données.`,
    html: wrapHtml(`<h2>Ta chronique de minuit est prête</h2><p>Pour la lire, connecte-toi à Tock Tock.</p><p><a href="${escapeHtml(link)}">Ouvrir mes chroniques</a></p><p style="color:#6b7080;font-size:13px">Pour ta vie privée, ce message ne contient aucune de tes données.</p>`),
  };
}

export function chroniclePdfEmail(to: string, dateLabel: string, pdf: Uint8Array, filename: string): OutgoingEmail {
  return {
    to,
    subject: `Ta chronique de minuit — ${dateLabel}`,
    text: 'Ta chronique de minuit est en pièce jointe (PDF). Un e-mail n\'est pas un canal chiffré de bout en bout : ne transfère ce document qu\'à des personnes de confiance.',
    html: wrapHtml('<h2>Ta chronique de minuit</h2><p>Elle est en pièce jointe (PDF).</p><p style="color:#6b7080;font-size:13px">Un e-mail n\'est pas un canal chiffré de bout en bout : ne transfère ce document qu\'à des personnes de confiance.</p>'),
    attachments: [{ filename, content: pdf }],
  };
}

export function reminderEmail(to: string, appUrl: string): OutgoingEmail {
  const link = appUrl.replace(/\/$/, '') + '/#/bilan';
  return {
    to,
    subject: 'Un petit moment pour ton bilan ?',
    text: `Si tu en as envie, ton bilan du jour t'attend : ${link}\nTu peux répondre à une seule question, ou à toutes.`,
    html: wrapHtml(`<h2>Un petit moment pour ton bilan ?</h2><p>Si tu en as envie, tu peux répondre à une seule question, ou à toutes.</p><p><a href="${escapeHtml(link)}">Faire mon bilan</a></p>`),
  };
}
