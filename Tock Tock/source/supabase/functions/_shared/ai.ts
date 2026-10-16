// Couche IA OPTIONNELLE : adaptateur de fournisseur, prompts, garde-fous sur les sorties, mode guidé sans IA.
// Rien ici ne « fait semblant » : si aucune clé n'est configurée, `aiConfigured` renvoie false et l'application
// utilise le gabarit de chronique / le mode guidé, en le disant clairement à la personne.
import type { Chronicle, ChronicleSections } from './types.ts';
import { formatScore } from './stats.ts';
import { formatDateFr, type ChronicleInput } from './chronicle.ts';
import { detectCrisis, crisisMessage, type HelpResource } from './crisis.ts';

export interface AiEnv {
  AI_PROVIDER?: string; // 'anthropic' | 'openai' (API compatible chat/completions)
  AI_API_KEY?: string;
  AI_MODEL?: string;
  AI_BASE_URL?: string;
}

export function aiConfigured(env: AiEnv): boolean {
  return !!(env.AI_PROVIDER && env.AI_API_KEY && env.AI_MODEL);
}

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

export type AiResult = { ok: true; text: string; provider: string } | { ok: false; reason: 'not_configured' | 'http_error' | 'timeout' | 'empty' | 'network'; detail?: string };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

export async function callAi(env: AiEnv, system: string, messages: ChatMsg[], opts: { maxTokens?: number; timeoutMs?: number; fetchImpl?: FetchLike } = {}): Promise<AiResult> {
  if (!aiConfigured(env)) return { ok: false, reason: 'not_configured' };
  const f: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init) as any);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25_000);
  try {
    const anthropic = env.AI_PROVIDER === 'anthropic';
    const url = anthropic
      ? `${env.AI_BASE_URL ?? 'https://api.anthropic.com'}/v1/messages`
      : `${env.AI_BASE_URL ?? 'https://api.openai.com'}/v1/chat/completions`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    let body: unknown;
    if (anthropic) {
      headers['x-api-key'] = env.AI_API_KEY!;
      headers['anthropic-version'] = '2023-06-01';
      body = { model: env.AI_MODEL, max_tokens: opts.maxTokens ?? 800, system, messages };
    } else {
      headers.authorization = `Bearer ${env.AI_API_KEY}`;
      body = { model: env.AI_MODEL, max_tokens: opts.maxTokens ?? 800, messages: [{ role: 'system', content: system }, ...messages] };
    }
    const res = await f(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) return { ok: false, reason: 'http_error', detail: `HTTP ${res.status}` };
    const json = await res.json();
    const text: string | undefined = anthropic ? json?.content?.find?.((c: any) => c.type === 'text')?.text : json?.choices?.[0]?.message?.content;
    if (!text || !text.trim()) return { ok: false, reason: 'empty' };
    return { ok: true, text: text.trim(), provider: env.AI_PROVIDER! };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Chronique par IA : prompt strict + validation de la sortie (sinon repli sur le gabarit)
// ---------------------------------------------------------------------------
const AI_KEYS: (keyof ChronicleSections)[] = ['summary', 'emotions', 'difficulties', 'positives', 'efforts', 'goals', 'remember', 'reflection', 'conclusion', 'tomorrow'];

export const CHRONICLE_SYSTEM_PROMPT = [
  'Tu rédiges la « chronique de minuit » d\'une personne, en français, à la deuxième personne (« tu »), ton chaleureux, sobre et sans jugement.',
  'RÈGLES ABSOLUES :',
  '- Utilise UNIQUEMENT les faits fournis dans les données. N\'invente aucun événement, émotion, cause, personne ou chiffre.',
  '- Si une information manque, n\'en parle pas. Une réponse vide n\'est pas un zéro.',
  '- Ne fais AUCUN diagnostic, ne donne AUCUN conseil médical, ne parle pas de médicaments.',
  '- Ne mentionne pas la douleur sauf si la section « douleur » est fournie dans les données.',
  '- Recopie les notes de la personne sans les réinterpréter. Pas de morale, pas de pression, pas de comparaison avec d\'autres personnes.',
  '- Réponds par un objet JSON avec UNIQUEMENT ces clés (chaînes) : summary, emotions, difficulties, positives, efforts, goals, remember, reflection, conclusion, tomorrow. Omets une clé si tu n\'as rien de factuel à dire.',
].join('\n');

export function buildChroniclePromptData(input: ChronicleInput, template: Chronicle): string {
  const data: Record<string, unknown> = {
    date: formatDateFr(input.date),
    moyenne_generale: template.stats?.general === null || !template.stats ? 'indisponible' : formatScore(template.stats.general),
    categories: template.stats?.categories.map((c) => ({ nom: c.name, moyenne: c.average === null ? 'indisponible' : formatScore(c.average), reponses: c.count })),
    reponses: input.checkin?.answers
      .filter((a) => a.value_num !== null || a.value_choice !== null)
      .map((a) => ({ question: a.snapshot.name, categorie: a.snapshot.category_name, valeur: a.value_num ?? a.value_choice, echelle: a.snapshot.response_type === 'scale' ? `${a.snapshot.scale_min}-${a.snapshot.scale_max}` : undefined })),
  };
  if (input.options.includeNotes) data.notes = { evenements: input.checkin?.events_note ?? null, journee: input.checkin?.day_note ?? null };
  if (input.options.includePain && input.checkin?.pain_score != null) data.douleur = { score_sur_10: input.checkin.pain_score, zone: input.checkin.pain_zone ?? null };
  if (input.options.includeGoals) data.objectifs = input.goals ?? [];
  if (input.options.includeHistory && template.sections.reflection) data.comparaison = template.sections.reflection;
  return JSON.stringify(data);
}

/** Tous les « x/10 » écrits par l'IA doivent exister dans les données ; sinon la sortie est refusée. */
export function numbersAreGrounded(text: string, allowed: Set<string>): boolean {
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*\/\s*10\b/g)) {
    if (!allowed.has(m[1].replace('.', ','))) return false;
  }
  return true;
}

