// Envoi planifié des chroniques de minuit et des rappels de bilan.
// Appelée toutes les 5 minutes par pg_cron (+ pg_net) avec l'en-tête x-cron-secret. Idempotente : relancer ne duplique rien
// (unicité chronicles(user, date) et chronicle_deliveries(user, date, channel) + réservation atomique côté base).
import { adminClient, readEnv, reply, timingSafeEqual, type Row } from '../_shared/edge.ts';
import { dueChronicleDates, reminderDueDate, localNow } from '../_shared/schedule.ts';
import { produceChronicle, type Settings } from '../_shared/chronicle_service.ts';
import { buildChroniclePdf } from '../_shared/pdf.ts';
import { formatDateFr } from '../_shared/chronicle.ts';
import { chronicleNotifyEmail, chroniclePdfEmail, reminderEmail, sendEmail, emailConfigured } from '../_shared/email.ts';

const BUDGET_MS = 100_000;
const MAX_USERS = 1000;

Deno.serve(async (req) => {
  const env = readEnv();
  if (req.method !== 'POST') return reply(req, env, { error: 'method_not_allowed' }, 405);
  if (!env.CRON_SECRET || !timingSafeEqual(req.headers.get('x-cron-secret') ?? '', env.CRON_SECRET)) return reply(req, env, { error: 'unauthorized' }, 401);

  const admin = adminClient(env);
  const now = new Date();
  const started = Date.now();
  const stats = { users: 0, chronicles: 0, emailsSent: 0, emailsFailed: 0, skipped: 0, reminders: 0, userErrors: 0, truncated: false };
  const appUrl = env.APP_URL ?? '';

  const { data: rows, error } = await admin.from('profile_settings')
    .select('user_id,timezone,chronicle_enabled,chronicle_time,chronicle_email_enabled,chronicle_email_mode,pdf_include_sensitive,no_data_behavior,reminder_enabled,reminder_time,track_pain,ai_consent,ai_use_history,chatbot_access,notification_prefs')
    .or('chronicle_enabled.eq.true,reminder_enabled.eq.true').limit(MAX_USERS);
  if (error) return reply(req, env, { error: 'query_failed' }, 500);

  const ids = (rows ?? []).map((r: Row) => r.user_id as string);
  const profiles = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('profiles').select('id,created_at').in('id', ids.slice(i, i + 200)).not('onboarded_at', 'is', null).is('deactivated_at', null);
    for (const p of data ?? []) profiles.set(p.id as string, p.created_at as string);
  }

  for (const s of rows ?? []) {
    if (Date.now() - started > BUDGET_MS) {
      stats.truncated = true;
      break;
    }
    const userId = s.user_id as string;
    const createdAt = profiles.get(userId);
    if (!createdAt) continue;
    stats.users++;
    try {
      const tz = s.timezone as string;
      const settings: Settings = { timezone: tz, track_pain: s.track_pain, ai_consent: s.ai_consent, ai_use_history: s.ai_use_history, chatbot_access: s.chatbot_access };
      const notifyOk = (s.notification_prefs as Record<string, boolean> | null)?.chronicle !== false;
      let email: string | null | undefined;
      const emailOf = async () => (email ??= (await admin.auth.admin.getUserById(userId)).data.user?.email ?? null);

      // ---------------- Chroniques ----------------
      if (s.chronicle_enabled) {
        const notBefore = localNow(tz, new Date(createdAt)).date;
        const candidates = dueChronicleDates({ timezone: tz, deliveryTime: String(s.chronicle_time).slice(0, 5), now, notBefore });
        if (candidates.length) {
          const { data: dels } = await admin.from('chronicle_deliveries').select('chronicle_date,status,attempts').eq('user_id', userId).eq('channel', 'email').in('chronicle_date', candidates);
          const done = new Set((dels ?? []).filter((d: Row) => d.status === 'sent' || d.status === 'skipped' || (d.status === 'failed' && d.attempts >= 3)).map((d: Row) => d.chronicle_date as string));
          const todo = candidates.filter((d) => !done.has(d)).reverse(); // du plus ancien au plus récent
          for (const date of todo) {
            const { data: existing } = await admin.from('chronicles').select('id,title,sections').eq('user_id', userId).eq('chronicle_date', date).maybeSingle();
            let chronicle = existing ? { title: existing.title as string, sections: existing.sections as Record<string, string>, date } : null;
            if (!chronicle) {
              const made = await produceChronicle({
                db: admin, userId, date, settings, useAi: !!s.ai_consent, aiEnv: env,
                allowAiCall: async () => !!(await admin.rpc('bump_usage', { p_user: userId, p_kind: 'ai_chronicle', p_limit: 3 })).data,
              });
              if (made.chronicle.insufficient && s.no_data_behavior !== 'short') {
                // « nothing » ou « reminder » : aucune chronique fabriquée.
                if (await claim(admin, userId, date, 'email')) {
                  if (s.no_data_behavior === 'reminder' && s.chronicle_email_enabled && emailConfigured(env)) {
                    const to = await emailOf();
                    if (to) await sendEmail(env, reminderEmail(to, appUrl), undefined, `nodata-${userId}-${date}`);
                  }
                  await admin.rpc('finish_chronicle_delivery', { p_user: userId, p_date: date, p_channel: 'email', p_status: 'skipped' });
                }
                stats.skipped++;
                continue;
              }
              const c = made.chronicle;
              const { error: insErr } = await admin.from('chronicles').upsert(
                { user_id: userId, chronicle_date: date, title: c.title, sections: c.sections, source: c.source, status: 'ready', data_used: c.data_used, stats: c.stats, ai_provider: made.ai.provider ?? null },
                { onConflict: 'user_id,chronicle_date', ignoreDuplicates: true },
              );
              if (insErr) throw new Error('chronicle_insert');
              stats.chronicles++;
              chronicle = { title: c.title, sections: c.sections as Record<string, string>, date };
              if (notifyOk) await admin.rpc('create_notification_for_user', { p_user: userId, p_kind: 'chronicle', p_payload: { date } });
            }
            if (!s.chronicle_email_enabled) continue;
            if (!emailConfigured(env)) continue; // pas de fausse livraison : rien n'est marqué « envoyé »
            if (!(await claim(admin, userId, date, 'email'))) continue;
            const to = await emailOf();
            if (!to) {
              await admin.rpc('finish_chronicle_delivery', { p_user: userId, p_date: date, p_channel: 'email', p_status: 'failed', p_error: 'no_email' });
              continue;
            }
            let mail;
            if (s.chronicle_email_mode === 'pdf') {
              const pdf = await buildChroniclePdf(chronicle, { includeSensitive: !!s.pdf_include_sensitive });
              await admin.storage.from('chronicles').upload(`${userId}/${date}.pdf`, pdf, { contentType: 'application/pdf', upsert: true });
              mail = chroniclePdfEmail(to, formatDateFr(date), pdf, `chronique-${date}.pdf`);
            } else {
              mail = chronicleNotifyEmail(to, appUrl);
            }
            const res = await sendEmail(env, mail, undefined, `chronicle-${userId}-${date}`);
            if (res.ok) {
              await admin.rpc('finish_chronicle_delivery', { p_user: userId, p_date: date, p_channel: 'email', p_status: 'sent', p_message_id: res.id });
              stats.emailsSent++;
            } else {
              await admin.rpc('finish_chronicle_delivery', { p_user: userId, p_date: date, p_channel: 'email', p_status: 'failed', p_error: res.error });
              stats.emailsFailed++;
            }
          }
        }
      }

      // ---------------- Rappel de bilan ----------------
      if (s.reminder_enabled && emailConfigured(env) && (s.notification_prefs as Record<string, boolean> | null)?.reminder === true) {
        const date = reminderDueDate({ timezone: tz, reminderTime: String(s.reminder_time).slice(0, 5), now });
        if (date) {
          const { data: has } = await admin.from('checkins').select('id').eq('user_id', userId).eq('checkin_date', date).maybeSingle();
          if (!has && (await claim(admin, userId, date, 'reminder_email'))) {
            const to = await emailOf();
            const res = to ? await sendEmail(env, reminderEmail(to, appUrl), undefined, `reminder-${userId}-${date}`) : ({ ok: false, error: 'no_email' } as const);
            await admin.rpc('finish_chronicle_delivery', { p_user: userId, p_date: date, p_channel: 'reminder_email', p_status: res.ok ? 'sent' : 'failed', p_error: res.ok ? null : res.error, p_message_id: res.ok ? res.id : null });
            if (res.ok) stats.reminders++;
          }
        }
      }
    } catch (_e) {
      // Aucun contenu personnel dans les journaux : seulement un compteur.
      stats.userErrors++;
    }
  }
  return reply(req, env, stats);
});

async function claim(admin: ReturnType<typeof adminClient>, userId: string, date: string, channel: string): Promise<boolean> {
  const { data, error } = await admin.rpc('claim_chronicle_delivery', { p_user: userId, p_date: date, p_channel: channel });
  return !error && data === true;
}
