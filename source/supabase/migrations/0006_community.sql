-- ============================================================================
-- Tock Tock — 0006 : communauté, signalements, modération humaine, appels
-- Phase C. Principes : aucune donnée privée n'alimente le fil ; toute publication résulte d'une action explicite ;
-- la modération automatique (0004) s'applique côté BASE DE DONNÉES (impossible à contourner depuis le navigateur) ;
-- les décisions humaines passent par des RPC auditées ; aucun classement de popularité.
-- ============================================================================

alter table public.profiles drop column avatar_media_id;   -- avatars : préréglages uniquement (aucun fichier à modérer)

-- ---------------------------------------------------------------------------
-- Catégories (modifiables par l'administration)
-- ---------------------------------------------------------------------------
create table public.post_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  label text not null check (char_length(label) between 2 and 60),
  description text,
  sort_order int not null default 0,
  is_active boolean not null default true
);
alter table public.post_categories enable row level security;
insert into public.post_categories (slug, label, description, sort_order) values
  ('bien-etre',     'Bien-être au quotidien',  'Petites attentions, rythme, repos, sérénité.', 1),
  ('organisation',  'Organisation et habitudes', 'Routines, planification, habitudes qui tiennent.', 2),
  ('objectifs',     'Objectifs personnels',    'Se fixer un cap et avancer par petites étapes.', 3),
  ('etudes-travail','Études et travail',       'Révisions, projets, concentration, équilibre.', 4),
  ('loisirs',       'Loisirs et passions',     'Ce qui nous fait du bien et nous passionne.', 5),
  ('ressources',    'Conseils et ressources',  'Astuces, outils et ressources utiles à partager.', 6),
  ('victoires',     'Petites victoires',       'Célébrer ce qui a été accompli, même modestement.', 7),
  ('entraide',      'Entraide',                'Demander ou offrir un coup de main, avec bienveillance.', 8);

-- Contexte privilégié : vrai uniquement quand l'instruction s'exécute avec les droits du propriétaire ou du serveur
-- (RPC SECURITY DEFINER de modération, clé service, console SQL). Faux pour toute requête d'un navigateur
-- (rôles authenticated / anon) : un membre ne peut donc JAMAIS changer lui-même le statut de modération d'un contenu.
create or replace function private.in_mod_ctx() returns boolean
language sql stable set search_path = '' as $$
  select current_user not in ('authenticated', 'anon')
$$;

-- ---------------------------------------------------------------------------
-- Publications
-- ---------------------------------------------------------------------------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.post_categories(id),
  kind text not null default 'text' check (kind in ('text', 'tip', 'question', 'encouragement', 'goal', 'resource', 'victory')),
  title text check (title is null or char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  status text not null default 'published' check (status in ('draft', 'published', 'pending_review', 'hidden', 'removed')),
  moderation jsonb not null default '{}',
  -- Pour les ressources et documents : le membre atteste avoir le droit de les partager.
  rights_attested boolean not null default false,
  comment_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  search tsvector generated always as (to_tsvector('french'::regconfig, coalesce(title, '') || ' ' || body)) stored
);
create index posts_feed_idx on public.posts (created_at desc) where status = 'published';
create index posts_author_idx on public.posts (author_id, created_at desc);
create index posts_category_idx on public.posts (category_id, created_at desc) where status = 'published';
create index posts_search_idx on public.posts using gin (search);
alter table public.posts enable row level security;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  status text not null default 'published' check (status in ('published', 'pending_review', 'hidden', 'removed')),
  moderation jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz
);
create index comments_post_idx on public.comments (post_id, created_at);
alter table public.comments enable row level security;

create table public.reactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  kind text not null check (kind in ('support', 'bravo', 'thanks', 'inspiring')),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id, kind)
);
alter table public.reactions enable row level security;

-- Compteurs agrégés : on affiche « 12 personnes ont trouvé ça inspirant », JAMAIS qui, ni de classement.
create table public.reaction_totals (
  post_id uuid not null references public.posts(id) on delete cascade,
  kind text not null,
  n int not null default 0 check (n >= 0),
  primary key (post_id, kind)
);
alter table public.reaction_totals enable row level security;

