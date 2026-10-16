-- ============================================================================
-- Tock Tock — 0002 : identité, profils, règles, blocages, sanctions
-- Phase A : comptes, profils, identifiants uniques, règles et confidentialité.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Profils : identité PUBLIQUE minimale. Aucune donnée privée n'est stockée ici.
-- ---------------------------------------------------------------------------
create sequence public.profile_number_seq as bigint minvalue 1 start 1 no cycle;

create table public.profiles (
  -- Identifiant interne : immuable, distinct de l'identifiant public.
  id uuid primary key references auth.users(id) on delete cascade,
  -- Numéro public attribué par une SÉQUENCE : atomique, sans doublon même en parallèle.
  -- (Des trous sont possibles si une transaction est annulée : l'unicité prime sur la continuité.)
  public_number bigint not null unique default nextval('public.profile_number_seq'),
  -- Format affiché : user#00001. Au-delà de 99 999 comptes, le nombre s'allonge (user#100000).
  handle text generated always as (
    'user#' || case when public_number < 100000 then lpad(public_number::text, 5, '0') else public_number::text end
  ) stored,
  display_name text,
  avatar_preset text not null default 'sun',
  avatar_media_id uuid,
  created_at timestamptz not null default now(),
  onboarded_at timestamptz,
  deactivated_at timestamptz,
  constraint profiles_display_name_len check (display_name is null or char_length(display_name) between 2 and 30),
  constraint profiles_avatar_preset_chk check (avatar_preset in ('sun','leaf','wave','star','moon','flame','cloud','seed'))
);
alter sequence public.profile_number_seq owned by public.profiles.public_number;
create unique index profiles_handle_key on public.profiles (handle);
alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- Réglages privés (visibles uniquement par leur propriétaire)
-- ---------------------------------------------------------------------------
create table public.profile_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bio text,
  interests text[] not null default '{}',
  -- Visibilité : 'members' (tous les membres) ou 'private'. 'contacts' est réservé (fonction non activée).
  visibility jsonb not null default '{"bio":"private","interests":"private","shared_goals":"private","avatar":"members"}',
  age_band text check (age_band in ('under_15', '15_17', '18_plus')),
  timezone text not null default 'Europe/Paris',
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  chronicle_enabled boolean not null default false,
  chronicle_time time not null default '00:05',
  chronicle_email_enabled boolean not null default false,
  chronicle_email_mode text not null default 'notify' check (chronicle_email_mode in ('notify', 'pdf')),
  pdf_include_sensitive boolean not null default false,
  no_data_behavior text not null default 'nothing' check (no_data_behavior in ('nothing', 'reminder', 'short')),
  reminder_enabled boolean not null default false,
  reminder_time time not null default '20:00',
  track_pain boolean not null default false,
  ai_consent boolean not null default false,
  ai_consent_at timestamptz,
  ai_use_history boolean not null default false,
  chatbot_memory_enabled boolean not null default false,
  chatbot_access jsonb not null default '{"checkins":false,"goals":false,"chronicles":false,"pain":false}',
  notification_prefs jsonb not null default
    '{"reaction":true,"comment":true,"reply":true,"moderation":true,"report_result":true,"reminder":false,"chronicle":true,"goal_due":true}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_bio_len check (bio is null or char_length(bio) <= 280),
  constraint settings_email_needs_chronicle check (not chronicle_email_enabled or chronicle_enabled)
);
alter table public.profile_settings enable row level security;

