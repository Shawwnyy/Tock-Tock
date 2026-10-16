// Tock Tock Assistant. Ordre des opérations (important) :
//  1. détection de détresse/crise sur le message -> réponse FIXE avec ressources, jamais de modèle ;
//  2. limite quotidienne ;
//  3. IA seulement si consentement + clé configurée ; sinon mode guidé, annoncé comme tel ;
//  4. le contexte transmis au modèle est limité à ce que la personne a autorisé ;
//  5. historique enregistré seulement si la mémoire est activée.
import { adminClient, isUuid, preflight, readEnv, readJson, reply, userContext } from '../_shared/edge.ts';
import { aiConfigured, ASSISTANT_SYSTEM_PROMPT, buildAssistantContext, callAi, guidedReply, type AssistantReply, type ChatMsg } from '../_shared/ai.ts';
import { computeCheckinStats } from '../_shared/stats.ts';
import { countryFromTimezone, crisisMessage, detectCrisis } from '../_shared/crisis.ts';

Deno.serve(async (req) => {
  const env = readEnv();
  const pre = preflight(req, env);
  if (pre) return pre;
  if (req.method !== 'POST') return reply(req, env, { error: 'method_not_allowed' }, 405);
  const ctx = await userContext(req, env);
  if (!ctx) return reply(req, env, { error: 'unauthorized' }, 401);
  const body = await readJson(req, 40_000);
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!body || message.length < 1 || message.length > 2000) return reply(req, env, { error: 'invalid_request' }, 400);

  const { db, userId } = ctx;
  const admin = adminClient(env);
  const { data: s } = await db.from('profile_settings').select('timezone,ai_consent,chatbot_memory_enabled,chatbot_access').eq('user_id', userId).maybeSingle();
  if (!s) return reply(req, env, { error: 'profile_incomplete' }, 409);
  const country = countryFromTimezone(s.timezone);

  let out: AssistantReply;
  const level = detectCrisis(message);
  if (level !== 'none') {
    const m = crisisMessage(level, country);
    out = { text: m.text, mode: level, resources: m.resources };
  } else {
    const { data: ok } = await admin.rpc('bump_usage', { p_user: userId, p_kind: 'assistant', p_limit: 100 });
    if (ok !== true) return reply(req, env, { error: 'daily_limit', message: 'Tu as atteint la limite de messages pour aujourd\'hui. Reviens demain.' }, 429);

    if (!s.ai_consent || !aiConfigured(env)) {
      out = guidedReply(message, country);
      out.text = (!s.ai_consent ? 'L\'IA est désactivée dans tes réglages. ' : 'L\'IA n\'est pas configurée sur cette installation. ') + out.text;
    } else {
      const access = { checkins: !!s.chatbot_access?.checkins, goals: !!s.chatbot_access?.goals, chronicles: !!s.chatbot_access?.chronicles, pain: !!s.chatbot_access?.pain };
      const ctxInput: Parameters<typeof buildAssistantContext>[0] = { access };
      if (access.checkins) {
        const { data } = await db.from('checkins').select('checkin_date,pain_score,checkin_answers(snapshot,value_num,value_text,value_choice)').order('checkin_date', { ascending: false }).limit(7);
        // deno-lint-ignore no-explicit-any
        ctxInput.recentDays = (data ?? []).map((c: any) => {
          // deno-lint-ignore no-explicit-any
          const st = computeCheckinStats((c.checkin_answers ?? []).map((a: any) => ({ ...a, value_num: a.value_num === null ? null : Number(a.value_num) })));
          return { date: c.checkin_date, general: st.general, categories: st.categories.map((x) => ({ name: x.name, average: x.average })), pain: c.pain_score };
        });
      }
      if (access.goals) {
        const { data } = await db.from('goals').select('title,status').in('status', ['todo', 'in_progress']).limit(10);
        ctxInput.goals = data ?? [];
      }
      if (access.chronicles) {
        const { data } = await db.from('chronicles').select('title').order('chronicle_date', { ascending: false }).limit(3);
        ctxInput.chronicleTitles = (data ?? []).map((c: { title: string }) => c.title);
      }
      // Historique transmis par le client : non fiable, borné en nombre et en taille.
      const hist: ChatMsg[] = Array.isArray(body.history)
        ? (body.history as unknown[]).slice(-8).flatMap((h) => {
            const r = (h as { role?: unknown })?.role;
            const c = (h as { content?: unknown })?.content;
            return (r === 'user' || r === 'assistant') && typeof c === 'string' ? [{ role: r, content: c.slice(0, 1500) } as ChatMsg] : [];
          })
        : [];
      const res = await callAi(env, `${ASSISTANT_SYSTEM_PROMPT}\n\nContexte autorisé par la personne :\n${buildAssistantContext(ctxInput)}`, [...hist, { role: 'user', content: message }], { maxTokens: 500 });
      if (res.ok) out = { text: res.text.slice(0, 2500), mode: 'ai' };
      else {
        out = guidedReply(message, country);
        out.text = 'Je n\'arrive pas à joindre l\'IA pour le moment. ' + out.text;
      }
    }
  }

  // Mémoire : uniquement si activée par la personne.
  let conversationId: string | null = null;
  if (s.chatbot_memory_enabled) {
    conversationId = isUuid(body.conversationId) ? body.conversationId : null;
    if (conversationId) {
      const { data: own } = await db.from('chat_conversations').select('id').eq('id', conversationId).maybeSingle();
      if (!own) conversationId = null;
    }
    if (!conversationId) {
      const { data: c } = await admin.from('chat_conversations').insert({ user_id: userId, title: message.slice(0, 60) }).select('id').single();
      conversationId = c?.id ?? null;
    }
    if (conversationId) {
      const crisis = out.mode === 'crisis' || out.mode === 'distress';
      await admin.from('chat_messages').insert([
        { conversation_id: conversationId, user_id: userId, role: 'user', content: message, mode: out.mode === 'ai' ? 'ai' : 'guided', crisis },
        { conversation_id: conversationId, user_id: userId, role: 'assistant', content: out.text, mode: out.mode === 'ai' ? 'ai' : 'guided', crisis },
      ]);
      await admin.from('chat_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
    }
  }
  return reply(req, env, { ...out, conversationId });
});