create table public.saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  resource_id uuid,   -- FK ajoutée avec la bibliothèque (0008)
  created_at timestamptz not null default now(),
  check ((post_id is not null)::int + (resource_id is not null)::int = 1)
);
create unique index saved_items_post_uq on public.saved_items (user_id, post_id) where post_id is not null;
create unique index saved_items_resource_uq on public.saved_items (user_id, resource_id) where resource_id is not null;
alter table public.saved_items enable row level security;

-- ---------------------------------------------------------------------------
-- Garde des publications / commentaires : limites, modération automatique, statuts
-- ---------------------------------------------------------------------------
create or replace function private.posts_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_flags jsonb; v_changed boolean;
begin
  if private.in_mod_ctx() then new.updated_at := now(); return new; end if;

  if tg_op = 'INSERT' then
    if (select count(*) from public.posts where author_id = new.author_id and created_at > now() - interval '1 day')
         >= private.cfg_int('posts.max_per_day', 20) then
      raise exception 'rate_limited' using errcode = '54000';
    end if;
    v_flags := private.text_flags(coalesce(new.title, '') || ' ' || new.body, new.author_id);
    if v_flags ->> 'decision' = 'block' then
      raise exception 'content_rejected: %', v_flags ->> 'categories' using errcode = 'P0001';
    end if;
    new.comment_count := 0;
    new.moderation := v_flags || jsonb_build_object('held_by', case when v_flags ->> 'decision' = 'hold' then 'text' end);
    new.status := case when new.status = 'draft' then 'draft'
                       when v_flags ->> 'decision' = 'hold' then 'pending_review' else 'published' end;
    new.edited_at := null;
    return new;
  end if;

  -- UPDATE par le client
  if old.status in ('hidden', 'removed') then raise exception 'content_moderated' using errcode = '42501'; end if;
  new.author_id := old.author_id; new.created_at := old.created_at; new.comment_count := old.comment_count;
  new.moderation := old.moderation;
  new.updated_at := now();
  v_changed := new.title is distinct from old.title or new.body is distinct from old.body;

  if v_changed or (old.status = 'draft' and new.status <> 'draft') then
    v_flags := private.text_flags(coalesce(new.title, '') || ' ' || new.body, new.author_id);
    if v_flags ->> 'decision' = 'block' then
      raise exception 'content_rejected: %', v_flags ->> 'categories' using errcode = 'P0001';
    end if;
    if old.status = 'pending_review' and old.moderation ->> 'held_by' = 'reports' then
      new.status := 'pending_review';                       -- retenu à cause de signalements : l'auteur ne peut pas le rouvrir
    elsif v_flags ->> 'decision' = 'hold' then
      new.status := 'pending_review';
      new.moderation := v_flags || jsonb_build_object('held_by', 'text');
    else
      new.status := case when new.status = 'draft' then 'draft' else 'published' end;
      new.moderation := v_flags;
    end if;
    if v_changed and old.status <> 'draft' then new.edited_at := now(); end if;
  else
    -- Aucun changement de texte : seules les bascules brouillon <-> publié sont permises à l'auteur.
    if not (new.status in ('draft', 'published') and old.status in ('draft', 'published')) then new.status := old.status; end if;
  end if;
  return new;
end $$;
create trigger posts_guard before insert or update on public.posts
  for each row execute function private.posts_guard();

