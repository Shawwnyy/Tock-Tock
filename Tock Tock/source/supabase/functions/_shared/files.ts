// Validation des fichiers téléversés : le type est déterminé par le CONTENU (octets magiques), jamais par le nom ni
// par le type annoncé par le navigateur. Tout est renommé côté serveur (identifiant aléatoire + extension de la liste blanche).
//
// Limites assumées : aucune analyse antivirus ici. Les fichiers valides passent en « relecture humaine » (pré-modération) ;
// un antivirus/modérateur d'images externe peut être branché via `ScanOutcome` (voir docs/SETUP.md). Sans lui, RIEN n'est
// approuvé automatiquement.

export type MediaKind = 'image' | 'audio' | 'video' | 'document';

export interface Detection {
  ok: boolean;
  kind?: MediaKind;
  mime?: string;
  ext?: string;
  /** Raisons de rejet (affichables). */
  reasons: string[];
  /** Fichier techniquement lisible mais suspect : à placer en quarantaine plutôt que rejeter silencieusement. */
  suspicious: boolean;
}

const eq = (b: Uint8Array, off: number, sig: number[]) => sig.every((v, i) => b[off + i] === v);
const ascii = (b: Uint8Array, off: number, s: string) => s.split('').every((c, i) => b[off + i] === c.charCodeAt(0));

interface Sig {
  kind: MediaKind;
  mime: string;
  ext: string;
}

