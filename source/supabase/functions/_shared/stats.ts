// Calculs des moyennes et séries temporelles — fonctions pures, exactes et testées.
//
// RÈGLES (documentées dans docs/STATS.md) :
//  1. Chaque réponse numérique valide est ramenée sur une échelle de 0 à 10 : (v − min) / (max − min) × 10.
//     Une échelle 0-10 reste inchangée ; une échelle 1-5 est comparable aux autres.
//  2. Les réponses vides n'existent pas (aucune ligne) : elles ne sont JAMAIS comptées comme zéro.
//  3. Une catégorie sans réponse numérique valide n'a pas de moyenne (null), pas « 0 ».
//  4. Moyenne générale = moyenne des moyennes de catégories AYANT des données (une catégorie de 8 questions
//     ne pèse pas plus qu'une catégorie de 2 questions).
//  5. Sont exclus de toute moyenne : textes, oui/non, choix sans score, indicateurs désactivés dans la moyenne,
//     et la douleur (qui n'est pas un indicateur : elle vit dans des colonnes dédiées du bilan).
//  6. Aucun arrondi dans les calculs ; l'arrondi n'a lieu qu'à l'affichage (formatScore).
import type { Answer, Checkin, CheckinStats, CategoryStat } from './types.ts';

/** Valeur d'une réponse sur 10, ou null si elle n'entre pas dans les moyennes. */
export function answerToTen(a: Answer): number | null {
  const s = a.snapshot;
  if (!s.include_in_average) return null;
  if (s.response_type === 'scale') {
    const v = a.value_num;
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    const min = s.scale_min;
    const max = s.scale_max;
    if (min === null || max === null || max <= min) return null;
    if (v < min || v > max) return null; // valeur hors échelle : ignorée plutôt que faussant la moyenne
    return ((v - min) / (max - min)) * 10;
  }
  if (s.response_type === 'choice') {
    if (a.value_choice === null || !s.choices) return null;
    const choice = s.choices.find((c) => c.label === a.value_choice);
    if (!choice || typeof choice.score !== 'number' || !Number.isFinite(choice.score)) return null;
    if (choice.score < 0 || choice.score > 10) return null;
    return choice.score;
  }
  return null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function categoryKey(a: Answer): { key: string; name: string } {
  const s = a.snapshot;
  return { key: s.category_id ?? `name:${s.category_name ?? ''}`, name: s.category_name ?? 'Sans catégorie' };
}

export function computeCheckinStats(answers: Answer[]): CheckinStats {
  const byCategory = new Map<string, { name: string; values: number[] }>();
  for (const a of answers) {
    const { key, name } = categoryKey(a);
    if (!byCategory.has(key)) byCategory.set(key, { name, values: [] });
    const v = answerToTen(a);
    if (v !== null) byCategory.get(key)!.values.push(v);
  }
  const categories: CategoryStat[] = [];
  for (const [key, c] of byCategory) {
    categories.push({ key, name: c.name, average: mean(c.values), count: c.values.length });
  }
  const withData = categories.filter((c) => c.average !== null);
  return {
    categories,
    general: mean(withData.map((c) => c.average as number)),
    numericCount: withData.reduce((n, c) => n + c.count, 0),
    categoriesWithData: withData.length,
    answeredCount: answers.length,
  };
}

/** Affichage uniquement : 7.25 -> « 7,3 » ; null -> « — ». */
export function formatScore(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const f = 10 ** digits;
  const rounded = Math.round((value + Number.EPSILON) * f) / f;
  return rounded.toFixed(digits).replace('.', ',');
}

/** Phrase expliquant le calcul, affichée à la personne. */
export function explainAverage(stats: CheckinStats): string {
  if (stats.general === null) {
    return 'Moyenne indisponible : aucune réponse numérique n\'a été donnée. Les questions laissées vides ne sont jamais comptées comme zéro.';
  }
  const parts = stats.categories
    .filter((c) => c.average !== null)
    .map((c) => `${c.name} ${formatScore(c.average)} (${c.count} réponse${c.count > 1 ? 's' : ''})`);
  return (
    `Moyenne générale ${formatScore(stats.general)}/10 = moyenne de ${stats.categoriesWithData} catégorie` +
    `${stats.categoriesWithData > 1 ? 's' : ''} : ${parts.join(' ; ')}. ` +
    'Chaque catégorie compte autant, quel que soit son nombre de questions. Les questions laissées vides, les réponses texte ' +
    'et la douleur ne sont pas comptées.'
  );
}

// ---------------------------------------------------------------------------
// Dates (calendrier pur, indépendant du fuseau horaire : on manipule des chaînes AAAA-MM-JJ)
// ---------------------------------------------------------------------------
export function parseDate(d: string): { y: number; m: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!match) throw new Error(`Date invalide : ${d}`);
  return { y: +match[1], m: +match[2], day: +match[3] };
}