export function parseAiChronicle(raw: string, args: { allowedScores: Set<string>; includePain: boolean; includeNotes: boolean }): ChronicleSections | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const out: ChronicleSections = {};
  for (const k of AI_KEYS) {
    const v = obj[k];
    if (typeof v !== 'string' || !v.trim()) continue;
    const text = v.trim().slice(0, 1200);
    if (!numbersAreGrounded(text, args.allowedScores)) return null;
    if (!args.includePain && /\bdouleurs?\b|\bdouloureu/i.test(text)) return null;
    out[k] = text;
  }
  return Object.keys(out).length ? out : null;
}

export function allowedScoresFor(template: Chronicle): Set<string> {
  const set = new Set<string>();
  if (template.stats) {
    if (template.stats.general !== null) set.add(formatScore(template.stats.general));
    for (const c of template.stats.categories) if (c.average !== null) set.add(formatScore(c.average));
  }
  // Valeurs individuelles (échelle déjà sur 10 ou normalisée) : le gabarit les contient dans positives/difficultés
  for (const t of [template.sections.positives, template.sections.difficulties, template.sections.pain]) {
    for (const m of (t ?? '').matchAll(/(\d+(?:,\d+)?)\s*\/\s*10/g)) set.add(m[1]);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Assistant « Tock Tock Assistant »
// ---------------------------------------------------------------------------
export interface AssistantAccess {
  checkins: boolean;
  goals: boolean;
  chronicles: boolean;
  pain: boolean;
}

export interface AssistantContextInput {
  access: AssistantAccess;
  recentDays?: { date: string; general: number | null; categories: { name: string; average: number | null }[]; pain?: number | null }[];
  goals?: { title: string; status: string; nextStep?: string | null }[];
  chronicleTitles?: string[];
}

/** Contexte transmis au modèle : STRICTEMENT limité à ce que la personne a autorisé. */
export function buildAssistantContext(c: AssistantContextInput): string {
  const parts: string[] = [];
  if (c.access.checkins && c.recentDays?.length) {
    parts.push('Derniers bilans (moyennes sur 10 ; « indisponible » = pas de donnée, jamais zéro) :');
    for (const d of c.recentDays) {
      const cats = d.categories.map((x) => `${x.name} ${x.average === null ? 'indisponible' : formatScore(x.average)}`).join(', ');
      const pain = c.access.pain && d.pain != null ? ` ; douleur ${d.pain}/10` : '';
      parts.push(`- ${d.date} : moyenne ${d.general === null ? 'indisponible' : formatScore(d.general)} (${cats})${pain}`);
    }
  }
  if (c.access.goals && c.goals?.length) {
    parts.push('Objectifs :');
    for (const g of c.goals) parts.push(`- ${g.title} (${g.status})${g.nextStep ? ` — prochaine étape : ${g.nextStep}` : ''}`);
  }
  if (c.access.chronicles && c.chronicleTitles?.length) parts.push(`Chroniques récentes : ${c.chronicleTitles.join(' ; ')}`);
  return parts.length ? parts.join('\n') : 'Aucune donnée personnelle n\'est partagée avec toi dans cette conversation.';
}

export const ASSISTANT_SYSTEM_PROMPT = [
  'Tu es « Tock Tock Assistant », un compagnon d\'écoute et d\'organisation dans l\'application Tock Tock. Tu parles français, avec chaleur et simplicité.',
  'Tu n\'es PAS un médecin, un psychologue ni un service d\'urgence. Tu ne poses aucun diagnostic, tu ne recommandes ni ne dose aucun médicament, tu ne remplaces pas un professionnel.',
  'Tu peux : écouter, reformuler, aider à planifier de petites étapes, expliquer l\'application, aider à relire des données si elles te sont fournies.',
  'Tu n\'utilises que les données fournies dans le contexte ; si une donnée n\'y est pas, tu dis que tu ne l\'as pas. Tu n\'inventes rien.',
  'Si la personne évoque l\'envie de mourir, de se faire du mal ou un danger immédiat, tu l\'encourages avec douceur à joindre une aide humaine (les ressources sont affichées par l\'application) et tu ne continues pas comme si de rien n\'était.',
  'Tu ne demandes jamais de mot de passe, de numéro de carte ni d\'informations sur des tiers. Tu restes bref (moins de 150 mots) sauf demande contraire.',
].join('\n');

export interface AssistantReply {
  text: string;
  mode: 'crisis' | 'distress' | 'ai' | 'guided';
  resources?: HelpResource[];
  suggestions?: string[];
  /** true : la réponse a été fournie sans IA (non configurée, désactivée ou en erreur). */
  aiUnavailable?: boolean;
}

const FAQ: { match: RegExp; text: string }[] = [
  { match: /moyenne|calcul|score/, text: 'La moyenne générale est la moyenne des moyennes de chaque catégorie. Une question laissée vide n\'est jamais comptée comme zéro, et la douleur est à part : elle n\'entre pas dans la moyenne. S\'il n\'y a aucune réponse numérique, tu verras « Moyenne indisponible ».' },
  { match: /bilan|check ?in|remplir/, text: 'Ton bilan quotidien est privé : tu peux répondre seulement aux questions que tu veux, même une seule, et le modifier dans la journée. Tu peux aussi créer, renommer ou désactiver tes propres indicateurs dans « Mon espace ».' },
  { match: /chronique|minuit/, text: 'La chronique de minuit résume ton bilan du jour avec tes propres données, sans rien inventer. Tu choisis l\'heure, l\'envoi par e-mail ou en PDF, et tu peux la modifier, la régénérer ou la supprimer dans « Historique & chroniques ».' },
  { match: /objectif|but|etape/, text: 'Dans « Mon espace », crée un objectif et découpe-le en petites étapes. Tu peux fixer une date, le mettre en pause, l\'archiver et le relier à tes bilans.' },
  { match: /confidential|donnee|prive|supprim|export|rgpd/, text: 'Tes bilans, objectifs et chroniques sont privés : ni les autres membres ni l\'équipe de modération n\'y ont accès. Dans « Réglages » tu peux exporter toutes tes données ou supprimer ton compte.' },
  { match: /signal|harcel|bloquer|modér/, text: 'Sur un contenu de la communauté, utilise « Signaler » (motif obligatoire) ; tu peux aussi bloquer un membre depuis son profil. L\'équipe de modération traite les signalements et tu peux faire appel d\'une décision.' },
  { match: /pseudo|identifiant|user#/, text: 'Ton pseudonyme est public, ton identifiant (comme user#00042) est unique et permanent. Ton adresse e-mail n\'est jamais visible par les autres membres.' },
];

export const GUIDED_SUGGESTIONS = ['Comment est calculée ma moyenne ?', 'Comment remplir mon bilan ?', 'Comment fonctionne la chronique de minuit ?', 'Qui voit mes données ?'];

/** Réponse sans IA : crise détectée > FAQ > menu. Toujours honnête sur ses limites. */
export function guidedReply(message: string, country?: string | null): AssistantReply {
  const level = detectCrisis(message);
  if (level !== 'none') {
    const m = crisisMessage(level, country);
    return { text: m.text, mode: level, resources: m.resources };
  }
  const n = message.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hit = FAQ.find((f) => f.match.test(n));
  return {
    text: hit
      ? hit.text
      : 'Je suis en mode guidé (l\'IA n\'est pas activée) : je peux t\'expliquer comment fonctionne l\'application. Choisis un sujet ci-dessous, ou écris-moi avec tes mots.',
    mode: 'guided',
    suggestions: GUIDED_SUGGESTIONS,
    aiUnavailable: true,
  };
}
