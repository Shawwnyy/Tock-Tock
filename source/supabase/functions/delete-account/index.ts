// Suppression définitive du compte et des fichiers de la personne (droit à l'effacement).
// Les tables liées à auth.users sont supprimées en cascade par la base ; les fichiers de stockage sont supprimés ici d'abord.
import { adminClient, preflight, readEnv, readJson, reply, userContext, type Row } from '../_shared/edge.ts';

const BUCKETS = ['temp-uploads', 'quarantine', 'community-media', 'private-documents', 'chronicles'];

Deno.serve(async (req) => {
  const env = readEnv();
  const pre = preflight(req, env);
  if (pre) return pre;
  if (req.method !== 'POST') return reply(req, env, { error: 'method_not_allowed' }, 405);
  const ctx = await userContext(req, env);
  if (!ctx) return reply(req, env, { error: 'unauthorized' }, 401);
  const body = await readJson(req);
  if (!body || body.confirm !== 'SUPPRIMER') return reply(req, env, { error: 'confirmation_required', message: 'Tape SUPPRIMER pour confirmer.' }, 400);

  const admin = adminClient(env);
  const uid = ctx.userId;
  for (const bucket of BUCKETS) {
    // Une page de 1000 objets par passage ; on répète tant qu'il en reste.
    for (let guard = 0; guard < 20; guard++) {
      const { data } = await admin.storage.from(bucket).list(uid, { limit: 1000 });
      if (!data?.length) break;
      const { error } = await admin.storage.from(bucket).remove(data.map((o: Row) => `${uid}/${o.name}`));
      if (error) return reply(req, env, { error: 'storage_cleanup_failed' }, 500);
    }
  }
  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) return reply(req, env, { error: 'delete_failed' }, 500);
  return reply(req, env, { deleted: true });
});