create or replace function private.comments_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_flags jsonb; v_parent_id uuid; v_parent_post uuid; v_parent_parent uuid;
begin
  if private.in_mod_ctx() then new.updated_at := now(); return new; end if;
  if tg_op = 'INSERT' then
    if (select count(*) from public.comments where author_id = new.author_id and created_at > now() - interval '1 hour')
         >= private.cfg_int('comments.max_per_hour', 30) then
      raise exception 'rate_limited' using errcode = '54000';
    end if;
    if new.parent_id is not null then
      -- Colonnes explicites : la colonne `moderation` n'est pas lisible par les membres (droits par colonne).
      select id, post_id, parent_id into v_parent_id, v_parent_post, v_parent_parent from public.comments where id = new.parent_id;
      if v_parent_id is null or v_parent_post <> new.post_id or v_parent_parent is not null then
        raise exception 'invalid_parent' using errcode = '22023';
      end if;
    end if;
    v_flags := private.text_flags(new.body, new.author_id);
    if v_flags ->> 'decision' = 'block' then raise exception 'content_rejected: %', v_flags ->> 'categories' using errcode = 'P0001'; end if;
    new.moderation := v_flags || jsonb_build_object('held_by', case when v_flags ->> 'decision' = 'hold' then 'text' end);
    new.status := case when v_flags ->> 'decision' = 'hold' then 'pending_review' else 'published' end;
    return new;
  end if;
  if old.status in ('hidden', 'removed') then raise exception 'content_moderated' using errcode = '42501'; end if;
  new.author_id := old.author_id; new.post_id := old.post_id; new.parent_id := old.parent_id;
  new.created_at := old.created_at; new.moderation := old.moderation; new.updated_at := now();
  if new.body is distinct from old.body then
    v_flags := private.text_flags(new.body, new.author_id);
    if v_flags ->> 'decision' = 'block' then raise exception 'content_rejected: %', v_flags ->> 'categories' using errcode = 'P0001'; end if;
    if old.status = 'pending_review' and old.moderation ->> 'held_by' = 'reports' then new.status := 'pending_review';
    else
      new.status := case when v_flags ->> 'decision' = 'hold' then 'pending_review' else 'published' end;
      new.moderation := v_flags || jsonb_build_object('held_by', case when v_flags ->> 'decision' = 'hold' then 'text' end);
    end if;
    new.edited_at := now();
  else
    new.status := old.status;
  end if;
  return new;
end $$;
create trigger comments_guard before insert or update on public.comments
  for each row execute function private.comments_guard();

