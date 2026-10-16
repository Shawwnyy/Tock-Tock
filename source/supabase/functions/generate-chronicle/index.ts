// Génération (ou régénération) d'une chronique à la demande, pour la personne connectée uniquement.
// Les lectures passent par le client de la personne : la RLS garantit qu'on ne lit que SES données.
import { adminClient, isDate, preflight, readEnv, readJson, reply, userContext } from '../_shared/edge.ts';
import { produceChronicle } from '../_shared/chronicle_service.ts';
import { addDays } from '../_shared/stats.ts';
import { localNow } from '../_shared/schedule.ts';

Deno.serve(async (req) => {
  const env = readEnv();
  const pre = preflight(req, env);
  if (pre) return pre;
  if (req.method !== 'POST') return reply(req, env, { error: 'method_not_allowed' }, 405);
  const ctx = await userContext(req, env);
  if (!ctx) return reply(req, env, { error: 'unauthorized' }, 401);
  const body = await readJson(req);
  if (!body || !isDate(body.date)) return reply(req, env, { error: 'invalid_request' }, 400);

  const { db, userId } = ctx;
  const { data: settings } = await db.from('profile_settings').select('timezone,track_pain,ai_consent,ai_use_history,chatbot_access').eq('user_id', userId).maybeSingle();
  if (!settings) return reply(req, env, { error: 'profile_incomplete' }, 409);
  const today = localNow(settings.timezone, new Date()).date;
  if (body.date > today || body.date < addDays(today, -400)) return reply(req, env, { error: 'date_out_of_range' }, 400);

  const { data: existing } = await db.from('chronicles').select('*').eq('user_id', userId).eq('chronicle_date', body.date).maybeSingle();
  if (existing && body.regenerate !== true) return reply(req, env, { chronicle: existing, existing: true, stored: true });
  if (existing?.status === 'edited' && body.confirmOverwrite !== true) {
    return reply(req, env, { error: 'edited_chronicle', message: 'Cette chronique a été modifiée par toi. Confirme pour la remplacer.' }, 409);
  }

  const admin = adminClient(env);
  const made = await produceChronicle({
    db, userId, date: body.date, settings, useAi: body.useAi === true, aiEnv: env,
    allowAiCall: async () => !!(await admin.rpc('bump_usage', { p_user: userId, p_kind: 'ai_chronicle', p_limit: 5 })).data,
  });
  const c = made.chronicle;
  if (c.insufficient) return reply(req, env, { chronicle: c, stored: false, ai: made.ai, message: 'Données insuffisantes : aucune chronique n\'a été créée.' });

  const row = { user_id: userId, chronicle_date: body.date, title: c.title, sections: c.sections, source: c.source, status: 'ready', data_used: c.data_used, stats: c.stats, ai_provider: made.ai.provider ?? null };
  const { data: saved, error } = await db.from('chronicles').upsert(row, { onConflict: 'user_id,chronicle_date' }).select('*').single();
  if (error) return reply(req, env, { error: 'save_failed' }, 500);
  return reply(req, env, { chronicle: saved, stored: true, ai: made.ai });
});
