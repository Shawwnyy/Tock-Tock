// Tâches de fond quotidiennes (pg_cron) : échéances d'objectifs, purge des fichiers expirés ou abandonnés,
// purge des anciens compteurs. Authentifiée par x-cron-secret.
import { adminClient, readEnv, reply, timingSafeEqual } from '../_shared/edge.ts';

Deno.serve(async (req) => {
  const env = readEnv();
  if (req.method !== 'POST') return reply(req, env, { error: 'method_not_allowed' }, 405);
  if (!env.CRON_SECRET || !timingSafeEqual(req.headers.get('x-cron-secret') ?? '', env.CRON_SECRET)) return reply(req, env, { error: 'unauthorized' }, 401);
  const admin = adminClient(env);
  const out = { goalNotifications: 0, filesPurged: 0, abandonedUploads: 0 };

  const { data: n } = await admin.rpc('enqueue_goal_due_notifications');
  out.goalNotifications = Number(n ?? 0);

  // Uploads abandonnés (jamais finalisés) depuis plus de 24 h
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: stale } = await admin.from('media_assets').select('id,bucket,storage_path').eq('status', 'uploading').lt('created_at', dayAgo).limit(200);
  for (const m of stale ?? []) {
    await admin.storage.from(m.bucket).remove([m.storage_path]);
    await admin.from('media_assets').update({ status: 'deleted', expires_at: new Date().toISOString() }).eq('id', m.id);
    out.abandonedUploads++;
  }

  // Fichiers dont le délai de conservation est dépassé (refusés, supprimés)
  const { data: expired } = await admin.from('media_assets').select('id,bucket,storage_path').in('status', ['rejected', 'deleted']).lt('expires_at', new Date().toISOString()).limit(200);
  for (const m of expired ?? []) {
    const { error } = await admin.storage.from(m.bucket).remove([m.storage_path]);
    if (!error) {
      await admin.from('media_assets').delete().eq('id', m.id);
      out.filesPurged++;
    }
  }

  await admin.from('usage_counters').delete().lt('day', new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10));
  return reply(req, env, out);
});