export function toEpochDay(d: string): number {
  const { y, m, day } = parseDate(d);
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}

export function fromEpochDay(n: number): string {
  const dt = new Date(n * 86_400_000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

export function addDays(d: string, n: number): string {
  return fromEpochDay(toEpochDay(d) + n);
}

/** Lundi de la semaine (ISO) contenant la date. */
export function weekStart(d: string): string {
  const e = toEpochDay(d);
  const dow = (e + 3) % 7; // 1970-01-01 est un jeudi ; 0 = lundi
  return fromEpochDay(e - dow);
}

export function monthKey(d: string): string {
  return d.slice(0, 7);
}

export type RangePreset = '7d' | '30d' | '90d' | 'year' | 'custom';

export function rangeFor(preset: Exclude<RangePreset, 'custom'>, today: string): { from: string; to: string } {
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : preset === '90d' ? 90 : 365;
  return { from: addDays(today, -(days - 1)), to: today };
}

// ---------------------------------------------------------------------------
// Séries pour les graphiques : « pas de donnée » (null) ≠ « vraie valeur zéro » (0)
// ---------------------------------------------------------------------------
export interface DayPoint {
  date: string;
  /** Un bilan existe ce jour-là. */
  hasCheckin: boolean;
  /** Moyenne générale du jour, null si aucune donnée numérique. */
  general: number | null;
  /** Moyenne par catégorie (clé = identifiant ou nom de catégorie). */
  categories: Record<string, number | null>;
}

export function buildDailySeries(checkins: Checkin[], from: string, to: string): DayPoint[] {
  const byDate = new Map<string, Checkin>();
  for (const c of checkins) byDate.set(c.checkin_date, c);
  const out: DayPoint[] = [];
  const end = toEpochDay(to);
  for (let e = toEpochDay(from); e <= end; e++) {
    const date = fromEpochDay(e);
    const c = byDate.get(date);
    if (!c) {
      out.push({ date, hasCheckin: false, general: null, categories: {} });
      continue;
    }
    const stats = computeCheckinStats(c.answers);
    const categories: Record<string, number | null> = {};
    for (const cat of stats.categories) categories[cat.key] = cat.average;
    out.push({ date, hasCheckin: true, general: stats.general, categories });
  }
  return out;
}

export interface PeriodPoint {
  key: string;
  /** Moyenne des moyennes quotidiennes AYANT des données ; null si aucune. */
  value: number | null;
  /** Nombre de jours avec données dans la période. */
  days: number;
}

export function aggregatePeriods(series: DayPoint[], by: 'week' | 'month'): PeriodPoint[] {
  const buckets = new Map<string, number[]>();
  const order: string[] = [];
  for (const p of series) {
    const key = by === 'week' ? weekStart(p.date) : monthKey(p.date);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    if (p.general !== null) buckets.get(key)!.push(p.general);
  }
  return order.map((key) => {
    const values = buckets.get(key)!;
    return { key, value: mean(values), days: values.length };
  });
}

/** Série d'un indicateur précis (par identifiant), valeurs sur 10, null si non répondu. */
export function indicatorSeries(checkins: Checkin[], indicatorId: string, from: string, to: string): { date: string; value: number | null }[] {
  const byDate = new Map<string, Checkin>();
  for (const c of checkins) byDate.set(c.checkin_date, c);
  const out: { date: string; value: number | null }[] = [];
  const end = toEpochDay(to);
  for (let e = toEpochDay(from); e <= end; e++) {
    const date = fromEpochDay(e);
    const a = byDate.get(date)?.answers.find((x) => x.snapshot.indicator_id === indicatorId);
    out.push({ date, value: a ? answerToTen(a) : null });
  }
  return out;
}

/** Moyenne générale sur une période (moyenne des jours ayant des données). */
export function periodGeneralAverage(series: DayPoint[]): { value: number | null; days: number } {
  const values = series.map((p) => p.general).filter((v): v is number => v !== null);
  return { value: mean(values), days: values.length };
}
