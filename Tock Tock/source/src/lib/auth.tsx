import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { db, supabase } from './supabase';

export interface LegalDoc { id: string; kind: 'community_rules' | 'privacy_policy' | 'chatbot_limits'; version: string; title: string; body_md: string; published_at: string; requires_reacceptance: boolean }

export interface Settings {
  timezone: string; age_band: 'under_15' | '15_17' | '18_plus' | null; bio: string | null;
  chronicle_enabled: boolean; chronicle_time: string; chronicle_email_enabled: boolean; chronicle_email_mode: 'notify' | 'pdf';
  pdf_include_sensitive: boolean; no_data_behavior: 'nothing' | 'reminder' | 'short';
  reminder_enabled: boolean; reminder_time: string; track_pain: boolean; ai_consent: boolean; ai_use_history: boolean;
  chatbot_memory_enabled: boolean; chatbot_access: { checkins: boolean; goals: boolean; chronicles: boolean; pain: boolean };
  notification_prefs: Record<string, boolean>; visibility: Record<string, string>; interests: string[];
}

export interface Me {
  id: string; email: string;
  profile: { handle: string; display_name: string | null; avatar_preset: string; onboarded_at: string | null; deactivated_at: string | null } | null;
  settings: Settings | null;
  pendingDocs: LegalDoc[];
  latestDocs: LegalDoc[];
  role: string | null;
}

interface AuthState { status: 'loading' | 'out' | 'in'; me: Me | null; refresh: () => Promise<void>; signOut: () => Promise<void> }
export const AuthContext = createContext<AuthState>({ status: 'loading', me: null, refresh: async () => {}, signOut: async () => {} });
export const useAuth = () => useContext(AuthContext);

/** Réplique côté interface la règle SQL private.rules_ok : sert uniquement à AFFICHER l'écran d'acceptation (la base décide). */
export function pendingDocuments(docs: LegalDoc[], acceptedIds: Set<string>, now = new Date()): { pending: LegalDoc[]; latest: LegalDoc[] } {
  const published = docs.filter((d) => new Date(d.published_at) <= now);
  const kinds = [...new Set(published.map((d) => d.kind))];
  const pending: LegalDoc[] = [];
  const latest: LegalDoc[] = [];
  for (const kind of kinds) {
    const ofKind = published.filter((d) => d.kind === kind).sort((a, b) => b.published_at.localeCompare(a.published_at));
    latest.push(ofKind[0]);
    const threshold = ofKind.filter((d) => d.requires_reacceptance).map((d) => d.published_at).sort().pop() ?? '';
    const ok = ofKind.some((d) => acceptedIds.has(d.id) && d.published_at >= threshold);
    if (!ok) pending.push(ofKind[0]);
  }
  return { pending, latest };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>(supabase ? 'loading' : 'out');
  const [me, setMe] = useState<Me | null>(null);

  const load = useCallback(async (session: Session | null) => {
    if (!session) {
      setMe(null);
      setStatus('out');
      return;
    }
    const uid = session.user.id;
    const [p, s, d, a, r] = await Promise.all([
      db().from('profiles').select('handle,display_name,avatar_preset,onboarded_at,deactivated_at').eq('id', uid).maybeSingle(),
      db().from('profile_settings').select('*').eq('user_id', uid).maybeSingle(),
      db().from('legal_documents').select('*'),
      db().from('rules_acceptances').select('document_id').eq('user_id', uid),
      db().from('staff_roles').select('role').eq('user_id', uid).limit(1),
    ]);
    const { pending, latest } = pendingDocuments((d.data ?? []) as LegalDoc[], new Set((a.data ?? []).map((x: { document_id: string }) => x.document_id)));
    setMe({
      id: uid, email: session.user.email ?? '', profile: p.data as Me['profile'], settings: s.data as Settings | null,
      pendingDocs: pending, latestDocs: latest, role: (r.data?.[0] as { role?: string } | undefined)?.role ?? null,
    });
    setStatus('in');
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e: string, session: Session | null) => {
      // Ne pas appeler Supabase directement dans le callback (risque d'interblocage) : on diffère.
      setTimeout(() => load(session), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const refresh = useCallback(async () => {
    const { data } = await db().auth.getSession();
    await load(data.session);
  }, [load]);
  const signOut = useCallback(async () => {
    await db().auth.signOut();
    setMe(null);
    setStatus('out');
  }, []);

  return <AuthContext.Provider value={{ status, me, refresh, signOut }}>{children}</AuthContext.Provider>;
}
