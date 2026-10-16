import { useState } from 'react';
import { callFunction, db, friendlyError } from '../lib/supabase';
import { useAuth, type Settings as S } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { MdLite } from '../components/MdLite';
import { Alert, AVATARS, Button, Card, Field, Loading, Toggle, useAction, useAsync } from '../components/ui';

type Patch = Partial<S>;

export function Settings() {
  const { me, refresh, signOut } = useAuth();
  const s = me!.settings!;
  const [draft, setDraft] = useState<S>(s);
  const [name, setName] = useState(me!.profile?.display_name ?? '');
  const act = useAction();
  const set = (p: Patch) => setDraft((d) => ({ ...d, ...p }));

  const saveSettings = (cols: (keyof S)[], msg = 'Réglages enregistrés.') => act.run(async () => {
    const patch: Record<string, unknown> = {};
    for (const c of cols) patch[c as string] = draft[c];
    if (patch.ai_consent === true && !s.ai_consent) patch.ai_consent = true;
    const { error } = await db().from('profile_settings').update(patch).eq('user_id', me!.id);
    if (error) throw new Error(friendlyError(error));
    await refresh();
    return msg;
  });

  return (
    <div className="stack">
      {act.error && <Alert kind="error">{act.error}</Alert>}
      {act.done && <Alert kind="success">{act.done}</Alert>}

      <Card title="Mon profil">
        <p>Identifiant public : <strong className="handle">{me!.profile?.handle}</strong> (permanent) · {me!.email ? <>E-mail : {me!.email}</> : <>Connexion par téléphone (pas d'e-mail enregistré)</>} <span className="muted">(jamais visible des autres)</span></p>
        <Field id="dn" label="Pseudonyme" hint="Modifiable de temps en temps (limite de fréquence). Les noms trompeurs ou réservés sont refusés.">
          <input id="dn" value={name} minLength={2} maxLength={30} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button variant="ghost" disabled={name.trim() === me!.profile?.display_name} onClick={() => act.run(async () => { const { error } = await db().rpc('set_display_name', { p_name: name.trim() }); if (error) throw new Error(friendlyError(error)); await refresh(); return 'Pseudonyme mis à jour.'; })}>Changer le pseudonyme</Button>
        <fieldset><legend>Avatar</legend><div className="row">{Object.entries(AVATARS).map(([k, e]) => <button key={k} type="button" className={`pill ${me!.profile?.avatar_preset === k ? 'on' : ''}`} aria-label={`Avatar ${k}`} aria-pressed={me!.profile?.avatar_preset === k} onClick={() => act.run(async () => { const { error } = await db().rpc('set_avatar_preset', { p_preset: k }); if (error) throw new Error(friendlyError(error)); await refresh(); })}>{e}</button>)}</div></fieldset>
        <Field id="bio" label="Présentation (280 caractères max.)"><textarea id="bio" rows={3} maxLength={280} value={draft.bio ?? ''} onChange={(e) => set({ bio: e.target.value || null })} /></Field>
        <Field id="vis" label="Qui peut voir ma présentation ?">
          <select id="vis" value={draft.visibility.bio ?? 'private'} onChange={(e) => set({ visibility: { ...draft.visibility, bio: e.target.value, interests: e.target.value, shared_goals: draft.visibility.shared_goals } })}><option value="private">Personne (privé)</option><option value="members">Les membres</option></select>
        </Field>
        <Toggle id="sg" label="Les membres peuvent voir mes objectifs partagés" hint="Seuls les titres des objectifs que tu choisis de montrer sont concernés." checked={draft.visibility.shared_goals === 'members'} onChange={(v) => set({ visibility: { ...draft.visibility, shared_goals: v ? 'members' : 'private' } })} />
        <Button onClick={() => saveSettings(['bio', 'visibility'])}>Enregistrer</Button>
      </Card>

      <Card title="Mon suivi">
        <Toggle id="pain" label="Suivre la douleur (facultatif)" hint="Mesure à part, jamais incluse dans les moyennes, jamais visible des autres." checked={draft.track_pain} onChange={(v) => set({ track_pain: v })} />
        <Field id="tz" label="Fuseau horaire"><input id="tz" value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} /></Field>
        <Button onClick={() => saveSettings(['track_pain', 'timezone'])}>Enregistrer</Button>
      </Card>

      <Card title="Chroniques de minuit et rappels">
        <Toggle id="ch" label="Générer ma chronique automatiquement" checked={draft.chronicle_enabled} onChange={(v) => set({ chronicle_enabled: v, chronicle_email_enabled: v ? draft.chronicle_email_enabled : false })} />
        <Field id="cht" label="Heure de génération (heure locale)" hint="Avant midi : chronique de la veille. À midi ou après : chronique du jour."><input id="cht" type="time" value={draft.chronicle_time.slice(0, 5)} onChange={(e) => set({ chronicle_time: e.target.value })} /></Field>
        <Toggle id="che" label="Recevoir un e-mail" hint={me!.email ? undefined : 'Indisponible : ton compte est lié à un numéro de téléphone, sans adresse e-mail.'} disabled={!draft.chronicle_enabled || !me!.email} checked={draft.chronicle_email_enabled && !!me!.email} onChange={(v) => set({ chronicle_email_enabled: v })} />
        <Field id="chm" label="Contenu de l'e-mail" hint="« Notification » : aucune donnée dans l'e-mail. « PDF » : ta chronique est jointe ; un e-mail n'est pas chiffré de bout en bout.">
          <select id="chm" value={draft.chronicle_email_mode} onChange={(e) => set({ chronicle_email_mode: e.target.value as S['chronicle_email_mode'] })}><option value="notify">Notification sans données</option><option value="pdf">Chronique en PDF</option></select>
        </Field>
        <Toggle id="pdfs" label="Inclure la douleur et mes notes personnelles dans le PDF" checked={draft.pdf_include_sensitive} onChange={(v) => set({ pdf_include_sensitive: v })} />
        <Field id="nd" label="Si je n'ai pas rempli de bilan"><select id="nd" value={draft.no_data_behavior} onChange={(e) => set({ no_data_behavior: e.target.value as S['no_data_behavior'] })}><option value="nothing">Ne rien envoyer</option><option value="reminder">M'envoyer un rappel doux</option><option value="short">Créer une courte chronique « pas de données »</option></select></Field>
        <Toggle id="rem" label="Rappel de bilan par e-mail" checked={draft.reminder_enabled} onChange={(v) => set({ reminder_enabled: v, notification_prefs: { ...draft.notification_prefs, reminder: v } })} />
        <Field id="remt" label="Heure du rappel"><input id="remt" type="time" value={draft.reminder_time.slice(0, 5)} onChange={(e) => set({ reminder_time: e.target.value })} /></Field>
        <Button onClick={() => saveSettings(['chronicle_enabled', 'chronicle_time', 'chronicle_email_enabled', 'chronicle_email_mode', 'pdf_include_sensitive', 'no_data_behavior', 'reminder_enabled', 'reminder_time', 'notification_prefs'])}>Enregistrer</Button>
        <p className="muted">L'envoi par e-mail ne fonctionne que si l'hébergeur de l'application a configuré le service d'envoi.</p>
      </Card>

      <Card title="Assistant et IA">
        <Toggle id="ai" label="Autoriser l'IA (génération de chroniques et assistant)" hint="Désactivé : modèle standard et mode guidé uniquement, sans aucun envoi de données à un fournisseur d'IA." checked={draft.ai_consent} onChange={(v) => set({ ai_consent: v })} />
        <Toggle id="aih" label="L'IA peut comparer avec mon historique" checked={draft.ai_use_history} disabled={!draft.ai_consent} onChange={(v) => set({ ai_use_history: v })} />
        <Toggle id="mem" label="Mémoire de l'assistant" hint="Désactivée par défaut. Activée, tes conversations sont enregistrées (et supprimables)." checked={draft.chatbot_memory_enabled} onChange={(v) => set({ chatbot_memory_enabled: v })} />
        <fieldset><legend>Données que l'assistant peut consulter</legend>
          {(['checkins', 'goals', 'chronicles', 'pain'] as const).map((k) => <Toggle key={k} id={`acc-${k}`} label={{ checkins: 'Mes bilans (moyennes récentes)', goals: 'Mes objectifs', chronicles: 'Les titres de mes chroniques', pain: 'Ma douleur' }[k]} checked={draft.chatbot_access[k]} onChange={(v) => set({ chatbot_access: { ...draft.chatbot_access, [k]: v } })} />)}
        </fieldset>
        <Button onClick={() => saveSettings(['ai_consent', 'ai_use_history', 'chatbot_memory_enabled', 'chatbot_access'])}>Enregistrer</Button>
      </Card>

      <Card title="Notifications">
        {(['reaction', 'comment', 'reply', 'moderation', 'report_result', 'chronicle', 'goal_due'] as const).map((k) => <Toggle key={k} id={`n-${k}`} label={{ reaction: 'Réactions', comment: 'Commentaires', reply: 'Réponses', moderation: 'Décisions de modération', report_result: 'Résultat de mes signalements', chronicle: 'Chronique prête', goal_due: 'Échéances d\'objectifs' }[k]} checked={draft.notification_prefs[k] !== false} onChange={(v) => set({ notification_prefs: { ...draft.notification_prefs, [k]: v } })} />)}
        <Button onClick={() => saveSettings(['notification_prefs'])}>Enregistrer</Button>
      </Card>

      <BlocksAndAppeals />
      <Legal />

      <Card title="Mes données et mon compte">
        <Button variant="ghost" onClick={() => act.run(async () => {
          const { data, error } = await db().rpc('export_my_data');
          if (error) throw new Error(friendlyError(error));
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
          const a = document.createElement('a'); a.href = url; a.download = 'mes-donnees-tock-tock.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
          return 'Export téléchargé.';
        })}>Exporter toutes mes données (JSON)</Button>
        <Button variant="ghost" onClick={() => { if (confirm('Désactiver ton compte ? Il sera masqué ; tu pourras le réactiver en te reconnectant.')) act.run(async () => { const { error } = await db().rpc('deactivate_account'); if (error) throw new Error(friendlyError(error)); await refresh(); }); }}>Désactiver temporairement mon compte</Button>
        <DeleteAccount />
        <Button variant="ghost" onClick={signOut}>Me déconnecter</Button>
      </Card>
    </div>
  );
}

function DeleteAccount() {
  const act = useAction();
  const { signOut } = useAuth();
  const [txt, setTxt] = useState('');
  return (
    <div className="danger-zone">
      <h3>Supprimer définitivement mon compte</h3>
      <p>Tes bilans, objectifs, chroniques, fichiers et publications seront effacés. <strong>Cette action est irréversible.</strong> Tape SUPPRIMER pour confirmer.</p>
      <input aria-label="Confirmation" value={txt} onChange={(e) => setTxt(e.target.value)} />
      {act.error && <Alert kind="error">{act.error}</Alert>}
      <Button variant="danger" busy={act.busy} disabled={txt !== 'SUPPRIMER'} onClick={() => act.run(async () => { const r = await callFunction('delete-account', { confirm: 'SUPPRIMER' }); if (!r.ok) throw new Error('La suppression a échoué. Réessaie ou contacte l\'équipe.'); await signOut(); })}>Supprimer mon compte</Button>
    </div>
  );
}

function BlocksAndAppeals() {
  const { me } = useAuth();
  const act = useAction();
  const [msg, setMsg] = useState('');
  const blocks = useAsync(async () => {
    const { data } = await db().from('blocks').select('blocked_id,mode').eq('blocker_id', me!.id);
    const ids = (data ?? []).map((b: { blocked_id: string }) => b.blocked_id);
    const { data: prof } = ids.length ? await db().from('member_profiles').select('id,handle,display_name').in('id', ids) : { data: [] };
    return (data ?? []).map((b: { blocked_id: string; mode: string }) => ({ ...b, p: (prof ?? []).find((x: { id: string }) => x.id === b.blocked_id) as { handle: string; display_name: string } | undefined }));
  }, []);
  const mod = useAsync(async () => {
    const [a, r] = await Promise.all([db().from('appeals').select('id,message,status,decision_note,created_at').eq('user_id', me!.id).order('created_at', { ascending: false }).limit(10), db().from('reports').select('id,reason,status,decision,created_at').eq('reporter_id', me!.id).order('created_at', { ascending: false }).limit(10)]);
    return { appeals: (a.data ?? []) as { id: string; message: string; status: string; decision_note: string | null; created_at: string }[], reports: (r.data ?? []) as { id: string; reason: string; status: string; decision: string | null; created_at: string }[] };
  }, []);
  return (
    <Card title="Blocages, signalements et contestations">
      <h3>Membres bloqués</h3>
      {blocks.loading ? <Loading /> : blocks.data?.length ? <ul className="plain">{blocks.data.map((b: { blocked_id: string; p?: { handle: string; display_name: string } }) => <li key={b.blocked_id} className="item"><span>{b.p?.display_name ?? 'Membre'} <span className="handle">{b.p?.handle ?? ''}</span></span><Button variant="ghost" onClick={async () => { await db().from('blocks').delete().eq('blocked_id', b.blocked_id).eq('blocker_id', me!.id); blocks.reload(); }}>Débloquer</Button></li>)}</ul> : <p className="muted">Personne.</p>}
      <h3>Mes signalements</h3>
      {mod.data?.reports.length ? <ul className="plain">{mod.data.reports.map((r) => <li key={r.id} className="item"><span>{r.reason}</span><span className="muted">{r.status === 'closed' ? 'traité' : 'en cours'} · {timeAgo(r.created_at)}</span></li>)}</ul> : <p className="muted">Aucun.</p>}
      <h3>Contester une décision de modération</h3>
      <p className="muted">Si un contenu a été retiré ou une sanction appliquée, explique-nous pourquoi tu penses que c'est une erreur. Un autre membre de l'équipe relira.</p>
      <textarea aria-label="Ma contestation" rows={3} maxLength={2000} value={msg} onChange={(e) => setMsg(e.target.value)} />
      {act.error && <Alert kind="error">{act.error}</Alert>}
      {act.done && <Alert kind="success">{act.done}</Alert>}
      <Button disabled={msg.trim().length < 10} busy={act.busy} onClick={() => act.run(async () => { const { error } = await db().from('appeals').insert({ user_id: me!.id, user_handle: me!.profile!.handle, message: msg.trim() }); if (error) throw new Error(friendlyError(error)); setMsg(''); mod.reload(); return 'Contestation envoyée.'; })}>Envoyer ma contestation</Button>
      {mod.data?.appeals.map((a) => <p key={a.id} className="muted">• {timeAgo(a.created_at)} — {a.status === 'open' ? 'en cours d\'examen' : a.status === 'overturned' ? 'décision annulée' : 'décision maintenue'}{a.decision_note ? ` : ${a.decision_note}` : ''}</p>)}
    </Card>
  );
}

function Legal() {
  const { me } = useAuth();
  return (
    <Card title="Règles et confidentialité">
      {me!.latestDocs.map((d) => <details key={d.id}><summary>{d.title} <span className="muted">(version {d.version})</span></summary><MdLite text={d.body_md} /></details>)}
    </Card>
  );
}
