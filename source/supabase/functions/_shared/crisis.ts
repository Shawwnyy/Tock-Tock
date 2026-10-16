// Détection de détresse/crise (mots-clés prudents, FR) et ressources d'aide par pays.
// Limite assumée : un filtre à mots-clés n'est PAS un outil clinique. Il sert à afficher rapidement des ressources et à
// ne pas continuer « comme si de rien n'était ». Les faux négatifs existent ; l'assistant n'est pas un service d'urgence.

export type CrisisLevel = 'none' | 'distress' | 'crisis';

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Crise : idées suicidaires, projet, automutilation en cours, danger immédiat pour soi.
const CRISIS: RegExp[] = [
  /\b(me|m) ?(suicider|tuer)\b/, /\bsuicid/, /\benvie de mourir\b/, /\bveux (plus )?(vivre|mourir)\b/, /\bveux mourir\b/,
  /\ben finir (avec (la vie|tout)|pour de bon)\b/, /\bmettre fin a (ma vie|mes jours)\b/, /\bme faire du mal\b/, /\bme (couper|scarifier|mutiler)\b/,
  /\bj en peux plus de vivre\b/, /\bplus envie de vivre\b/, /\bvaut mieux que je disparaisse\b/, /\bpreferable (que je|de) disparaitre\b/,
  /\bmieux sans moi\b/, /\bavaler (tous? )?(mes|les) (cachets|medicaments|comprimes)\b/, /\bsauter (du|d un|par la) (pont|fenetre|balcon|toit)\b/,
  /\bkill myself\b/, /\bwant to die\b/, /\bend my life\b/,
];
// Détresse : mal-être important sans formulation de crise.
const DISTRESS: RegExp[] = [
  /\bje vais (vraiment )?(tres )?mal\b/, /\bdesespere?\b/, /\bplus aucun espoir\b/, /\btout est noir\b/, /\bje n y arrive plus\b/, /\bj y arrive plus\b/,
  /\bje craque\b/, /\bcrise d angoisse\b/, /\battaque de panique\b/, /\bje suis epuise e? de tout\b/, /\bpersonne ne m aime\b/, /\bje me sens (completement )?(seul|vide)\b/,
  /\bje suis nul(le)?\b/, /\bje me deteste\b/,
];

export function detectCrisis(text: string): CrisisLevel {
  const n = normalizeForMatch(text);
  if (!n) return 'none';
  if (CRISIS.some((r) => r.test(n))) return 'crisis';
  if (DISTRESS.some((r) => r.test(n))) return 'distress';
  return 'none';
}

export interface HelpResource {
  name: string;
  contact: string;
  note: string;
}

const COMMON: HelpResource = { name: 'Annuaire international de lignes d\'écoute', contact: 'https://findahelpline.com', note: 'Pour trouver une ligne d\'aide dans ton pays.' };

export const HELP_RESOURCES: Record<string, HelpResource[]> = {
  FR: [
    { name: '3114 — Numéro national de prévention du suicide', contact: '3114', note: 'Gratuit, 24 h/24, 7 j/7.' },
    { name: 'Urgences (SAMU)', contact: '15', note: 'En cas de danger immédiat. Le 112 fonctionne aussi dans toute l\'Europe.' },
    { name: 'Urgences européennes', contact: '112', note: 'Police, pompiers, secours.' },
    { name: 'Enfance en danger', contact: '119', note: 'Pour les mineurs en danger ou leurs proches.' },
    { name: 'Cyberharcèlement', contact: '3018', note: 'Gratuit, pour être aidé en cas de harcèlement en ligne.' },
  ],
  BE: [
    { name: 'Centre de prévention du suicide', contact: '0800 32 123', note: 'Gratuit, 24 h/24.' },
    { name: 'Urgences', contact: '112', note: 'En cas de danger immédiat.' },
  ],
  CH: [
    { name: 'La Main Tendue', contact: '143', note: 'Écoute 24 h/24.' },
    { name: 'Urgences', contact: '144', note: 'Ambulance. Le 112 fonctionne aussi.' },
  ],
  CA: [
    { name: 'Ligne 988 (crise et prévention du suicide)', contact: '988', note: 'Au Québec : 1 866 APPELLE (1 866 277-3553).' },
    { name: 'Urgences', contact: '911', note: 'En cas de danger immédiat.' },
  ],
  US: [
    { name: '988 Suicide & Crisis Lifeline', contact: '988', note: 'Appel ou SMS, 24 h/24.' },
    { name: 'Urgences', contact: '911', note: 'En cas de danger immédiat.' },
  ],
};

export function resourcesFor(country: string | null | undefined): HelpResource[] {
  const key = (country ?? '').toUpperCase();
  return [...(HELP_RESOURCES[key] ?? HELP_RESOURCES.FR), COMMON];
}

/** Déduit un pays probable depuis le fuseau horaire (heuristique d'affichage, jamais bloquante). */
export function countryFromTimezone(tz: string | null | undefined): string {
  if (!tz) return 'FR';
  if (tz === 'Europe/Brussels') return 'BE';
  if (tz === 'Europe/Zurich') return 'CH';
  if (/^America\/(Toronto|Montreal|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina)$/.test(tz)) return 'CA';
  if (/^America\//.test(tz) || tz.startsWith('US/') || tz.startsWith('Pacific/Honolulu')) return 'US';
  return 'FR';
}

/** Message de soutien fixe, non généré : on ne laisse jamais une IA improviser en situation de crise. */
export function crisisMessage(level: Exclude<CrisisLevel, 'none'>, country?: string | null): { text: string; resources: HelpResource[] } {
  const resources = resourcesFor(country);
  if (level === 'crisis') {
    return {
      text:
        'Je suis vraiment désolé que tu traverses ça, et je suis content que tu l\'aies écrit. Tu mérites d\'être aidé(e) par quelqu\'un de vrai, maintenant. ' +
        'Si tu es en danger immédiat ou si tu as l\'intention de te faire du mal, appelle les urgences. Sinon, une ligne d\'écoute gratuite peut t\'accompagner tout de suite ; ' +
        'si tu peux, prévient aussi une personne de confiance près de toi. Je ne suis pas un service d\'urgence ni un soignant, mais je reste là pour t\'écouter.',
      resources,
    };
  }
  return {
    text:
      'Ce que tu décris a l\'air très lourd, et je te remercie de le dire. Je ne suis pas un professionnel de santé, mais je peux t\'écouter. ' +
      'Si cette souffrance dure ou devient trop forte, en parler à un médecin, un psychologue ou une ligne d\'écoute peut vraiment aider.',
    resources: resources.slice(0, 3),
  };
}
