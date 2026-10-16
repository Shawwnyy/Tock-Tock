// Sauvegarde PDF : un document LISIBLE (bilans, objectifs, chroniques…) qui contient aussi, joint au fichier, les données
// exactes de l'application pour pouvoir les RESTAURER. Le PDF reste un PDF normal : il s'ouvre dans n'importe quel lecteur.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { chronicleToText, formatDateFr } from '../../supabase/functions/_shared/chronicle.ts';
import { computeCheckinStats, formatScore } from '../../supabase/functions/_shared/stats.ts';
import type { Answer } from '../../supabase/functions/_shared/types.ts';
import { PdfWriter } from './pdfkit';
import { RULES_VERSION } from './rules';
import { checkinsSorted, downloadBlob, getState, markBackupDone, normalizeStore, streaks, today, type Store } from './store';

export const ATTACHMENT_NAME = 'tock-tock-donnees.json';

interface Payload { app: 'tock-tock'; format: 1; exported_at: string; data: Store }

function answerText(a: Answer): string {
  const s = a.snapshot;
  if (s.response_type === 'text') return `${s.name} : « ${(a.value_text ?? '').slice(0, 200)} »`;
  if (s.response_type === 'choice') return `${s.name} : ${a.value_choice}`;
  if (s.response_type === 'boolean') return `${s.name} : ${a.value_num === 1 ? 'oui' : 'non'}`;
  return `${s.name} : ${a.value_num}${s.scale_max !== null ? `/${s.scale_max}` : ''}`;
}

export async function buildBackupPdf(s: Store, now = new Date()): Promise<Uint8Array> {
  const t = today(s);
  const list = checkinsSorted(s);
  const st = streaks(list.map((c) => c.checkin_date), t);
  const w = await PdfWriter.create('Tock Tock - Sauvegarde');
  const stamp = now.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

  w.heading('Tock Tock - Sauvegarde', 20);
  w.para(`Créée le ${stamp}${s.settings.name ? ` pour ${s.settings.name}` : ''}.`);
  w.para('Document PRIVÉ : il contient tous tes bilans, notes, douleur et objectifs. Garde-le dans un endroit sûr (jamais en pièce jointe non protégée).', { bold: true, color: [0.6, 0.15, 0.1] });
  w.para('Pour restaurer : ouvre Tock Tock > Réglages > « Restaurer une sauvegarde » et choisis ce fichier. Il doit être le PDF d\'origine (non imprimé, non retouché) : les données exactes y sont jointes sous le nom « ' + ATTACHMENT_NAME + ' ».');

  w.heading('Résumé');
  w.para(`Bilans : ${list.length}${list.length ? ` (du ${formatDateFr(list[0].checkin_date)} au ${formatDateFr(list[list.length - 1].checkin_date)})` : ''}`);
  w.para(`Série en cours : ${st.current} jour(s) - meilleure série : ${st.best}`);
  w.para(`Objectifs : ${s.goals.length} - petites victoires : ${s.victories.length} - chroniques : ${Object.keys(s.chronicles).length} - tickets : ${s.tickets.length}`);
  w.para(`Règles acceptées : version ${s.settings.rules_accepted_version ?? '-'}${s.settings.rules_accepted_at ? ` le ${new Date(s.settings.rules_accepted_at).toLocaleDateString('fr-FR')}` : ''} (version actuelle ${RULES_VERSION}).`);

  w.heading('Indicateurs');
  for (const c of s.categories.slice().sort((a, b) => a.sort_order - b.sort_order)) {
    const names = s.indicators.filter((i) => i.category_id === c.id).sort((a, b) => a.sort_order - b.sort_order).map((i) => `${i.name}${i.active ? '' : ' (inactif)'}`);
    w.para(`${c.name} : ${names.join(' ; ') || '-'}`, { size: 9 });
  }

  w.heading('Bilans (du plus récent au plus ancien)');
  if (!list.length) w.para('Aucun bilan.');
  for (const c of [...list].reverse()) {
    const stats = computeCheckinStats(c.answers);
    w.para(`${formatDateFr(c.checkin_date)} - moyenne ${stats.general === null ? 'indisponible' : `${formatScore(stats.general)}/10`}`, { bold: true, size: 10 });
    const cats = stats.categories.filter((x) => x.average !== null).map((x) => `${x.name} ${formatScore(x.average)}`);
    if (cats.length) w.para(cats.join(' ; '), { size: 9, indent: 10 });
    if (c.answers.length) w.para(c.answers.map(answerText).join(' ; '), { size: 8.5, indent: 10, color: [0.3, 0.3, 0.35] });
    if (c.tags?.length) w.para(`Étiquettes : ${c.tags.join(', ')}`, { size: 9, indent: 10 });
    if (c.pain_score !== null && c.pain_score !== undefined) w.para(`Douleur : ${c.pain_score}/10${c.pain_zone ? ` (${c.pain_zone})` : ''}${c.pain_note ? ` - ${c.pain_note}` : ''}`, { size: 9, indent: 10 });
    if (c.events_note) w.para(`Événements : ${c.events_note}`, { size: 9, indent: 10 });
    if (c.day_note) w.para(`Note : ${c.day_note}`, { size: 9, indent: 10 });
  }

  w.heading('Objectifs');
  if (!s.goals.length) w.para('Aucun objectif.');
  for (const g of s.goals) {
    w.para(`${g.title} - ${g.status}${g.due_date ? ` - échéance ${g.due_date}` : ''}`, { bold: true });
    for (const x of g.steps) w.para(`${x.done ? '[x]' : '[ ]'} ${x.title}`, { size: 9, indent: 10 });
  }

  w.heading('Petites victoires');
  if (!s.victories.length) w.para('Aucune.');
  for (const v of s.victories) w.para(`${v.date} - ${v.text}`, { size: 9 });

  w.heading('Chroniques');
  const dates = Object.keys(s.chronicles).sort().reverse();
  if (!dates.length) w.para('Aucune chronique.');
  for (const d of dates) { w.para(s.chronicles[d].title, { bold: true }); w.para(chronicleToText(s.chronicles[d]), { size: 9, indent: 10 }); }

  // Données exactes jointes au PDF (le code PIN n'est jamais exporté).
  const data: Store = structuredClone(s);
  data.settings.pinHash = null; data.settings.pinSalt = null; data.drafts = {}; data.chat.token = null; // la clé secrète de discussion n'est jamais exportée
  data.settings.lastBackupAt = now.toISOString(); // restaurer cette sauvegarde = être à jour : le rappel ne doit pas réapparaître aussitôt
  const payload: Payload = { app: 'tock-tock', format: 1, exported_at: now.toISOString(), data };
  await w.doc.attach(new TextEncoder().encode(JSON.stringify(payload)), ATTACHMENT_NAME, {
    mimeType: 'application/json', description: 'Données Tock Tock pour la restauration (ne pas modifier)', creationDate: now, modificationDate: now,
  });
  w.doc.setKeywords(['tock-tock', 'sauvegarde']);
  w.doc.setSubject('Sauvegarde Tock Tock');
  return w.finish(`Tock Tock - sauvegarde du ${now.toLocaleDateString('fr-FR')}`);
}