create or replace function private.validate_profile_settings() returns trigger
language plpgsql set search_path = '' as $$
declare k text; v jsonb; i text;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;

  if jsonb_typeof(new.visibility) <> 'object' then raise exception 'invalid_visibility'; end if;
  for k, v in select * from jsonb_each(new.visibility) loop
    if k not in ('bio', 'interests', 'shared_goals', 'avatar') or v not in ('"members"', '"private"') then
      raise exception 'invalid_visibility' using errcode = '22023';
    end if;
  end loop;

  if jsonb_typeof(new.notification_prefs) <> 'object' then raise exception 'invalid_notification_prefs'; end if;
  for k, v in select * from jsonb_each(new.notification_prefs) loop
    if k not in ('reaction','comment','reply','moderation','report_result','reminder','chronicle','goal_due')
       or jsonb_typeof(v) <> 'boolean' then
      raise exception 'invalid_notification_prefs' using errcode = '22023';
    end if;
  end loop;

  if jsonb_typeof(new.chatbot_access) <> 'object' then raise exception 'invalid_chatbot_access'; end if;
  for k, v in select * from jsonb_each(new.chatbot_access) loop
    if k not in ('checkins', 'goals', 'chronicles', 'pain') or jsonb_typeof(v) <> 'boolean' then
      raise exception 'invalid_chatbot_access' using errcode = '22023';
    end if;
  end loop;

  if coalesce(array_length(new.interests, 1), 0) > 10 then raise exception 'too_many_interests' using errcode = '22023'; end if;
  foreach i in array new.interests loop
    if char_length(i) not between 1 and 30 then raise exception 'invalid_interest' using errcode = '22023'; end if;
  end loop;

  -- Les mineurs de moins de 15 ans n'ont pas accès au traitement par un fournisseur d'IA externe.
  if new.ai_consent and new.age_band = 'under_15' then
    raise exception 'ai_not_allowed_for_age' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.ai_consent then new.ai_consent_at := now(); end if;
  elsif new.ai_consent is distinct from old.ai_consent then
    new.ai_consent_at := case when new.ai_consent then now() else null end;
  end if;

  new.updated_at := now();
  return new;
end $$;
create trigger profile_settings_validate before insert or update on public.profile_settings
  for each row execute function private.validate_profile_settings();

-- ---------------------------------------------------------------------------
-- Création automatique du profil à l'inscription (déclenché par Supabase Auth)
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.profile_settings (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Documents légaux versionnés et acceptation explicite
-- ---------------------------------------------------------------------------
create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('community_rules', 'privacy_policy', 'chatbot_limits')),
  version text not null,
  title text not null,
  body_md text not null,
  published_at timestamptz not null default now(),
  -- true : un changement important -> chaque membre doit réaccepter.
  requires_reacceptance boolean not null default true,
  unique (kind, version)
);
alter table public.legal_documents enable row level security;

create table public.rules_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.legal_documents(id),
  accepted_at timestamptz not null default now(),
  primary key (user_id, document_id)
);
alter table public.rules_acceptances enable row level security;

-- Vrai si le membre a accepté, pour CHAQUE type de document, une version au moins aussi récente
-- que la dernière version « importante » publiée.
create or replace function private.rules_ok(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and not exists (
    select 1
    from (select distinct kind from public.legal_documents where published_at <= now()) k
    where not exists (
      select 1
      from public.rules_acceptances ra
      join public.legal_documents d on d.id = ra.document_id
      where ra.user_id = p_uid
        and d.kind = k.kind
        and d.published_at >= coalesce(
              (select max(r.published_at) from public.legal_documents r
                where r.kind = k.kind and r.requires_reacceptance and r.published_at <= now()),
              '-infinity'::timestamptz)
    )
  )
$$;

create or replace function public.accept_rules(p_versions jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); k text; doc public.legal_documents;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  foreach k in array array['community_rules', 'privacy_policy', 'chatbot_limits'] loop
    select * into doc from public.legal_documents
      where kind = k and published_at <= now() order by published_at desc limit 1;
    if doc.id is null then raise exception 'document_missing:%', k; end if;
    -- Le membre doit avoir vu la version en vigueur : sinon on lui demande de relire.
    if (p_versions ->> k) is distinct from doc.version then
      raise exception 'stale_or_missing_version:%', k using errcode = 'P0001';
    end if;
    insert into public.rules_acceptances (user_id, document_id) values (v_uid, doc.id) on conflict do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Blocages et mises en sourdine
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'block' check (mode in ('block', 'mute')),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
create index blocks_blocked_idx on public.blocks (blocked_id);

-- Vrai si 'a' ne doit pas voir 'b' (ou l'inverse) : blocage dans un sens ou dans l'autre,
-- ou mise en sourdine par 'a'. Fonction DEFINER : le bloqué ne peut pas lire la table blocks,
-- mais le filtrage doit s'appliquer à lui aussi.
create or replace function private.hidden_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a and mode = 'block')
  )
