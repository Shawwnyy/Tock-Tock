// Planification des chroniques : fuseaux horaires, heure d'été/hiver, retards, doublons.
//
// Règle (documentée) : la chronique concerne
//   - la journée en cours si l'heure choisie est 12:00 ou plus tard (ex. 21:30 -> chronique du jour) ;
//   - la VEILLE si l'heure choisie est avant midi (ex. 00:05 -> chronique de la journée qui vient de se terminer).
// Elle est « due » dès que l'heure locale choisie est atteinte, et le reste pendant 36 h (rattrapage après une panne).
// Aucune conversion vers UTC n'est nécessaire : on raisonne en heure LOCALE de la personne, donc l'heure d'été/hiver
// ne décale rien. Un jour d'heure répétée (retour à l'heure d'hiver) ou sautée (passage à l'heure d'été) est géré,
// et l'unicité (personne, jour, canal) en base garantit qu'aucun envoi n'est dupliqué.
import { addDays, toEpochDay } from './stats.ts';

export interface LocalNow {
  date: string; // AAAA-MM-JJ
  time: string; // HH:MM
  minuteOfDay: number;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Date et heure locales d'un instant, dans un fuseau IANA. */
export function localNow(tz: string, instant: Date): LocalNow {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const hh = get('hour') === '24' ? '00' : get('hour');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hh}:${get('minute')}`,
    minuteOfDay: +hh * 60 + +get('minute'),
  };
}

export function timeToMinutes(t: string): number {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`Heure invalide : ${t}`);
  return +m[1] * 60 + +m[2];
}

/** Date de la journée couverte par une chronique livrée à `deliveryTime` le jour local `deliveryDate`. */
export function chronicleDateForDelivery(deliveryDate: string, deliveryTime: string): string {
  return timeToMinutes(deliveryTime) < 12 * 60 ? addDays(deliveryDate, -1) : deliveryDate;
}

const CATCH_UP_MINUTES = 36 * 60;

/**
 * Jours de chronique actuellement dus (du plus récent au plus ancien), pour une personne.
 * `alreadyDelivered` : jours de chronique déjà livrés (ou en cours) — filtrés ici, ET protégés en base par l'unicité.
 */
export function dueChronicleDates(args: {
  timezone: string;
  deliveryTime: string;
  now: Date;
  alreadyDelivered?: ReadonlySet<string>;
  /** Premier jour de chronique autorisé (ex. jour d'activation) : évite de « rattraper » des jours antérieurs à l'activation. */
  notBefore?: string;
}): string[] {
  const { timezone, deliveryTime, now, alreadyDelivered, notBefore } = args;
  const local = localNow(timezone, now);
  const nowAbs = toEpochDay(local.date) * 1440 + local.minuteOfDay;
  const dueMinutes = timeToMinutes(deliveryTime);
  const out: string[] = [];
  // Jours de livraison candidats : aujourd'hui, hier, avant-hier (couvre les 36 h de rattrapage).
  for (let back = 0; back <= 2; back++) {
    const deliveryDate = addDays(local.date, -back);
    const dueAbs = toEpochDay(deliveryDate) * 1440 + dueMinutes;
    const late = nowAbs - dueAbs;
    if (late >= 0 && late < CATCH_UP_MINUTES) {
      const target = chronicleDateForDelivery(deliveryDate, deliveryTime);
      if (notBefore && target < notBefore) continue;
      if (!alreadyDelivered?.has(target) && !out.includes(target)) out.push(target);
    }
  }
  return out;
}

/** Rappel de bilan : dû une fois par jour local, à partir de l'heure choisie, pendant 6 h maximum. */
export function reminderDueDate(args: { timezone: string; reminderTime: string; now: Date; alreadySent?: ReadonlySet<string> }): string | null {
  const local = localNow(args.timezone, args.now);
  const late = local.minuteOfDay - timeToMinutes(args.reminderTime);
  if (late < 0 || late >= 6 * 60) return null;
  return args.alreadySent?.has(local.date) ? null : local.date;
}