function sniff(b: Uint8Array): Sig | null {
  if (b.length < 12) return null;
  if (eq(b, 0, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (eq(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')) return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav', ext: 'wav' };
  if (ascii(b, 0, 'OggS')) return { kind: 'audio', mime: 'audio/ogg', ext: 'ogg' };
  if (ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' };
  if (ascii(b, 4, 'ftyp')) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === 'M4A ' || brand === 'M4B ') return { kind: 'audio', mime: 'audio/mp4', ext: 'm4a' };
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime', ext: 'mov' };
    if (/^(isom|iso2|mp41|mp42|avc1|M4V |dash|MSNV)/.test(brand)) return { kind: 'video', mime: 'video/mp4', ext: 'mp4' };
    return null;
  }
  if (eq(b, 0, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', mime: 'video/webm', ext: 'webm' }; // audio/webm possible : traité comme vidéo, durée déclarée
  if (ascii(b, 0, '%PDF-')) return { kind: 'document', mime: 'application/pdf', ext: 'pdf' };
  return null;
}

const FORBIDDEN_HEADERS: { name: string; test: (b: Uint8Array) => boolean }[] = [
  { name: 'exécutable Windows/DOS', test: (b) => ascii(b, 0, 'MZ') },
  { name: 'exécutable Linux', test: (b) => eq(b, 0, [0x7f, 0x45, 0x4c, 0x46]) },
  { name: 'exécutable macOS', test: (b) => eq(b, 0, [0xcf, 0xfa, 0xed, 0xfe]) || eq(b, 0, [0xca, 0xfe, 0xba, 0xbe]) },
  { name: 'script', test: (b) => ascii(b, 0, '#!') },
  { name: 'archive ZIP/Office/APK', test: (b) => ascii(b, 0, 'PK') && (b[2] === 3 || b[2] === 5) },
  { name: 'archive RAR/7z/gzip', test: (b) => ascii(b, 0, 'Rar!') || eq(b, 0, [0x37, 0x7a, 0xbc, 0xaf]) || eq(b, 0, [0x1f, 0x8b]) },
];

const TEXT_MARKERS = /<\s*(script|html|svg|iframe|object|embed|\?php)\b|<\?xml|javascript:|onerror\s*=|onload\s*=/i;
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|OpenAction|AA|EmbeddedFile|RichMedia|XFA|SubmitForm|URI)\b/;

function latin1(b: Uint8Array, max: number): string {
  let s = '';
  const n = Math.min(b.length, max);
  for (let i = 0; i < n; i += 8192) s += String.fromCharCode(...b.subarray(i, Math.min(n, i + 8192)));
  return s;
}

export function extensionOf(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim());
  return m ? m[1].toLowerCase() : '';
}

const EXT_ALIASES: Record<string, string[]> = {
  jpg: ['jpg', 'jpeg'], png: ['png'], gif: ['gif'], webp: ['webp'], wav: ['wav'], ogg: ['ogg', 'oga', 'opus'], mp3: ['mp3'],
  m4a: ['m4a', 'mp4', 'm4b'], mp4: ['mp4', 'm4v'], mov: ['mov'], webm: ['webm', 'weba'], pdf: ['pdf'],
};

/** Analyse le contenu d'un fichier et le compare au nom/type annoncés. */
export function detectFile(bytes: Uint8Array, filename: string, declaredMime?: string | null): Detection {
  const reasons: string[] = [];
  if (bytes.length === 0) return { ok: false, reasons: ['Fichier vide.'], suspicious: false };

  for (const f of FORBIDDEN_HEADERS) if (f.test(bytes)) return { ok: false, reasons: [`Type de fichier interdit (${f.name}).`], suspicious: true };

  const head = latin1(bytes, 4096);
  if (/^\s*(<\?xml|<svg|<!doctype|<html|<script)/i.test(head)) return { ok: false, reasons: ['Fichier texte/HTML/SVG interdit (risque de script).'], suspicious: true };

  const sig = sniff(bytes);
  if (!sig) return { ok: false, reasons: ['Type de fichier non reconnu ou non autorisé (images JPEG/PNG/GIF/WebP, audio MP3/WAV/OGG/M4A, vidéo MP4/WebM/MOV, PDF).'], suspicious: false };

  // Nom/extension annoncés vs contenu réel
  const ext = extensionOf(filename);
  if (!ext) reasons.push('Le fichier n\'a pas d\'extension.');
  else if (!(EXT_ALIASES[sig.ext] ?? [sig.ext]).includes(ext)) reasons.push(`L'extension « .${ext} » ne correspond pas au contenu réel (${sig.mime}).`);
  if (declaredMime) {
    const d = declaredMime.toLowerCase().split(';')[0].trim();
    const family = d.split('/')[0];
    if (d !== sig.mime && !(family === sig.kind && ['audio', 'video'].includes(family) && ['audio', 'video'].includes(sig.kind)) && d !== 'application/octet-stream') {
      reasons.push(`Le type annoncé (${d}) ne correspond pas au contenu réel (${sig.mime}).`);
    }
  }

  // Polyglottes / contenu actif
  let suspicious = false;
  const body = latin1(bytes, 2_000_000);
  if (sig.kind === 'document') {
    if (PDF_ACTIVE.test(body)) {
      reasons.push('Le PDF contient du contenu actif (JavaScript, lancement, pièce jointe…).');
      suspicious = true;
    }
  } else if (TEXT_MARKERS.test(body)) {
    reasons.push('Le fichier contient du code web caché (polyglotte).');
    suspicious = true;
  }

  if (reasons.length) return { ok: false, kind: sig.kind, mime: sig.mime, ext: sig.ext, reasons, suspicious };
  return { ok: true, kind: sig.kind, mime: sig.mime, ext: sig.ext, reasons: [], suspicious: false };
}

/** Nom d'affichage : jamais utilisé comme chemin. Retire chemins, caractères de contrôle et inversions de texte. */
export function sanitizeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  const out = cleaned.length > 100 ? cleaned.slice(-100) : cleaned;
  return out || 'fichier';
}

/** Chemin de stockage généré par le serveur : <proprietaire>/<uuid>.<ext>. */
export function storagePathFor(ownerId: string, uuid: string, ext: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(ownerId) || !/^[0-9a-f-]{36}$/i.test(uuid) || !/^[a-z0-9]{2,4}$/.test(ext)) throw new Error('Paramètres de chemin invalides.');
  return `${ownerId}/${uuid}.${ext}`;
}

// ---------------------------------------------------------------------------
// Limites (miroir de la table app_config) et vérification avant dépôt
// ---------------------------------------------------------------------------
export interface MediaLimits {
  maxImageBytes: number;
  maxAudioBytes: number;
  maxVideoBytes: number;
  maxDocumentBytes: number;
  maxAudioSeconds: number;
  maxVideoSeconds: number;
  quotaBytesPerUser: number;
  maxUploadsPerDay: number;
}

