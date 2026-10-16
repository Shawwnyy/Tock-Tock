// Lecture des données d'une personne et production d'une chronique. Le client `db` est INJECTÉ :
//  - generate-chronicle l'appelle avec le client de la personne (RLS appliquée, rien ne sort du périmètre) ;
//  - scheduled-chronicles l'appelle avec la clé service, mais filtre toujours par user_id.
import type { Checkin, Chronicle, GoalLite } from './types.ts';
import { buildTemplateChronicle, type ChronicleInput, type ChronicleOptions } from './chronicle.ts';
import { addDays } from './stats.ts';
import { localNow } from './schedule.ts';
import { aiConfigured, callAi, CHRONICLE_SYSTEM_PROMPT, buildChroniclePromptData, parseAiChronicle, allowedScoresFor, type AiEnv } from './ai.ts';

// deno-lint-ignore no-explicit-any
export type Db = any;

export interface Settings {
  timezone: string;
  track_pain: boolean;
  ai_consent: boolean;
  ai_use_history: boolean;
  chatbot_access?: { pain?: boolean };
}

export function optionsFor(s: Settings, forAi: boolean): ChronicleOptions {
  return {
    includeNotes: true, // la personne a écrit ces notes pour elle ; pour l'IA, le consentement ai_consent est requis en amont
    includeGoals: true,
    includePain: forAi ? s.track_pain && !!s.chatbot_access?.pain : s.track_pain,
    includeHistory: forAi ? s.ai_use_history : true,
  };
}

// deno-lint-ignore no-explicit-any
function toCheckin(row: any): Checkin {
  return {
    checkin_date: row.checkin_date,
    events_note: row.events_note,
    day_note: row.day_note,
    pain_score: row.pain_score,
    pain_zone: row.pain_zone,
    pain_note: row.pain_note,
    // deno-lint-ignore no-explicit-any
    answers: (row.checkin_answers ?? []).map((a: any) => ({
      snapshot: a.snapshot,
      value_num: a.value_num === null ? null : Number(a.value_num),
      value_text: a.value_text,
      value_choice: a.value_choice,
    })),
  };
}

export async function loadChronicleInput(db: Db, userId: string, date: string, settings: Settings, forAi: boolean): Promise<ChronicleInput> {
  const options = optionsFor(settings, forAi);
  const { data: row, error } = await db.from('checkins').select('*, checkin_answers(*)').eq('user_id', userId).eq('checkin_date', date).maybeSingle();
  if (error) throw new Error(`checkins: ${error.message}`);

  let previousCheckin: Checkin | null = null;
  if (options.includeHistory) {
    const { data: prev } = await db.from('checkins').select('*, checkin_answers(*)').eq('user_id', userId).lt('checkin_date', date)
      .order('checkin_date', { ascending: false }).limit(1);
    if (prev?.length) previousCheckin = toCheckin(prev[0]);
  }

  let goals: GoalLite[] = [];
  if (options.includeGoals) {
    const { data: g } = await db.from('goals').select('id,title,status,progress,due_date').eq('user_id', userId).in('status', ['todo', 'in_progress', 'paused', 'done']).limit(50);
    const ids: string[] = (g ?? []).map((x: { id: string }) => x.id);
    const steps = ids.length
      ? (await db.from('goal_steps').select('goal_id,title,done,done_at,sort_order').eq('user_id', userId).in('goal_id', ids).order('sort_order')).data ?? []
      : [];
    const lo = addDays(date, -1);
    // deno-lint-ignore no-explicit-any
    goals = (g ?? []).map((x: any) => {
      // deno-lint-ignore no-explicit-any
      const mine = steps.filter((s: any) => s.goal_id === x.id);
      return {
        title: x.title,
        status: x.status,
        progress: x.progress,
        due_date: x.due_date,
        // deno-lint-ignore no-explicit-any
        stepsDoneToday: mine.filter((s: any) => s.done && s.done_at && s.done_at >= `${lo}T00:00:00Z` && localNow(settings.timezone, new Date(s.done_at)).date === date).map((s: any) => s.title),
        // deno-lint-ignore no-explicit-any
        nextStep: mine.find((s: any) => !s.done)?.title ?? null,
      };
    });
    // Un objectif « terminé » n'est mentionné que s'il l'a été ce jour-là
    const { data: doneToday } = await db.from('goals').select('title,completed_at').eq('user_id', userId).eq('status', 'done').gte('completed_at', `${lo}T00:00:00Z`);
    const doneTitles = new Set(
      // deno-lint-ignore no-explicit-any
      (doneToday ?? []).filter((d: any) => localNow(settings.timezone, new Date(d.completed_at)).date === date).map((d: any) => d.title),
    );
    goals = goals.filter((x) => x.status !== 'done' || doneTitles.has(x.title));
  }

  return { date, checkin: row ? toCheckin(row) : null, previousCheckin, goals, options };
}

export interface ProduceResult {
  chronicle: Chronicle;
  ai: { requested: boolean; used: boolean; reason?: string; provider?: string };
}

/** Gabarit par défaut ; IA seulement si demandée ET consentie ET configurée ET sortie valide. Sinon repli explicite. */
export async function produceChronicle(args: {
  db: Db;
  userId: string;
  date: string;
  settings: Settings;
  useAi: boolean;
  aiEnv: AiEnv;
  /** Appelé avant tout appel IA (quota quotidien) ; false => pas d'IA. */
  allowAiCall?: () => Promise<boolean>;
  fetchImpl?: Parameters<typeof callAi>[3] extends infer O ? (O extends { fetchImpl?: infer F } ? F : never) : never;
}): Promise<ProduceResult> {
  const { db, userId, date, settings, aiEnv } = args;
  const templateInput = await loadChronicleInput(db, userId, date, settings, false);
  const template = buildTemplateChronicle(templateInput);
  const fallback = (reason: string): ProduceResult => ({ chronicle: template, ai: { requested: args.useAi, used: false, reason } });

  if (!args.useAi) return fallback('not_requested');
  if (!settings.ai_consent) return fallback('no_consent');
  if (!aiConfigured(aiEnv)) return fallback('not_configured');
  if (template.insufficient) return fallback('insufficient_data');
  if (args.allowAiCall && !(await args.allowAiCall())) return fallback('daily_limit');

  // Données restreintes à ce que la personne autorise pour l'IA (douleur, historique)
  const aiInput = await loadChronicleInput(db, userId, date, settings, true);
  const aiTemplate = buildTemplateChronicle(aiInput);
  const res = await callAi(aiEnv, CHRONICLE_SYSTEM_PROMPT, [{ role: 'user', content: buildChroniclePromptData(aiInput, aiTemplate) }], { maxTokens: 900, fetchImpl: args.fetchImpl });
  if (!res.ok) return fallback(`ai_${res.reason}`);
  const sections = parseAiChronicle(res.text, { allowedScores: allowedScoresFor(aiTemplate), includePain: aiInput.options.includePain, includeNotes: aiInput.options.includeNotes });
  if (!sections) return fallback('ai_output_rejected');
  // Les sections factuelles de la douleur restent celles du gabarit (jamais reformulées par l'IA).
  if (aiTemplate.sections.pain) sections.pain = aiTemplate.sections.pain;
  return {
    chronicle: { ...aiTemplate, sections, source: 'ai' },
    ai: { requested: true, used: true, provider: res.provider },
  };
}
