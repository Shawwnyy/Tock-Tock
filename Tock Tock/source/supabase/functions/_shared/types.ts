// Types partagés entre l'interface (React) et les Edge Functions (Deno).
// Aucun import externe, aucune API propre à un runtime : ce code est testé sous Node/Bun et exécuté sous Deno.

export type ResponseType = 'scale' | 'text' | 'choice' | 'boolean';

export interface Choice {
  label: string;
  score?: number | null;
}

/** Définition de l'indicateur figée au moment du bilan (colonne `snapshot` de checkin_answers). */
export interface AnswerSnapshot {
  indicator_id: string | null;
  name: string;
  description?: string | null;
  category_id: string | null;
  category_name: string | null;
  response_type: ResponseType;
  scale_min: number | null;
  scale_max: number | null;
  choices: Choice[] | null;
  include_in_average: boolean;
  template_key?: string | null;
}

export interface Answer {
  snapshot: AnswerSnapshot;
  value_num: number | null;
  value_text: string | null;
  value_choice: string | null;
}

export interface Checkin {
  /** Date locale du bilan, au format AAAA-MM-JJ. */
  checkin_date: string;
  events_note?: string | null;
  day_note?: string | null;
  pain_score?: number | null;
  pain_zone?: string | null;
  pain_note?: string | null;
  answers: Answer[];
}

export interface CategoryStat {
  key: string;
  name: string;
  /** Moyenne sur 10 (valeur non arrondie) ou null s'il n'y a aucune réponse numérique valide. */
  average: number | null;
  /** Nombre de réponses numériques valides prises en compte. */
  count: number;
}

export interface CheckinStats {
  categories: CategoryStat[];
  /** Moyenne des moyennes de catégories disposant de données ; null => « Moyenne indisponible ». */
  general: number | null;
  /** Nombre de réponses numériques valides prises en compte dans la moyenne. */
  numericCount: number;
  /** Nombre de catégories contribuant à la moyenne générale. */
  categoriesWithData: number;
  /** Nombre total de réponses (toutes natures). */
  answeredCount: number;
}

export interface GoalLite {
  title: string;
  status: 'todo' | 'in_progress' | 'paused' | 'done' | 'archived';
  progress?: number | null;
  due_date?: string | null;
  /** Étapes validées le jour de la chronique. */
  stepsDoneToday?: string[];
  /** Prochaine étape non terminée, s'il y en a une. */
  nextStep?: string | null;
}

export interface ChronicleSections {
  summary?: string;
  emotions?: string;
  difficulties?: string;
  positives?: string;
  efforts?: string;
  goals?: string;
  remember?: string;
  pain?: string;
  reflection?: string;
  conclusion?: string;
  tomorrow?: string;
  notice?: string;
}

export interface ChronicleDataUsed {
  checkin: boolean;
  notes: boolean;
  goals: boolean;
  pain: boolean;
  history: boolean;
}

export interface Chronicle {
  date: string;
  title: string;
  sections: ChronicleSections;
  stats: CheckinStats | null;
  data_used: ChronicleDataUsed;
  source: 'template' | 'ai';
  /** true : données insuffisantes, aucune « fausse » chronique n'a été fabriquée. */
  insufficient: boolean;
}