export const DEFAULT_LIMITS: MediaLimits = {
  maxImageBytes: 5 * 1024 * 1024,
  maxAudioBytes: 15 * 1024 * 1024,
  maxVideoBytes: 50 * 1024 * 1024,
  maxDocumentBytes: 10 * 1024 * 1024,
  maxAudioSeconds: 600,
  maxVideoSeconds: 120,
  quotaBytesPerUser: 100 * 1024 * 1024,
  maxUploadsPerDay: 20,
};

export function maxBytesFor(kind: MediaKind, l: MediaLimits): number {
  return { image: l.maxImageBytes, audio: l.maxAudioBytes, video: l.maxVideoBytes, document: l.maxDocumentBytes }[kind];
}

export function checkUploadAllowed(args: {
  kind: MediaKind;
  sizeBytes: number;
  durationSeconds?: number | null;
  usage: { bytes: number; uploadsToday: number };
  limits?: MediaLimits;
}): { ok: true } | { ok: false; reason: string } {
  const l = args.limits ?? DEFAULT_LIMITS;
  if (!Number.isFinite(args.sizeBytes) || args.sizeBytes <= 0) return { ok: false, reason: 'Taille de fichier invalide.' };
  const max = maxBytesFor(args.kind, l);
  if (args.sizeBytes > max) return { ok: false, reason: `Fichier trop volumineux (maximum ${Math.round(max / 1024 / 1024)} Mo pour ce type).` };
  if (args.usage.uploadsToday >= l.maxUploadsPerDay) return { ok: false, reason: 'Limite de téléversements quotidiens atteinte. Réessaie demain.' };
  if (args.usage.bytes + args.sizeBytes > l.quotaBytesPerUser) return { ok: false, reason: 'Ton espace de stockage est plein. Supprime d\'anciens fichiers pour en ajouter.' };
  if (args.durationSeconds !== null && args.durationSeconds !== undefined) {
    if (args.kind === 'audio' && args.durationSeconds > l.maxAudioSeconds) return { ok: false, reason: `Audio trop long (maximum ${Math.round(l.maxAudioSeconds / 60)} min).` };
    if (args.kind === 'video' && args.durationSeconds > l.maxVideoSeconds) return { ok: false, reason: `Vidéo trop longue (maximum ${Math.round(l.maxVideoSeconds / 60)} min).` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Décision finale après dépôt
// ---------------------------------------------------------------------------
/** Résultat d'un analyseur externe (antivirus / modération d'images), si configuré. */
export type ScanOutcome = { provider: 'none' } | { provider: string; verdict: 'clean' | 'infected' | 'error' };

export function decideMediaStatus(args: { detection: Detection; scan: ScanOutcome }): {
  status: 'rejected' | 'quarantined' | 'pending_review';
  bucket: 'temp-uploads' | 'quarantine' | 'community-media';
  reasons: string[];
} {
  const { detection, scan } = args;
  if (!detection.ok) {
    return detection.suspicious
      ? { status: 'quarantined', bucket: 'quarantine', reasons: detection.reasons }
      : { status: 'rejected', bucket: 'temp-uploads', reasons: detection.reasons };
  }
  if (scan.provider !== 'none' && 'verdict' in scan) {
    if (scan.verdict === 'infected') return { status: 'quarantined', bucket: 'quarantine', reasons: ['Analyse de sécurité : fichier signalé.'] };
    if (scan.verdict === 'error') return { status: 'pending_review', bucket: 'temp-uploads', reasons: ['Analyse de sécurité indisponible : relecture manuelle obligatoire.'] };
  }
  // JAMAIS d'approbation automatique : la pré-modération humaine décide (voir public.review_media).
  return { status: 'pending_review', bucket: 'temp-uploads', reasons: scan.provider === 'none' ? ['Aucun antivirus configuré : relecture manuelle obligatoire.'] : [] };
}