-- Compteurs (commentaires visibles, réactions)
create or replace function private.refresh_comment_count(p_post uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('tocktock.mod_ctx', 'on', true);
  update public.posts set comment_count = (select count(*) from public.comments c where c.post_id = p_post and c.status = 'published')
   where id = p_post;
  perform set_config('tocktock.mod_ctx', 'off', true);
end $$;
create or replace function private.comments_count_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_comment_count(coalesce(new.post_id, old.post_id));
  return null;
end $$;
create trigger comments_count after insert or update of status or delete on public.comments
  for each row execute function private.comments_count_trigger();

create or replace function private.reactions_totals_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.reaction_totals (post_id, kind, n) values (new.post_id, new.kind, 1)
      on conflict (post_id, kind) do update set n = public.reaction_totals.n + 1;
  else
    update public.reaction_totals set n = greatest(n - 1, 0) where post_id = old.post_id and kind = old.kind;
  end if;
  return null;
end $$;
create trigger reactions_totals after insert or delete on public.reactions
  for each row execute function private.reactions_totals_trigger();

-- Un objectif partagé sur le profil est public : son titre passe la modération.
create or replace function private.goals_share_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.share_on_profile and (tg_op = 'INSERT' or not old.share_on_profile or new.title is distinct from old.title) then
    if private.text_flags(new.title, new.user_id) ->> 'decision' <> 'allow' then
      raise exception 'shared_goal_rejected' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger goals_share_guard before insert or update on public.goals
  for each row execute function private.goals_share_guard();

-- ---------------------------------------------------------------------------
-- Vues de profil : masquage selon la visibilité choisie par la personne
-- ---------------------------------------------------------------------------
create view public.member_profiles with (security_barrier = true) as
select p.id, p.handle, p.display_name, p.avatar_preset, p.created_at,
       case when s.visibility ->> 'bio' = 'members' or p.id = auth.uid() then s.bio end as bio,
       case when s.visibility ->> 'interests' = 'members' or p.id = auth.uid() then s.interests end as interests
from public.profiles p
join public.profile_settings s on s.user_id = p.id
where p.onboarded_at is not null and p.deactivated_at is null
  and (p.id = auth.uid()
       or (private.can_read_community() and not private.hidden_between(auth.uid(), p.id)));

create view public.member_shared_goals with (security_barrier = true) as
select g.id, g.user_id, g.title, g.status, g.progress, g.due_date
from public.goals g
join public.profile_settings s on s.user_id = g.user_id
join public.profiles p on p.id = g.user_id
where g.share_on_profile and g.status <> 'archived'
  and p.onboarded_at is not null and p.deactivated_at is null
  and (g.user_id = auth.uid()
       or (s.visibility ->> 'shared_goals' = 'members'
           and private.can_read_community() and not private.hidden_between(auth.uid(), g.user_id)));

-- Recherche de membres : préfixe de pseudonyme (3 caractères minimum), 20 résultats maximum.
-- Pas de liste complète des membres, pas de parcours séquentiel des identifiants.
create or replace function public.search_members(p_query text) returns table (id uuid, handle text, display_name text, avatar_preset text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_read_community() then return; end if;
  if char_length(btrim(coalesce(p_query, ''))) < 3 then return; end if;
  return query
    select p.id, p.handle, p.display_name, p.avatar_preset
    from public.profiles p
    where p.onboarded_at is not null and p.deactivated_at is null
      and (lower(p.display_name) like lower(btrim(p_query)) || '%' or p.handle = lower(btrim(p_query)))
      and not private.hidden_between((select auth.uid()), p.id)
    order by p.display_name limit 20;
end $$;

-- ---------------------------------------------------------------------------
-- Signalements
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  target_type text not null check (target_type in ('post', 'comment', 'media', 'profile')),
  target_id uuid not null,
  target_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (reason in ('harassment', 'threat', 'sexual_content', 'violence', 'discrimination',
                                          'scam_spam', 'impersonation', 'private_data', 'dangerous_content', 'other')),
  details text check (details is null or char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'in_review', 'escalated', 'closed')),
  priority smallint not null default 3 check (priority between 1 and 3),
  decision text check (decision in ('no_action', 'content_hidden', 'content_removed', 'warned', 'limited', 'suspended', 'banned', 'duplicate', 'other')),
  decision_note text,
  assigned_to uuid references auth.users(id) on delete set null,
  target_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (reporter_id, target_type, target_id)
);
create index reports_queue_idx on public.reports (status, priority, created_at);
create index reports_target_idx on public.reports (target_type, target_id);
alter table public.reports enable row level security;
alter table public.moderation_actions add constraint moderation_actions_report_fk
  foreign key (report_id) references public.reports(id) on delete set null;
alter table public.sanctions add constraint sanctions_report_fk
  foreign key (report_id) references public.reports(id) on delete set null;

create or replace function private.reports_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_author uuid; v_snap jsonb; v_status text; v_n int;
begin
  if (select count(*) from public.reports where reporter_id = new.reporter_id and created_at > now() - interval '1 day')
       >= private.cfg_int('reports.max_per_day', 20) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  -- Seul du contenu DÉJÀ visible publiquement peut être signalé (le signalement ne sert pas à sonder des contenus privés).
  if new.target_type = 'post' then
    select author_id, status, jsonb_build_object('title', title, 'body', body, 'category_id', category_id)
      into v_author, v_status, v_snap from public.posts where id = new.target_id;
    if v_status is distinct from 'published' then raise exception 'unknown_target' using errcode = '22023'; end if;
  elsif new.target_type = 'comment' then
    select author_id, status, jsonb_build_object('body', body, 'post_id', post_id)
      into v_author, v_status, v_snap from public.comments where id = new.target_id;
    if v_status is distinct from 'published' then raise exception 'unknown_target' using errcode = '22023'; end if;
  elsif new.target_type = 'profile' then
    select id, 'published', jsonb_build_object('handle', handle, 'display_name', display_name)
      into v_author, v_status, v_snap from public.profiles where id = new.target_id and onboarded_at is not null;
  else
    -- 'media' : résolu par la migration 0007 (jointure sur media_assets)
    select owner_id, status, jsonb_build_object('kind', kind, 'name', display_name, 'media_status', status)
      into v_author, v_status, v_snap from public.media_assets where id = new.target_id and status = 'approved';
    if v_author is null then raise exception 'unknown_target' using errcode = '22023'; end if;
  end if;
  if v_author is null then raise exception 'unknown_target' using errcode = '22023'; end if;
  if v_author = new.reporter_id then raise exception 'cannot_report_self' using errcode = '22023'; end if;
  if private.hidden_between(new.reporter_id, v_author) then raise exception 'unknown_target' using errcode = '22023'; end if;

  new.target_user_id := v_author;
  new.target_snapshot := v_snap;
  new.status := 'open'; new.decision := null; new.decision_note := null; new.assigned_to := null; new.closed_at := null;
  new.priority := case when new.reason in ('threat', 'sexual_content', 'dangerous_content') then 1
                       when new.reason in ('harassment', 'violence', 'private_data', 'scam_spam', 'discrimination') then 2 else 3 end;
  return new;