/** Extrait le fichier joint d'un PDF créé par buildBackupPdf. */
export async function extractAttachment(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const efTree = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const arr = efTree?.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!arr) throw new Error('no_attachment');
  for (let i = 0; i + 1 < arr.size(); i += 2) {
    const nameObj = arr.lookup(i) as { decodeText?: () => string } | undefined;
    const spec = arr.lookup(i + 1, PDFDict);
    if (nameObj?.decodeText?.() !== ATTACHMENT_NAME) continue;
    const ef = spec.lookup(PDFName.of('EF'), PDFDict);
    const stream = ef.lookup(PDFName.of('F')) as PDFRawStream;
    return decodePDFRawStream(stream).decode();
  }
  throw new Error('no_attachment');
}

const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

/** Lit une sauvegarde (PDF Tock Tock, ou ancien JSON) et renvoie des données validées. Lève une erreur sinon. */
export async function readBackup(bytes: Uint8Array): Promise<Store> {
  if (bytes.length > 60 * 1024 * 1024) throw new Error('too_big');
  const raw = isPdf(bytes) ? await extractAttachment(bytes) : bytes;
  const parsed = JSON.parse(new TextDecoder().decode(raw)) as Payload | Store;
  const data = (parsed as Payload).app === 'tock-tock' ? (parsed as Payload).data : (parsed as Store);
  return normalizeStore(data);
}

/** Les réglages de sécurité de CET appareil (code PIN, adresse de support) ne sont pas écrasés par une sauvegarde. */
export function mergeRestored(restored: Store, current: Store): Store {
  return { ...restored, chat: { ...restored.chat, token: current.chat.token, enabled: current.chat.enabled, adult_ack: current.chat.adult_ack, epoch: current.chat.epoch, last_id: current.chat.last_id }, settings: { ...restored.settings, handle: current.settings.handle, pinHash: current.settings.pinHash, pinSalt: current.settings.pinSalt, supportEmail: current.settings.supportEmail || restored.settings.supportEmail, account: current.settings.account, welcome_done: current.settings.welcome_done || restored.settings.welcome_done }, drafts: {} };
}

/** Construit la sauvegarde PDF de l'état courant, la télécharge et note la date de sauvegarde. */
export async function downloadBackupPdf(): Promise<void> {
  const bytes = await buildBackupPdf(getState());
  downloadBlob(`tock-tock-sauvegarde-${today(getState())}.pdf`, bytes as BlobPart, 'application/pdf');
  markBackupDone();
}
