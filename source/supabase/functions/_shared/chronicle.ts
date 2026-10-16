// Chronique de minuit « gabarit » : 100 % déterministe, sans IA, et qui n'écrit QUE ce que les données contiennent.
// Principes : aucune invention de fait, d'émotion ou de cause ; pas de diagnostic ; la douleur n'apparaît que si la
// personne l'a autorisée ; données insuffisantes => on le dit au lieu de fabriquer un texte.
import type { Answer, Checkin, Chronicle, ChronicleDataUsed, ChronicleSections, GoalLite } from './types.ts';
import { answerToTen, computeCheckinStats, formatScore, parseDate, toEpochDay } from './stats.ts';

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « jeudi 16 octobre 2026 » sans dépendre de l'ICU du runtime. */
export function formatDateFr(date: string): string {
  const { y, m, day } = parseDate(date);
  const dow = (toEpochDay(date) + 4) % 7; // 1970-01-01 = jeudi => index 4 dans DAYS
  return `${DAYS[dow]} ${day === 1 ? '1er' : day} ${MONTHS[m - 1]} ${y}`;
}

export interface ChronicleOptions {
  includeNotes: boolean;
  includeGoals: boolean;
  includePain: boolean;
  includeHistory: boolean;
}

export interface ChronicleInput {
  date: string;
  checkin: Checkin | null;
  goals?: GoalLite[];
  /** Bilan antérieur le plus récent (pour la comparaison), si l'historique est autorisé. */
  previousCheckin?: Checkin | null;
  options: ChronicleOptions;
}

const HIGH = 7;
const LOW = 4;

