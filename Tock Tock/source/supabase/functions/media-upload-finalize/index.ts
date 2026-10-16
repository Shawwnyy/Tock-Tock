// Étape 2 : lecture du fichier déposé, détection du type RÉEL, empreinte, renommage, puis
//   - invalide  -> supprimé (rejected) ; suspect -> quarantaine ;
//   - valide    -> déplacé vers community-media sous un nom généré, statut « pending_review » (pré-modération humaine).
// Aucune approbation automatique. Un antivirus externe peut être branché ici (voir `scanFile`).
import { adminClient, isUuid, preflight, readEnv, readJson, reply, userContext } from '../_shared/edge.ts';
import { decideMediaStatus, detectFile, maxBytesFor, DEFAULT_LIMITS, storagePathFor, type ScanOutcome } from '../_shared/files.ts';

// Point d'extension : appeler ici un service d'analyse (ClamAV via HTTP, VirusTotal…) et renvoyer son verdict.
// Tant qu'aucun fournisseur n'est configuré, on renvoie { provider: 'none' } et la relecture humaine est obligatoire.
// deno-lint-ignore require-await
async function scanFile(_bytes: Uint8Array, _env: object): Promise<ScanOutcome> {
  return { provider: 'none' };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req) => {
  const env = readEnv();
  const pre = preflight(req, env);
  if (pre) return pre;
  if (req.method !== 'POST') return reply(req, env, { error: 'method_not_allowed' }, 405);
  const ctx = await userContext(req, env);
  if (!ctx) return reply(req, env, { error: 'unauthorized' }, 401);
  const body = await readJson(req);
  if (!body || !isUuid(body.mediaId)) return reply(req, env, { error: 'invalid_request' }, 400);

  const admin = adminClient(env);
  const { data: m } = await admin.from('media_assets').select('*').eq('id', body.mediaId).eq('owner_id', ctx.userId).eq('status', 'uploading').maybeSingle();
  if (!m) return reply(req, env, { error: 'unknown_media' }, 404);

  const fail = async (status: 'rejected' | 'quarantined', reasons: string[], bucket: string, path: string) => {
    await admin.from('media_assets').update({ status, bucket, storage_path: path, scan_result: { reasons }, expires_at: status === 'rejected' ? new Date(Date.now() + 7 * 86400_000).toISOString() : null }).eq('id', m.id);
    return reply(req, env, { status, reasons }, 422);
  };

  const { data: blob, error: dlErr } = await admin.storage.from('temp-uploads').download(m.storage_path);
  if (dlErr || !blob) return reply(req, env, { error: 'file_missing', message: 'Le fichier n\'a pas été déposé.' }, 409);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const limit = maxBytesFor(m.kind, DEFAULT_LIMITS);
  if (bytes.length > limit || bytes.length !== Number(m.size_bytes)) {
    await admin.storage.from('temp-uploads').remove([m.storage_path]);
    return fail('rejected', ['La taille du fichier ne correspond pas à celle annoncée, ou dépasse la limite.'], 'temp-uploads', m.storage_path);
  }

  const detection = detectFile(bytes, m.display_name, m.declared_mime);
  if (detection.ok && detection.kind !== m.kind) {
    detection.ok = false;
    detection.reasons.push(`Le contenu est de type « ${detection.kind} » alors que « ${m.kind} » était annoncé.`);
  }
  const scan = await scanFile(bytes, env);
  const decision = decideMediaStatus({ detection, scan });
  const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));

  if (decision.status === 'rejected') {
    await admin.storage.from('temp-uploads').remove([m.storage_path]);
    return fail('rejected', decision.reasons, 'temp-uploads', m.storage_path);
  }

  const ext = detection.ext ?? 'bin';
  const finalPath = storagePathFor(ctx.userId, m.id, ext);
  const targetBucket = decision.status === 'quarantined' ? 'quarantine' : 'community-media';
  const { error: upErr } = await admin.storage.from(targetBucket).upload(finalPath, bytes, { contentType: detection.mime ?? 'application/octet-stream', upsert: false });
  if (upErr) return reply(req, env, { error: 'finalize_failed' }, 500);
  await admin.storage.from('temp-uploads').remove([m.storage_path]);

  if (decision.status === 'quarantined') return fail('quarantined', decision.reasons, 'quarantine', finalPath);

  const { error } = await admin.from('media_assets').update({
    status: 'pending_review', bucket: 'community-media', storage_path: finalPath, detected_mime: detection.mime, sha256,
    scan_result: { provider: scan.provider, notes: decision.reasons },
  }).eq('id', m.id);
  if (error) return reply(req, env, { error: 'finalize_failed' }, 500);
  return reply(req, env, { status: 'pending_review', mediaId: m.id, message: 'Fichier reçu. Il sera visible après relecture par l\'équipe de modération.' });
});