end $$;
create trigger reports_guard before insert on public.reports for each row execute function private.reports_guard();

-- Mise en attente automatique quand plusieurs personnes DISTINCTES signalent le même contenu
-- (filet de sécurité réversible : un humain tranche ; ne supprime rien).
create or replace function private.reports_auto_hold() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  select count(distinct reporter_id) into v_n from public.reports
   where target_type = new.target_type and target_id = new.target_id and status <> 'closed';
  if v_n >= private.cfg_int('reports.auto_hold_threshold', 3) or new.priority = 1 and v_n >= 2 then
    perform set_config('tocktock.mod_ctx', 'on', true);
    if new.target_type = 'post' then
      update public.posts set status = 'pending_review', moderation = moderation || '{"held_by":"reports"}'
       where id = new.target_id and status = 'published';
    elsif new.target_type = 'comment' then
      update public.comments set status = 'pending_review', moderation = moderation || '{"held_by":"reports"}'
       where id = new.target_id and status = 'published';
    end if;
    perform set_config('tocktock.mod_ctx', 'off', true);
  end if;
  return null;
end $$;
create trigger reports_auto_hold after insert on public.reports for each row execute function private.reports_auto_hold();

-- File de modération : lecture réservée au personnel habilité (vue définie par le propriétaire, filtrée par permission).
create view public.staff_reports with (security_barrier = true) as
select r.id, r.created_at, r.updated_at, r.status, r.priority, r.reason, r.details, r.target_type, r.target_id,
       r.target_user_id, tp.handle as target_user_handle, r.target_snapshot, r.decision, r.decision_note,
       r.assigned_to, r.closed_at, rp.handle as reporter_handle,
       (select count(*) from public.reports o where o.target_type = r.target_type and o.target_id = r.target_id) as reports_on_target
from public.reports r
left join public.profiles tp on tp.id = r.target_user_id
left join public.profiles rp on rp.id = r.reporter_id
where private.has_permission('reports.view');

-- ---------------------------------------------------------------------------
-- RPC de modération humaine (toutes tracées dans moderation_actions)
-- ---------------------------------------------------------------------------
create or replace function public.moderate_content(
  p_target_type text, p_target_id uuid, p_action text, p_reason text, p_explanation text, p_report_id uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid()); v_author uuid; v_new text; v_perm text;