function clip(text: string, max = 280): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function listFr(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

function scored(answers: Answer[]): { name: string; value: number }[] {
  const out: { name: string; value: number }[] = [];
  for (const a of answers) {
    const v = answerToTen(a);
    if (v !== null) out.push({ name: a.snapshot.name, value: v });
  }
  return out;
}

export function buildTemplateChronicle(input: ChronicleInput): Chronicle {
  const { date, checkin, options } = input;
  const title = `Chronique de minuit — ${formatDateFr(date)}`;
  const dataUsed: ChronicleDataUsed = { checkin: false, notes: false, goals: false, pain: false, history: false };

  const hasNumbers = !!checkin && computeCheckinStats(checkin.answers).numericCount > 0;
  const hasNotes = !!checkin && !!((checkin.events_note ?? '').trim() || (checkin.day_note ?? '').trim());
  const goalsToday = options.includeGoals ? (input.goals ?? []).filter((g) => g.status !== 'archived') : [];
  const hasGoalInfo = goalsToday.some((g) => (g.stepsDoneToday?.length ?? 0) > 0 || g.status === 'done');

  if (!checkin || (!hasNumbers && !(options.includeNotes && hasNotes) && !hasGoalInfo)) {
    return {
      date,
      title,
      sections: {
        notice:
          'Il n\'y a pas assez d\'informations pour cette journée : aucun bilan exploitable n\'a été rempli. ' +
          'Rien n\'a été inventé. Tu peux remplir un bilan quand tu en as envie, même incomplet.',
      },
      stats: null,
      data_used: dataUsed,
      source: 'template',
      insufficient: true,
    };
  }

  const stats = computeCheckinStats(checkin.answers);
  dataUsed.checkin = true;
  const s: ChronicleSections = {};

  // Résumé chiffré
  if (stats.general !== null) {
    s.summary =
      `Ton bilan du jour donne une moyenne générale de ${formatScore(stats.general)}/10, calculée sur ` +
      `${stats.numericCount} réponse${stats.numericCount > 1 ? 's' : ''} réparties dans ${stats.categoriesWithData} ` +
      `catégorie${stats.categoriesWithData > 1 ? 's' : ''}. Les questions laissées vides n'entrent pas dans ce calcul.`;
  } else {
    s.summary = 'Moyenne indisponible pour cette journée : aucune réponse numérique n\'a été donnée.';
  }

  // Catégories
  const cats = stats.categories.filter((c) => c.average !== null);
  if (cats.length > 0) {
    s.emotions = `Par catégorie : ${cats.map((c) => `${c.name} ${formatScore(c.average)}/10`).join(' ; ')}.`;
  }

  // Points positifs / plus difficiles — uniquement ce qui est dans les réponses
  const items = scored(checkin.answers);
  const high = items.filter((i) => i.value >= HIGH).sort((a, b) => b.value - a.value).slice(0, 4);
  const low = items.filter((i) => i.value <= LOW).sort((a, b) => a.value - b.value).slice(0, 4);
  if (high.length) s.positives = `Parmi les points les plus hauts de la journée : ${listFr(high.map((i) => `${i.name} (${formatScore(i.value)}/10)`))}.`;
  if (low.length) s.difficulties = `Parmi les points les plus bas : ${listFr(low.map((i) => `${i.name} (${formatScore(i.value)}/10)`))}.`;

  // Notes de la personne — citées, jamais réinterprétées
  if (options.includeNotes && hasNotes) {
    dataUsed.notes = true;
    const bits: string[] = [];
    if (checkin.events_note?.trim()) bits.push(`Événements notés : « ${clip(checkin.events_note)} »`);
    if (checkin.day_note?.trim()) bits.push(`Ton mot sur la journée : « ${clip(checkin.day_note)} »`);
    s.remember = bits.join('\n');
  }

  // Objectifs
  if (goalsToday.length) {
    const done = goalsToday.filter((g) => g.status === 'done').map((g) => g.title);
    const stepped = goalsToday.filter((g) => (g.stepsDoneToday?.length ?? 0) > 0);
    const lines: string[] = [];
    if (done.length) lines.push(`Objectif${done.length > 1 ? 's' : ''} terminé${done.length > 1 ? 's' : ''} : ${listFr(done)}.`);
    for (const g of stepped) lines.push(`« ${g.title} » : ${listFr(g.stepsDoneToday!)} ${g.stepsDoneToday!.length > 1 ? 'ont été validées' : 'a été validée'} aujourd'hui.`);
    if (lines.length) {
      dataUsed.goals = true;
      s.goals = lines.join('\n');
      const next = goalsToday.find((g) => g.status !== 'done' && g.nextStep);
      if (next) s.tomorrow = `Prochaine étape déjà prévue pour « ${next.title} » : ${next.nextStep}.`;
    }
  }

  // Douleur : jamais sans autorisation, jamais interprétée
  if (options.includePain && checkin.pain_score !== null && checkin.pain_score !== undefined) {
    dataUsed.pain = true;
    const zone = checkin.pain_zone?.trim() ? ` (zone : ${clip(checkin.pain_zone, 80)})` : '';
    s.pain = `Douleur notée aujourd'hui : ${checkin.pain_score}/10${zone}. Cette valeur n'est pas incluse dans la moyenne générale.`;
  }

  // Comparaison avec le bilan précédent
  if (options.includeHistory && input.previousCheckin && stats.general !== null) {
    const prev = computeCheckinStats(input.previousCheckin.answers);
    if (prev.general !== null) {
      dataUsed.history = true;
      const diff = stats.general - prev.general;
      const when = formatDateFr(input.previousCheckin.checkin_date);
      s.reflection =
        Math.abs(diff) < 0.25
          ? `Ta moyenne est stable par rapport à ton bilan précédent (${when}).`
          : `Ta moyenne est ${diff > 0 ? 'plus haute' : 'plus basse'} de ${formatScore(Math.abs(diff))} point${Math.abs(diff) >= 1.5 ? 's' : ''} par rapport à ton bilan précédent (${when}).`;
    }
  }

  s.conclusion = 'Merci d\'avoir pris ce moment pour faire le point. Ces chiffres décrivent ta journée telle que tu l\'as renseignée ; ils ne disent rien de ta valeur.';

  return { date, title, sections: s, stats, data_used: dataUsed, source: 'template', insufficient: false };
}

export const SECTION_LABELS: Record<keyof ChronicleSections, string> = {
  summary: 'Résumé',
  emotions: 'Par catégorie',
  difficulties: 'Points plus difficiles',
  positives: 'Points positifs',
  efforts: 'Efforts',
  goals: 'Objectifs',
  remember: 'À retenir',
  pain: 'Douleur',
  reflection: 'Comparaison',
  conclusion: 'Pour finir',
  tomorrow: 'Pour demain',
  notice: 'À savoir',
};

export const SECTION_ORDER: (keyof ChronicleSections)[] = [
  'notice', 'summary', 'emotions', 'positives', 'difficulties', 'efforts', 'goals', 'remember', 'pain', 'reflection', 'tomorrow', 'conclusion',
];

/** Version texte brut (corps d'e-mail, copie). */
export function chronicleToText(c: Pick<Chronicle, 'title' | 'sections'>): string {
  const out = [c.title, ''];
  for (const k of SECTION_ORDER) {
    const v = c.sections[k];
    if (v && v.trim()) out.push(SECTION_LABELS[k], v.trim(), '');
  }
  return out.join('\n').trimEnd() + '\n';
}
