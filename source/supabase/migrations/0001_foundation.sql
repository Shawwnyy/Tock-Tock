-- ============================================================================
-- Tock Tock — 0001 : fondations
-- Schéma privé (non exposé par l'API), configuration, rôles et permissions du personnel.
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
-- Le rôle anon n'a volontairement AUCUN accès au schéma private.

create or replace function private.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Configuration modifiable (limites, quotas) — aucune valeur secrète ici.
-- ---------------------------------------------------------------------------
create table public.app_config (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.app_config enable row level security;

create or replace function private.cfg_bigint(p_key text, p_default bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::bigint from public.app_config where key = p_key), p_default)
$$;

create or replace function private.cfg_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::int from public.app_config where key = p_key), p_default)
$$;

insert into public.app_config (key, value, description) values
  ('media.max_image_bytes',      to_jsonb(5 * 1024 * 1024),   'Taille maximale d''une image (octets)'),
  ('media.max_audio_bytes',      to_jsonb(15 * 1024 * 1024),  'Taille maximale d''un fichier audio (octets)'),
  ('media.max_video_bytes',      to_jsonb(50 * 1024 * 1024),  'Taille maximale d''une vidéo (octets) — 50 Mo = plafond du plan gratuit Supabase'),
  ('media.max_document_bytes',   to_jsonb(10 * 1024 * 1024),  'Taille maximale d''un document PDF (octets)'),
  ('media.max_audio_seconds',    to_jsonb(600),               'Durée maximale déclarée d''un audio (secondes)'),
  ('media.max_video_seconds',    to_jsonb(120),               'Durée maximale déclarée d''une vidéo (secondes)'),
  ('media.quota_bytes_per_user', to_jsonb(100 * 1024 * 1024), 'Quota de stockage par membre (octets)'),
  ('media.max_uploads_per_day',  to_jsonb(20),                'Nombre maximal de téléversements par membre et par jour'),
  ('posts.max_per_day',          to_jsonb(20),                'Publications maximales par membre et par jour'),
  ('comments.max_per_hour',      to_jsonb(30),                'Commentaires maximaux par membre et par heure'),
  ('reports.max_per_day',        to_jsonb(20),                'Signalements maximaux par membre et par jour'),
  ('assistant.max_messages_per_day', to_jsonb(40),            'Messages maximaux à l''assistant par membre et par jour'),
  ('sanctions.max_limit_days',   to_jsonb(14),                'Durée maximale d''une limitation temporaire (jours)'),
  ('sanctions.max_suspension_days', to_jsonb(90),             'Durée maximale d''une suspension (jours)'),
  ('reports.auto_hold_threshold', to_jsonb(3),                'Nombre de signalements distincts déclenchant une mise en attente automatique');

-- ---------------------------------------------------------------------------
-- Rôles du personnel et permissions
-- ---------------------------------------------------------------------------
create table public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('moderator', 'senior_moderator', 'admin')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);
alter table public.staff_roles enable row level security;

create table public.role_permissions (
  role text not null check (role in ('moderator', 'senior_moderator', 'admin')),
  permission text not null,
  primary key (role, permission)
);
alter table public.role_permissions enable row level security;

-- Modérateur : traite la file de signalements, masque des contenus, avertit, limite brièvement.
-- Modérateur senior : + suspensions, examen des appels, historique de modération d'un membre.
-- Administrateur : + bannissements, ressources officielles, catégories, configuration, rôles, textes légaux.
-- AUCUN rôle n'a de permission sur les bilans, objectifs, chroniques ou conversations privées.
insert into public.role_permissions (role, permission)
select r.role, p.permission
from (values
  ('moderator', 'reports.view'), ('moderator', 'reports.act'), ('moderator', 'content.hide'),
  ('moderator', 'content.restore'), ('moderator', 'sanction.warn'), ('moderator', 'sanction.limit'),
  ('moderator', 'media.review'),
  ('senior_moderator', 'sanction.suspend'), ('senior_moderator', 'appeals.review'),
  ('senior_moderator', 'users.view_moderation_history'),
  ('admin', 'sanction.ban'), ('admin', 'resources.manage'), ('admin', 'categories.manage'),
  ('admin', 'config.manage'), ('admin', 'roles.manage'), ('admin', 'terms.manage'),
  ('admin', 'terms_filter.manage')
) as p(role, permission)
join (values ('moderator'), ('senior_moderator'), ('admin')) as r(role)
  on (r.role = p.role
      or (r.role = 'senior_moderator' and p.role = 'moderator')
      or (r.role = 'admin' and p.role in ('moderator', 'senior_moderator')));

create or replace function private.has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.staff_roles sr
    join public.role_permissions rp on rp.role = sr.role
    where sr.user_id = (select auth.uid()) and rp.permission = p_permission
  )
$$;

-- Politiques : lecture de son propre rôle ; gestion par RPC uniquement (voir 0005).
create policy staff_roles_select on public.staff_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_permission('roles.manage')));
create policy role_permissions_select on public.role_permissions for select to authenticated
  using ((select private.has_permission('roles.manage')) or exists (select 1 from public.staff_roles sr where sr.user_id = (select auth.uid()) and sr.role = role_permissions.role));

create policy app_config_select on public.app_config for select to authenticated using (true);
create policy app_config_admin_write on public.app_config for all to authenticated
  using ((select private.has_permission('config.manage')))
  with check ((select private.has_permission('config.manage')));

revoke all on public.app_config, public.staff_roles, public.role_permissions from anon, authenticated;
grant select on public.app_config, public.staff_roles, public.role_permissions to authenticated;
grant insert, update, delete on public.app_config to authenticated;
grant all on public.app_config, public.staff_roles, public.role_permissions to service_role;