begin
  if p_target_type not in ('post', 'comment') then raise exception 'invalid_target_type' using errcode = '22023'; end if;
  v_perm := case p_action when 'hide' then 'content.hide' when 'restore' then 'content.restore' when 'remove' then 'sanction.suspend' end;
  v_new := case p_action when 'hide' then 'hidden' when 'restore' then 'published' when 'remove' then 'removed' end;
  if v_perm is null then raise exception 'invalid_action' using errcode = '22023'; end if;
  if not private.has_permission(v_perm) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_action <> 'restore' and (p_explanation is null or char_length(btrim(p_explanation)) < 10) then
    raise exception 'explanation_required' using errcode = '22023';
  end if;

  perform set_config('tocktock.mod_ctx', 'on', true);
  if p_target_type = 'post' then
    update public.posts set status = v_new where id = p_target_id returning author_id into v_author;
  else
    update public.comments set status = v_new where id = p_target_id returning author_id into v_author;
  end if;
  perform set_config('tocktock.mod_ctx', 'off', true);
  if v_author is null then raise exception 'unknown_target' using errcode = '22023'; end if;

  insert into public.moderation_actions (moderator_id, moderator_handle, action, target_user_id, target_user_handle,
                                         target_type, target_id, report_id, reason, explanation)
    values (v_actor, (select handle from public.profiles where id = v_actor), 'content_' || p_action, v_author,
            (select handle from public.profiles where id = v_author), p_target_type, p_target_id, p_report_id, p_reason, p_explanation);

  -- Clôture du signalement d'origine et des doublons sur la même cible.
  update public.reports
     set status = 'closed', closed_at = now(), updated_at = now(), assigned_to = coalesce(assigned_to, v_actor),
         decision = case when id = p_report_id then (case p_action when 'remove' then 'content_removed' when 'hide' then 'content_hidden' else 'no_action' end) else 'duplicate' end,
         decision_note = case when id = p_report_id then p_reason else 'Traité avec le signalement d''origine' end
   where target_type = p_target_type and target_id = p_target_id and status <> 'closed';
end $$;