$$;

-- ---------------------------------------------------------------------------
-- Journal de modération (append-only) et sanctions
-- ---------------------------------------------------------------------------
create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  moderator_id uuid references auth.users(id) on delete set null,
  moderator_handle text,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  target_user_handle text,
  target_type text,
  target_id uuid,
  report_id uuid,
  reason text,
  explanation text,
  details jsonb not null default '{}'
);
alter table public.moderation_actions enable row level security;
create index moderation_actions_target_idx on public.moderation_actions (target_user_id, created_at desc);

-- Journal immuable : aucune modification ni suppression, sauf l'anonymisation des clés
-- étrangères quand un compte est supprimé (ON DELETE SET NULL).
create or replace function private.moderation_actions_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'moderation_log_is_append_only' using errcode = '42501'; end if;
  if (to_jsonb(new) - 'moderator_id' - 'target_user_id') = (to_jsonb(old) - 'moderator_id' - 'target_user_id')
     and (new.moderator_id is null or new.moderator_id = old.moderator_id)
     and (new.target_user_id is null or new.target_user_id = old.target_user_id) then
    return new;
  end if;
  raise exception 'moderation_log_is_append_only' using errcode = '42501';
end $$;
create trigger moderation_actions_immutable before update or delete on public.moderation_actions
  for each row execute function private.moderation_actions_immutable();

create table public.sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_handle text not null,
  kind text not null check (kind in ('warning', 'limit', 'suspension', 'ban')),
  reason_code text not null,
  explanation text not null check (char_length(explanation) >= 10),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  report_id uuid,
  action_id uuid references public.moderation_actions(id),
  constraint sanctions_duration_chk check (
    (kind = 'ban' and ends_at is null)
    or (kind in ('limit', 'suspension') and ends_at is not null and ends_at > starts_at)
    or (kind = 'warning'))
);
alter table public.sanctions enable row level security;
create index sanctions_user_idx on public.sanctions (user_id, created_at desc);

-- Restriction communautaire en vigueur : 'ban' > 'suspension' > 'limit' > null.
-- Les sanctions ne concernent QUE la communauté : jamais l'accès à ses propres données.
create or replace function private.active_restriction(p_uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.sanctions s where s.user_id = p_uid and s.kind = 'ban' and s.revoked_at is null) then 'ban'
    when exists (select 1 from public.sanctions s where s.user_id = p_uid and s.kind = 'suspension' and s.revoked_at is null
                   and s.starts_at <= now() and s.ends_at > now()) then 'suspension'
    when exists (select 1 from public.sanctions s where s.user_id = p_uid and s.kind = 'limit' and s.revoked_at is null
                   and s.starts_at <= now() and s.ends_at > now()) then 'limit'
    else null end
$$;

