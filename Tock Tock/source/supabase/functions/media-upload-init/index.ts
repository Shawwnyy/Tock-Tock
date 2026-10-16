// Étape 1 du téléversement : contrôles préalables, création de la fiche média et URL de dépôt signée (temp-uploads).
// Le client n'écrit JAMAIS directement dans un bucket : il dépose dans un espace temporaire, puis media-upload-finalize
// inspecte le contenu réel avant toute publication.
import { adminClient, preflight, readEnv, readJson, reply, userContext, type Row } from '../_shared/edge.ts';
import { checkUploadAllowed, extensionOf, sanitizeDisplayName, type MediaKind } from '../_shared/files.ts';

const KINDS: MediaKind[] = ['image', 'audio', 'video', 'document'];

Deno.serve(async (req) => {
  const env = readEnv();
  const pre = preflight(req, env);
  if (pre) return pre;
  if (req.method !== 'POST') return reply(req, env, { error: 'method_not_allowed' }, 405);
  const ctx = await userContext(req, env);
  if (!ctx) return reply(req, env, { error: 'unauthorized' }, 401);
  const body = await readJson(req);
  if (!body) return reply(req, env, { error: 'invalid_request' }, 400);

  const filename = typeof body.filename === 'string' ? body.filename : '';
  const size = Number(body.size);
  const kind = body.kind as MediaKind;
  const duration = body.durationSeconds === undefined || body.durationSeconds === null ? null : Number(body.durationSeconds);
  const purpose = body.purpose === 'resource' ? 'resource' : 'post';
  if (!filename || !KINDS.includes(kind) || !Number.isFinite(size) || (duration !== null && !Number.isFinite(duration))) return reply(req, env, { error: 'invalid_request' }, 400);
  if (!extensionOf(filename)) return reply(req, env, { error: 'rejected', message: 'Le fichier doit avoir une extension.' }, 422);

  const admin = adminClient(env);
  const uid = ctx.userId;

  // Droits : compte actif, âge, aucune sanction en cours (les médias ne sont pas accessibles sous limitation/suspension/bannissement).
  const [{ data: profile }, { data: settings }, { data: sanctions }] = await Promise.all([
    admin.from('profiles').select('onboarded_at,deactivated_at').eq('id', uid).maybeSingle(),
    admin.from('profile_settings').select('age_band').eq('user_id', uid).maybeSingle(),
    admin.from('sanctions').select('kind,ends_at,starts_at').eq('user_id', uid).is('revoked_at', null),
  ]);
  if (!profile?.onboarded_at || profile.deactivated_at) return reply(req, env, { error: 'not_allowed', message: 'Termine ton inscription avant de partager un fichier.' }, 403);
  if (settings?.age_band === 'under_15') return reply(req, env, { error: 'not_allowed', message: 'Le partage de fichiers n\'est pas disponible pour ton âge déclaré.' }, 403);
  const nowIso = new Date().toISOString();
  if ((sanctions ?? []).some((s: Row) => s.kind === 'ban' || (s.starts_at <= nowIso && s.ends_at > nowIso))) return reply(req, env, { error: 'restricted', message: 'Le partage de fichiers est indisponible pendant une sanction.' }, 403);
  if (purpose === 'resource') return reply(req, env, { error: 'not_allowed' }, 403); // les ressources officielles sont gérées par l'équipe

  const { data: usage } = await admin.rpc('media_usage', { p_user: uid });
  const u = Array.isArray(usage) ? usage[0] : usage;
  const verdict = checkUploadAllowed({ kind, sizeBytes: size, durationSeconds: duration, usage: { bytes: Number(u?.bytes ?? 0), uploadsToday: Number(u?.uploads_today ?? 0) } });
  if (!verdict.ok) return reply(req, env, { error: 'rejected', message: verdict.reason }, 422);

  const id = crypto.randomUUID();
  const path = `${uid}/${id}`; // nom serveur : jamais dérivé du nom de fichier
  const { error: insErr } = await admin.from('media_assets').insert({
    id, owner_id: uid, kind, purpose, display_name: sanitizeDisplayName(filename), bucket: 'temp-uploads', storage_path: path,
    declared_mime: typeof body.mime === 'string' ? body.mime.slice(0, 100) : null, size_bytes: Math.round(size), duration_seconds: duration === null ? null : Math.round(duration), status: 'uploading',
  });
  if (insErr) return reply(req, env, { error: 'init_failed' }, 500);
  const { data: signed, error: signErr } = await admin.storage.from('temp-uploads').createSignedUploadUrl(path);
  if (signErr || !signed) return reply(req, env, { error: 'init_failed' }, 500);
  return reply(req, env, { mediaId: id, path: signed.path, token: signed.token });
});