create or replace function public.act_on_report(p_report uuid, p_status text, p_decision text default null, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if not private.has_permission('reports.act') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('in_review', 'escalated', 'closed') then raise exception 'invalid_status' using errcode = '22023'; end if;
  if p_status = 'closed' and p_decision is null then raise exception 'decision_required' using errcode = '22023'; end if;
  if p_status = 'escalated' and (p_note is null or char_length(btrim(p_note)) < 5) then raise exception 'note_required' using errcode = '22023'; end if;
  update public.reports
     set status = p_status, decision = coalesce(p_decision, decision), decision_note = coalesce(p_note, decision_note),
         assigned_to = coalesce(assigned_to, v_actor), updated_at = now(),
         closed_at = case when p_status = 'closed' then now() else null end
   where id = p_report;
  if not found then raise exception 'unknown_report' using errcode = '22023'; end if;
  insert into public.moderation_actions (moderator_id, moderator_handle, action, report_id, reason, explanation)
    values (v_actor, (select handle from public.profiles where id = v_actor), 'report_' || p_status, p_report, p_decision, p_note);
end $$;

-- ---------------------------------------------------------------------------
-- Appels
-- ---------------------------------------------------------------------------
create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_handle text not null,
  sanction_id uuid references public.sanctions(id),
  target_type text check (target_type in ('post', 'comment')),
  target_id uuid,
  message text not null check (char_length(btrim(message)) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  decision_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check ((sanction_id is not null) or (target_type is not null and target_id is not null))
);
create unique index appeals_open_sanction_uq on public.appeals (sanction_id) where status = 'open' and sanction_id is not null;
create unique index appeals_open_target_uq on public.appeals (user_id, target_type, target_id) where status = 'open' and target_id is not null;
alter table public.appeals enable row level security;

create or replace function private.appeals_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.user_handle := (select handle from public.profiles where id = new.user_id);
  new.status := 'open'; new.decision_note := null; new.reviewed_by := null; new.decided_at := null;
  if (select count(*) from public.appeals where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if new.sanction_id is not null then
    if not exists (select 1 from public.sanctions s where s.id = new.sanction_id and s.user_id = new.user_id) then
      raise exception 'not_your_sanction' using errcode = '42501';
    end if;
  elsif new.target_type = 'post' then
    if not exists (select 1 from public.posts p where p.id = new.target_id and p.author_id = new.user_id and p.status in ('hidden', 'removed', 'pending_review')) then
      raise exception 'not_your_content' using errcode = '42501';
    end if;
  else
    if not exists (select 1 from public.comments c where c.id = new.target_id and c.author_id = new.user_id and c.status in ('hidden', 'removed', 'pending_review')) then
      raise exception 'not_your_content' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger appeals_guard before insert on public.appeals for each row execute function private.appeals_guard();

-- Décision d'appel : par une AUTRE personne que celle qui a pris la décision contestée.
create or replace function public.decide_appeal(p_id uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); a public.appeals; s public.sanctions; v_orig uuid;
begin
  if not private.has_permission('appeals.review') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_outcome not in ('upheld', 'overturned') then raise exception 'invalid_outcome' using errcode = '22023'; end if;
  if p_note is null or char_length(btrim(p_note)) < 10 then raise exception 'explanation_required' using errcode = '22023'; end if;
  select * into a from public.appeals where id = p_id and status = 'open';
  if a.id is null then raise exception 'unknown_appeal' using errcode = '22023'; end if;

  if a.sanction_id is not null then
    select * into s from public.sanctions where id = a.sanction_id;
    v_orig := s.created_by;
  else
    select moderator_id into v_orig from public.moderation_actions
     where target_type = a.target_type and target_id = a.target_id and action in ('content_hide', 'content_remove')
     order by created_at desc limit 1;
  end if;
  if v_orig is not null and v_orig = v_actor then raise exception 'conflict_of_interest' using errcode = '42501'; end if;

  update public.appeals set status = p_outcome, decision_note = p_note, reviewed_by = v_actor, decided_at = now() where id = p_id;
  if p_outcome = 'overturned' then
    if a.sanction_id is not null then
      update public.sanctions set revoked_at = now(), revoked_by = v_actor where id = a.sanction_id and revoked_at is null;
    else
      perform set_config('tocktock.mod_ctx', 'on', true);
      if a.target_type = 'post' then update public.posts set status = 'published' where id = a.target_id;
      else update public.comments set status = 'published' where id = a.target_id; end if;
      perform set_config('tocktock.mod_ctx', 'off', true);
    end if;
  end if;
  insert into public.moderation_actions (moderator_id, moderator_handle, action, target_user_id, target_user_handle,
                                         target_type, target_id, reason, explanation, details)
    values (v_actor, (select handle from public.profiles where id = v_actor), 'appeal_' || p_outcome, a.user_id, a.user_handle,
            a.target_type, a.target_id, p_outcome, p_note, jsonb_build_object('appeal_id', p_id, 'sanction_id', a.sanction_id));
end $$;

-- ---------------------------------------------------------------------------
-- Politiques RLS
-- ---------------------------------------------------------------------------
create policy post_categories_select on public.post_categories for select to authenticated using (true);
create policy post_categories_manage on public.post_categories for all to authenticated
  using ((select private.has_permission('categories.manage'))) with check ((select private.has_permission('categories.manage')));

create policy posts_select on public.posts for select to authenticated using (
  author_id = (select auth.uid())
  or (status = 'published'
      and (select private.can_read_community())
      and exists (select 1 from public.profiles pr where pr.id = posts.author_id and pr.deactivated_at is null and pr.onboarded_at is not null)
      and not private.hidden_between((select auth.uid()), author_id))
  or (status in ('pending_review', 'hidden', 'removed') and (select private.has_permission('content.hide')))
);
create policy posts_insert on public.posts for insert to authenticated
  with check (author_id = (select auth.uid()) and (select private.can_participate()));
create policy posts_update_own on public.posts for update to authenticated
  using (author_id = (select auth.uid()) and status in ('draft', 'published', 'pending_review'))
  with check (author_id = (select auth.uid()) and (select private.can_participate()));
create policy posts_delete_own on public.posts for delete to authenticated using (author_id = (select auth.uid()));

create policy comments_select on public.comments for select to authenticated using (
  author_id = (select auth.uid())
  or (status = 'published'
      and not private.hidden_between((select auth.uid()), author_id)
      and exists (select 1 from public.posts p where p.id = comments.post_id))     -- hérite de la visibilité du billet
  or (status in ('pending_review', 'hidden', 'removed') and (select private.has_permission('content.hide')))
);
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and (select private.can_participate())
              and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published'
                          and not private.hidden_between((select auth.uid()), p.author_id)));