-- Peut LIRE la communauté : règles acceptées, profil terminé, compte actif, pas banni/suspendu,
-- et pas de déclaration « moins de 15 ans » (accès communautaire fermé tant qu'aucun consentement parental n'existe).
create or replace function private.can_read_community(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null
    and exists (select 1 from public.profiles p where p.id = p_uid and p.onboarded_at is not null and p.deactivated_at is null)
    and exists (select 1 from public.profile_settings s where s.user_id = p_uid and s.age_band is distinct from 'under_15')
    and private.rules_ok(p_uid)
    and coalesce(private.active_restriction(p_uid), 'none') in ('none', 'limit')
$$;

-- Peut PUBLIER / COMMENTER / RÉAGIR : lecture possible ET aucune limitation en cours.
create or replace function private.can_participate(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_read_community(p_uid) and private.active_restriction(p_uid) is null
$$;

create or replace function private.is_minor(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.age_band in ('under_15', '15_17') from public.profile_settings s where s.user_id = p_uid), false)
$$;

-- ---------------------------------------------------------------------------
-- Rôles du personnel : attribution par RPC auditée
-- ---------------------------------------------------------------------------
create or replace function public.grant_staff_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if not private.has_permission('roles.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('moderator', 'senior_moderator', 'admin') then raise exception 'invalid_role' using errcode = '22023'; end if;
  insert into public.staff_roles (user_id, role, granted_by) values (p_user, p_role, v_actor)
    on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by, granted_at = now();
  insert into public.moderation_actions (moderator_id, moderator_handle, action, target_user_id, target_user_handle, details)
    values (v_actor, (select handle from public.profiles where id = v_actor), 'role_granted', p_user,
            (select handle from public.profiles where id = p_user), jsonb_build_object('role', p_role));
end $$;

create or replace function public.revoke_staff_role(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if not private.has_permission('roles.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select role from public.staff_roles where user_id = p_user) = 'admin'
     and (select count(*) from public.staff_roles where role = 'admin') <= 1 then
    raise exception 'last_admin' using errcode = 'P0001';
  end if;
  delete from public.staff_roles where user_id = p_user;
  insert into public.moderation_actions (moderator_id, moderator_handle, action, target_user_id, target_user_handle)
    values (v_actor, (select handle from public.profiles where id = v_actor), 'role_revoked', p_user,
            (select handle from public.profiles where id = p_user));
end $$;

-- ---------------------------------------------------------------------------
-- Sanctions : proportionnées, expliquées, traçables
-- ---------------------------------------------------------------------------
create or replace function public.apply_sanction(
  p_user uuid, p_kind text, p_reason_code text, p_explanation text,
  p_days int default null, p_report_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_perm text;
  v_ends timestamptz;
  v_action uuid;
  v_id uuid;
  v_handle text;
begin
  v_perm := case p_kind when 'warning' then 'sanction.warn' when 'limit' then 'sanction.limit'
                        when 'suspension' then 'sanction.suspend' when 'ban' then 'sanction.ban' end;
  if v_perm is null then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if not private.has_permission(v_perm) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = v_actor then raise exception 'cannot_sanction_self' using errcode = '42501'; end if;
  if exists (select 1 from public.staff_roles where user_id = p_user) and not private.has_permission('roles.manage') then
    raise exception 'cannot_sanction_staff' using errcode = '42501';
  end if;
  if p_explanation is null or char_length(trim(p_explanation)) < 10 then
    raise exception 'explanation_required' using errcode = '22023';
  end if;
  select handle into v_handle from public.profiles where id = p_user;
  if v_handle is null then raise exception 'unknown_user' using errcode = '22023'; end if;

  if p_kind = 'limit' then
    if p_days is null or p_days < 1 or p_days > private.cfg_int('sanctions.max_limit_days', 14) then
      raise exception 'invalid_duration' using errcode = '22023';
    end if;
    v_ends := now() + make_interval(days => p_days);
  elsif p_kind = 'suspension' then
    if p_days is null or p_days < 1 or p_days > private.cfg_int('sanctions.max_suspension_days', 90) then
      raise exception 'invalid_duration' using errcode = '22023';
    end if;
    v_ends := now() + make_interval(days => p_days);
  end if;

  insert into public.moderation_actions (moderator_id, moderator_handle, action, target_user_id, target_user_handle,
                                         report_id, reason, explanation, details)
    values (v_actor, (select handle from public.profiles where id = v_actor), 'sanction_' || p_kind, p_user, v_handle,
            p_report_id, p_reason_code, p_explanation, jsonb_build_object('days', p_days))
    returning id into v_action;

  insert into public.sanctions (user_id, user_handle, kind, reason_code, explanation, ends_at, created_by, report_id, action_id)
    values (p_user, v_handle, p_kind, p_reason_code, p_explanation, v_ends, v_actor, p_report_id, v_action)
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.revoke_sanction(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); s public.sanctions;
begin
  select * into s from public.sanctions where id = p_id;
  if s.id is null then raise exception 'unknown_sanction' using errcode = '22023'; end if;
  if not (private.has_permission('sanction.suspend') or private.has_permission('appeals.review')
          or (s.kind in ('warning', 'limit') and private.has_permission('sanction.limit'))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.sanctions set revoked_at = now(), revoked_by = v_actor where id = p_id and revoked_at is null;
  insert into public.moderation_actions (moderator_id, moderator_handle, action, target_user_id, target_user_handle, reason, details)
    values (v_actor, (select handle from public.profiles where id = v_actor), 'sanction_revoked', s.user_id, s.user_handle,
            p_note, jsonb_build_object('sanction_id', p_id));
end $$;

-- ---------------------------------------------------------------------------
-- Désactivation / réactivation du compte (réversible), distincte de la suppression
-- ---------------------------------------------------------------------------
create or replace function public.deactivate_account() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set deactivated_at = now() where id = (select auth.uid()) and deactivated_at is null
$$;
create or replace function public.reactivate_account() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set deactivated_at = null where id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- Politiques RLS
-- ---------------------------------------------------------------------------
-- Profils : on voit son propre profil ; les autres seulement si on peut lire la communauté,
-- que le profil est terminé et actif, et qu'aucun blocage n'existe.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (
      onboarded_at is not null and deactivated_at is null
      and (select private.can_read_community())
      and not private.hidden_between((select auth.uid()), id)
    )
    or (select private.has_permission('reports.view'))
  );
-- Aucune politique INSERT/UPDATE/DELETE : toute modification passe par des RPC SECURITY DEFINER.

create policy settings_select_own on public.profile_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy settings_update_own on public.profile_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy legal_documents_select on public.legal_documents for select to authenticated
  using (published_at <= now());
create policy legal_documents_admin_insert on public.legal_documents for insert to authenticated
  with check ((select private.has_permission('terms.manage')));

create policy acceptances_select_own on public.rules_acceptances for select to authenticated
  using (user_id = (select auth.uid()));

create policy blocks_select_own on public.blocks for select to authenticated using (blocker_id = (select auth.uid()));
create policy blocks_insert_own on public.blocks for insert to authenticated with check (blocker_id = (select auth.uid()));
create policy blocks_update_own on public.blocks for update to authenticated
  using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));
create policy blocks_delete_own on public.blocks for delete to authenticated using (blocker_id = (select auth.uid()));

create policy moderation_actions_staff_select on public.moderation_actions for select to authenticated
  using ((select private.has_permission('reports.view')));

create policy sanctions_select on public.sanctions for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_permission('reports.view')));

-- ---------------------------------------------------------------------------
-- Droits (principe du moindre privilège : on retire tout, puis on accorde le strict nécessaire)
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.profile_settings, public.legal_documents, public.rules_acceptances,
              public.blocks, public.moderation_actions, public.sanctions from anon, authenticated;
revoke all on sequence public.profile_number_seq from anon, authenticated;

grant select on public.profiles, public.legal_documents, public.rules_acceptances, public.blocks,
                public.moderation_actions, public.sanctions to authenticated;
grant insert on public.legal_documents to authenticated;
grant insert, update, delete on public.blocks to authenticated;
-- profile_settings : lecture + mise à jour des SEULES colonnes modifiables par le membre.
-- (age_band, ai_consent_at et user_id ne sont pas modifiables directement.)
grant select on public.profile_settings to authenticated;
grant update (bio, interests, visibility, timezone, locale, chronicle_enabled, chronicle_time,
              chronicle_email_enabled, chronicle_email_mode, pdf_include_sensitive, no_data_behavior,
              reminder_enabled, reminder_time, track_pain, ai_consent, ai_use_history,
              chatbot_memory_enabled, chatbot_access, notification_prefs)
  on public.profile_settings to authenticated;

grant all on public.profiles, public.profile_settings, public.legal_documents, public.rules_acceptances,
             public.blocks, public.moderation_actions, public.sanctions to service_role;
grant usage, select on sequence public.profile_number_seq to service_role;

revoke execute on function public.accept_rules(jsonb), public.grant_staff_role(uuid, text),
  public.revoke_staff_role(uuid), public.apply_sanction(uuid, text, text, text, int, uuid),
  public.revoke_sanction(uuid, text), public.deactivate_account(), public.reactivate_account()
  from public, anon;
grant execute on function public.accept_rules(jsonb), public.grant_staff_role(uuid, text),
  public.revoke_staff_role(uuid), public.apply_sanction(uuid, text, text, text, int, uuid),
  public.revoke_sanction(uuid, text), public.deactivate_account(), public.reactivate_account()
  to authenticated, service_role;