create policy comments_update_own on public.comments for update to authenticated
  using (author_id = (select auth.uid()) and status in ('published', 'pending_review'))
  with check (author_id = (select auth.uid()) and (select private.can_participate()));
create policy comments_delete_own on public.comments for delete to authenticated using (author_id = (select auth.uid()));

create policy reactions_select_own on public.reactions for select to authenticated using (user_id = (select auth.uid()));
create policy reactions_insert on public.reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.can_participate())
              and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published'
                          and not private.hidden_between((select auth.uid()), p.author_id)));
create policy reactions_delete_own on public.reactions for delete to authenticated using (user_id = (select auth.uid()));
create policy reaction_totals_select on public.reaction_totals for select to authenticated
  using (exists (select 1 from public.posts p where p.id = reaction_totals.post_id));

create policy saved_items_own on public.saved_items for select to authenticated using (user_id = (select auth.uid()));
create policy saved_items_insert on public.saved_items for insert to authenticated
  with check (user_id = (select auth.uid()) and (post_id is null or exists (select 1 from public.posts p where p.id = post_id)));
create policy saved_items_delete on public.saved_items for delete to authenticated using (user_id = (select auth.uid()));

create policy reports_insert on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and (select private.can_read_community()));
create policy reports_select_own on public.reports for select to authenticated using (reporter_id = (select auth.uid()));
-- Pas de UPDATE/DELETE direct : uniquement via act_on_report / moderate_content.

create policy appeals_insert on public.appeals for insert to authenticated with check (user_id = (select auth.uid()));
create policy appeals_select on public.appeals for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_permission('appeals.review')));

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
revoke all on public.post_categories, public.posts, public.comments, public.reactions, public.reaction_totals,
  public.saved_items, public.reports, public.appeals, public.member_profiles, public.member_shared_goals,
  public.staff_reports from anon, authenticated;
grant select on public.post_categories, public.reaction_totals, public.member_profiles, public.member_shared_goals,
  public.staff_reports to authenticated;
grant insert, update, delete on public.post_categories to authenticated;
grant select, insert, delete on public.reactions, public.saved_items to authenticated;
grant insert, delete on public.posts, public.comments to authenticated;
-- La colonne `moderation` (résultat du filtrage automatique, y compris « needs_support ») n'est lisible par PERSONNE côté
-- membre : sinon n'importe qui pourrait voir qu'une publication a été repérée comme exprimant une détresse, ou connaître les
-- catégories de filtrage. Le personnel passe par staff_reports / les RPC de modération.
grant select (id, author_id, category_id, kind, title, body, status, rights_attested, comment_count, created_at, updated_at,
              edited_at, search) on public.posts to authenticated;
grant select (id, post_id, author_id, parent_id, body, status, created_at, updated_at, edited_at) on public.comments to authenticated;
grant update (category_id, kind, title, body, status, rights_attested) on public.posts to authenticated;
grant update (body) on public.comments to authenticated;
-- Le signalant ne lit pas l'instantané du contenu : seulement l'état de son signalement.
grant select (id, reporter_id, target_type, target_id, reason, details, status, decision, created_at, closed_at) on public.reports to authenticated;
grant insert (target_type, target_id, reason, details, reporter_id) on public.reports to authenticated;
grant select, insert on public.appeals to authenticated;
grant all on public.post_categories, public.posts, public.comments, public.reactions, public.reaction_totals,
  public.saved_items, public.reports, public.appeals, public.member_profiles, public.member_shared_goals,
  public.staff_reports to service_role;

revoke execute on function public.moderate_content(text, uuid, text, text, text, uuid), public.act_on_report(uuid, text, text, text),
  public.decide_appeal(uuid, text, text), public.search_members(text) from public, anon;
grant execute on function public.moderate_content(text, uuid, text, text, text, uuid), public.act_on_report(uuid, text, text, text),
  public.decide_appeal(uuid, text, text), public.search_members(text) to authenticated, service_role;
