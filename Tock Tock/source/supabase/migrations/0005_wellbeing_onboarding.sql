-- ============================================================================
-- Tock Tock — 0005 : bilans, indicateurs personnalisables, objectifs, chroniques, onboarding
-- Phase B. TOUTES ces données sont strictement privées : seule la personne concernée y accède.
-- Aucun rôle du personnel n'a de politique sur ces tables (voir les tests d'isolation).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Modèles d'indicateurs (configuration initiale : 5 catégories, 20 indicateurs)
-- ---------------------------------------------------------------------------
create table public.indicator_category_templates (
  key text primary key, label text not null, sort_order int not null
);
create table public.indicator_templates (
  key text primary key,
  category_key text not null references public.indicator_category_templates(key),
  name text not null, description text, sort_order int not null
);
alter table public.indicator_category_templates enable row level security;
alter table public.indicator_templates enable row level security;

insert into public.indicator_category_templates (key, label, sort_order) values
  ('emotional', 'État émotionnel', 1),
  ('health', 'Santé ressentie et énergie', 2),
  ('social', 'Vie sociale et personnelle', 3),
  ('work', 'Études, travail et projets', 4),
  ('daily', 'Vie quotidienne et épanouissement', 5);

insert into public.indicator_templates (key, category_key, name, description, sort_order) values
  ('mood',         'emotional', 'Moral général', 'Comment as-tu vécu ta journée sur le plan du moral ?', 1),
  ('joy',          'emotional', 'Joie et plaisir', 'As-tu ressenti de la joie ou du plaisir aujourd''hui ?', 2),
  ('serenity',     'emotional', 'Sérénité', 'T''es-tu senti·e plutôt calme et apaisé·e ?', 3),
  ('confidence',   'emotional', 'Confiance en soi', 'Comment te sentais-tu dans tes capacités ?', 4),
  ('energy',       'health',    'Énergie physique', 'Quel niveau d''énergie avais-tu ?', 5),
  ('sleep',        'health',    'Qualité du sommeil', 'Comment as-tu dormi la nuit dernière ?', 6),
  ('recovery',     'health',    'Capacité à récupérer', 'As-tu pu te reposer et récupérer quand il le fallait ?', 7),
  ('comfort',      'health',    'Confort physique (hors douleur)', 'Comment te sentais-tu physiquement, en dehors de toute douleur ?', 8),
  ('surrounded',   'social',    'Sentiment d''être entouré·e', 'T''es-tu senti·e entouré·e ?', 9),
  ('exchanges',    'social',    'Qualité des échanges', 'Comment se sont passés tes échanges avec les autres ?', 10),
  ('understood',   'social',    'Sentiment d''être compris·e', 'T''es-tu senti·e compris·e ?', 11),
  ('balance',      'social',    'Équilibre entre les autres et le temps pour soi', 'As-tu trouvé un bon équilibre entre les autres et toi ?', 12),
  ('study_work',   'work',      'Avancement des études ou du travail', 'As-tu avancé dans tes études ou ton travail ?', 13),
  ('projects',     'work',      'Avancement des projets personnels', 'As-tu avancé sur tes projets personnels ?', 14),
  ('productivity', 'work',      'Productivité adaptée à mon énergie', 'As-tu fait ce qui était réaliste avec l''énergie que tu avais ?', 15),
  ('motivation',   'work',      'Motivation pour les projets', 'Comment était ta motivation ?', 16),
  ('progress',     'daily',     'Sentiment d''avoir avancé', 'As-tu eu le sentiment d''avancer ?', 17),
  ('pride',        'daily',     'Fierté personnelle', 'Y a-t-il quelque chose dont tu es fier·e ?', 18),
  ('pleasant',     'daily',     'Moments agréables', 'As-tu vécu des moments agréables ?', 19),
  ('satisfaction', 'daily',     'Satisfaction générale', 'Dans l''ensemble, comment évalues-tu ta journée ?', 20);

-- ---------------------------------------------------------------------------
-- Catégories et indicateurs PERSONNELS (copie modifiable des modèles)
-- ---------------------------------------------------------------------------
create table public.indicator_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  sort_order int not null default 0,
  template_key text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index indicator_categories_user_name on public.indicator_categories (user_id, lower(name)) where deleted_at is null;
create index indicator_categories_user_idx on public.indicator_categories (user_id);

create table public.indicators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.indicator_categories(id),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text check (description is null or char_length(description) <= 300),
  response_type text not null default 'scale' check (response_type in ('scale', 'text', 'choice', 'boolean')),
  scale_min int, scale_max int,
  choices jsonb,
  sort_order int not null default 0,
  is_active boolean not null default true,
  -- « Obligatoire » = rappel choisi par la personne pour elle-même : l'application ne bloque JAMAIS l'enregistrement.
  is_required boolean not null default false,
  include_in_average boolean not null default true,
  template_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index indicators_user_idx on public.indicators (user_id, sort_order) where deleted_at is null;
alter table public.indicator_categories enable row level security;
alter table public.indicators enable row level security;

create or replace function private.validate_indicator() returns trigger
language plpgsql set search_path = '' as $$
declare c jsonb; n int;
begin
  if not exists (select 1 from public.indicator_categories where id = new.category_id and user_id = new.user_id) then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    select count(*) into n from public.indicators where user_id = new.user_id and deleted_at is null;
    if n >= 80 then raise exception 'too_many_indicators' using errcode = '54000'; end if;
  end if;

  if new.response_type = 'scale' then
    new.scale_min := coalesce(new.scale_min, 0);
    new.scale_max := coalesce(new.scale_max, 10);
    if new.scale_min >= new.scale_max or new.scale_max - new.scale_min > 100 then
      raise exception 'invalid_scale' using errcode = '22023';
    end if;
    new.choices := null;
  elsif new.response_type = 'choice' then
    if jsonb_typeof(new.choices) <> 'array' or jsonb_array_length(new.choices) not between 2 and 12 then
      raise exception 'invalid_choices' using errcode = '22023';
    end if;
    for c in select * from jsonb_array_elements(new.choices) loop
      if jsonb_typeof(c) <> 'object' or jsonb_typeof(c -> 'label') <> 'string'
         or char_length(c ->> 'label') not between 1 and 40
         or (c ? 'score' and jsonb_typeof(c -> 'score') not in ('number', 'null'))
         or (c ? 'score' and jsonb_typeof(c -> 'score') = 'number' and ((c ->> 'score')::numeric < 0 or (c ->> 'score')::numeric > 10)) then
        raise exception 'invalid_choices' using errcode = '22023';
      end if;
    end loop;
    -- Un choix n'entre dans la moyenne que si CHAQUE option porte un score (0 à 10).
    if new.include_in_average and exists (
         select 1 from jsonb_array_elements(new.choices) e where jsonb_typeof(e -> 'score') is distinct from 'number') then
      new.include_in_average := false;
    end if;
    new.scale_min := null; new.scale_max := null;
  else
    new.include_in_average := false;
    new.scale_min := null; new.scale_max := null; new.choices := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger indicators_validate before insert or update on public.indicators
  for each row execute function private.validate_indicator();

-- Copie des modèles pour une personne (appelée à l'onboarding ou pour restaurer les indicateurs par défaut).
-- N'écrase rien : ne crée que les indicateurs de modèle absents.
create or replace function private.seed_default_indicators(p_uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.indicator_categories (user_id, name, sort_order, template_key)
  select p_uid, t.label, t.sort_order, t.key
  from public.indicator_category_templates t
  where not exists (select 1 from public.indicator_categories c where c.user_id = p_uid and c.template_key = t.key);

  insert into public.indicators (user_id, category_id, name, description, response_type, scale_min, scale_max,
                                 sort_order, include_in_average, template_key)
  select p_uid, c.id, t.name, t.description, 'scale', 0, 10, t.sort_order, true, t.key
  from public.indicator_templates t
  join public.indicator_categories c on c.user_id = p_uid and c.template_key = t.category_key
  where not exists (select 1 from public.indicators i where i.user_id = p_uid and i.template_key = t.key);
end $$;

create or replace function public.restore_default_indicators() returns void
language sql security definer set search_path = '' as $$
  select private.seed_default_indicators((select auth.uid()))
$$;

-- ---------------------------------------------------------------------------
-- Bilans quotidiens
-- ---------------------------------------------------------------------------
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null,
  events_note text check (events_note is null or char_length(events_note) <= 2000),
  day_note text check (day_note is null or char_length(day_note) <= 2000),
  -- Douleur : SENSIBLE, distincte de toute moyenne, privée.
  pain_score smallint check (pain_score between 0 and 10),
  pain_zone text check (pain_zone is null or char_length(pain_zone) <= 60),
  pain_note text check (pain_note is null or char_length(pain_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);
alter table public.checkins enable row level security;
create trigger checkins_touch before update on public.checkins for each row execute function private.touch_updated_at();

create or replace function private.validate_checkin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.checkin_date > current_date + 1 or new.checkin_date < date '2000-01-01' then
    raise exception 'invalid_checkin_date' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.checkin_date <> old.checkin_date) then
    raise exception 'immutable_checkin_keys' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger checkins_validate before insert or update on public.checkins
  for each row execute function private.validate_checkin();

create table public.checkin_answers (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.checkins(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  indicator_id uuid references public.indicators(id) on delete set null,
  -- Instantané de la définition de l'indicateur AU MOMENT du bilan (rempli par le serveur, jamais par le client).
  snapshot jsonb not null default '{}',
  value_num numeric,
  value_text text,
  value_choice text,
  answered_at timestamptz not null default now(),
  -- Une réponse vide n'existe pas : on supprime la ligne. Une réponse vide n'est JAMAIS un zéro.
  constraint answer_exactly_one_value check (
    (value_num is not null)::int + (value_text is not null)::int + (value_choice is not null)::int = 1),
  unique (checkin_id, indicator_id)
);
create index checkin_answers_user_idx on public.checkin_answers (user_id, checkin_id);
alter table public.checkin_answers enable row level security;

create or replace function private.validate_answer_value(p_snapshot jsonb, p_num numeric, p_text text, p_choice text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  case p_snapshot ->> 'response_type'
    when 'scale' then
      if p_num is null or p_num <> trunc(p_num)
         or p_num < (p_snapshot ->> 'scale_min')::numeric or p_num > (p_snapshot ->> 'scale_max')::numeric then
        raise exception 'answer_out_of_range' using errcode = '22023';
      end if;
    when 'boolean' then
      if p_num is null or p_num not in (0, 1) then raise exception 'invalid_answer' using errcode = '22023'; end if;
    when 'text' then
      if p_text is null or btrim(p_text) = '' or char_length(p_text) > 1000 then
        raise exception 'invalid_answer' using errcode = '22023';
      end if;
    when 'choice' then
      if p_choice is null or not exists (select 1 from jsonb_array_elements(p_snapshot -> 'choices') e where e ->> 'label' = p_choice) then
        raise exception 'invalid_answer' using errcode = '22023';
      end if;
    else raise exception 'invalid_answer' using errcode = '22023';
  end case;
end $$;

create or replace function private.checkin_answer_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ind public.indicators; cat_name text;
begin
  if tg_op = 'INSERT' then
    select * into ind from public.indicators where id = new.indicator_id and user_id = new.user_id and deleted_at is null;
    if ind.id is null then raise exception 'unknown_indicator' using errcode = '22023'; end if;
    if not ind.is_active then raise exception 'inactive_indicator' using errcode = '22023'; end if;
    if not exists (select 1 from public.checkins c where c.id = new.checkin_id and c.user_id = new.user_id) then
      raise exception 'unknown_checkin' using errcode = '22023';
    end if;
    select name into cat_name from public.indicator_categories where id = ind.category_id;
    new.snapshot := jsonb_build_object(
      'indicator_id', ind.id, 'name', ind.name, 'description', ind.description,
      'category_id', ind.category_id, 'category_name', cat_name,
      'response_type', ind.response_type, 'scale_min', ind.scale_min, 'scale_max', ind.scale_max,
      'choices', ind.choices, 'include_in_average', ind.include_in_average, 'template_key', ind.template_key);
  else
    -- (la clé étrangère ON DELETE SET NULL peut mettre indicator_id à NULL ; jamais le changer vers autre chose)
    if new.checkin_id <> old.checkin_id or new.user_id <> old.user_id
       or (new.indicator_id is distinct from old.indicator_id and new.indicator_id is not null) then
      raise exception 'immutable_answer_keys' using errcode = '42501';
    end if;
    new.snapshot := old.snapshot;   -- l'instantané ne change jamais
  end if;
  perform private.validate_answer_value(new.snapshot, new.value_num, new.value_text, new.value_choice);
  return new;
end $$;
create trigger checkin_answers_guard before insert or update on public.checkin_answers
  for each row execute function private.checkin_answer_guard();

-- ---------------------------------------------------------------------------
-- Objectifs
-- ---------------------------------------------------------------------------
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  category text check (category is null or char_length(category) <= 40),
  due_date date,
  priority smallint check (priority between 1 and 3),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'paused', 'done', 'archived')),
  progress smallint check (progress between 0 and 100),
  notes text check (notes is null or char_length(notes) <= 2000),
  -- Partage explicite et révocable sur le profil (titre seulement ; jamais les notes).
  share_on_profile boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index goals_user_idx on public.goals (user_id, status);
alter table public.goals enable row level security;

create table public.goal_steps (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  done boolean not null default false,
  done_at timestamptz,
  sort_order int not null default 0,
  due_date date,
  created_at timestamptz not null default now()
);
alter table public.goal_steps enable row level security;

create table public.goal_events (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index goal_events_goal_idx on public.goal_events (goal_id, created_at);
alter table public.goal_events enable row level security;

-- Le journal d'un objectif est alimenté par un trigger AFTER (clé étrangère vers le but).
create or replace function private.goals_guard_before() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.goals where user_id = new.user_id and status <> 'archived') >= 200 then
      raise exception 'too_many_goals' using errcode = '54000';
    end if;
    if new.status = 'done' then new.completed_at := now(); end if;
    return new;
  end if;
  if new.user_id <> old.user_id then raise exception 'immutable_owner' using errcode = '42501'; end if;
  new.updated_at := now();
  if new.status = 'done' and old.status <> 'done' then new.completed_at := now();
  elsif new.status <> 'done' then new.completed_at := null; end if;
  return new;
end $$;
create trigger goals_guard before insert or update on public.goals
  for each row execute function private.goals_guard_before();

create or replace function private.goals_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.goal_events (goal_id, user_id, event) values (new.id, new.user_id, 'created');
  else
    if new.status is distinct from old.status then
      insert into public.goal_events (goal_id, user_id, event, details)
        values (new.id, new.user_id, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.title is distinct from old.title or new.description is distinct from old.description
       or new.due_date is distinct from old.due_date or new.progress is distinct from old.progress
       or new.priority is distinct from old.priority then
      insert into public.goal_events (goal_id, user_id, event, details)
        values (new.id, new.user_id, 'edited', jsonb_build_object('progress', new.progress, 'due_date', new.due_date));
    end if;
  end if;
  return null;
end $$;
create trigger goals_log after insert or update on public.goals for each row execute function private.goals_log();

create or replace function private.goal_steps_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.goals g where g.id = new.goal_id and g.user_id = new.user_id) then
    raise exception 'unknown_goal' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.goal_steps where goal_id = new.goal_id) >= 50 then
    raise exception 'too_many_steps' using errcode = '54000';
  end if;
  if new.done and (tg_op = 'INSERT' or not old.done) then new.done_at := now();
  elsif not new.done then new.done_at := null; end if;
  return new;
end $$;
create trigger goal_steps_guard before insert or update on public.goal_steps
  for each row execute function private.goal_steps_guard();

-- ---------------------------------------------------------------------------
-- Chroniques de minuit et historique d'envoi
-- ---------------------------------------------------------------------------
create table public.chronicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chronicle_date date not null,
  title text not null check (char_length(title) between 1 and 160),
  sections jsonb not null,
  source text not null default 'template' check (source in ('template', 'ai')),
  status text not null default 'ready' check (status in ('ready', 'edited')),
  -- Quelles données ont servi à la rédiger (transparence + respect du choix de la personne).
  data_used jsonb not null default '{}',
  stats jsonb,
  ai_provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, chronicle_date),
  constraint chronicle_sections_shape check (jsonb_typeof(sections) = 'object' and pg_column_size(sections) < 60000)
);
alter table public.chronicles enable row level security;
create trigger chronicles_touch before update on public.chronicles for each row execute function private.touch_updated_at();

create table public.chronicle_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chronicle_date date not null,
  channel text not null check (channel in ('email', 'reminder_email')),
  status text not null default 'processing' check (status in ('processing', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  provider_message_id text,
  locked_until timestamptz,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- IDEMPOTENCE : au plus une livraison par personne, jour et canal, quoi qu'il arrive (relance du cron, double clic…).
  unique (user_id, chronicle_date, channel)
);
alter table public.chronicle_deliveries enable row level security;

-- Réservation atomique d'un envoi : renvoie true UNE SEULE FOIS par (personne, jour, canal),
-- sauf reprise légitime (échec précédent éligible à une nouvelle tentative, ou réservation périmée).
create or replace function public.claim_chronicle_delivery(p_user uuid, p_date date, p_channel text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.chronicle_deliveries as d (user_id, chronicle_date, channel, status, attempts, locked_until)
  values (p_user, p_date, p_channel, 'processing', 1, now() + interval '10 minutes')
  on conflict (user_id, chronicle_date, channel) do update
    set status = 'processing', attempts = d.attempts + 1, locked_until = now() + interval '10 minutes', updated_at = now()
    where (d.status = 'failed' and d.attempts < 3 and coalesce(d.next_attempt_at, now()) <= now())
       or (d.status = 'processing' and d.locked_until < now())
  returning 1 into n;
  return n is not null;
end $$;

create or replace function public.finish_chronicle_delivery(
  p_user uuid, p_date date, p_channel text, p_status text, p_error text default null, p_message_id text default null
) returns void
language sql security definer set search_path = '' as $$
  update public.chronicle_deliveries
     set status = p_status, last_error = left(p_error, 500), provider_message_id = p_message_id,
         locked_until = null, updated_at = now(),
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         next_attempt_at = case when p_status = 'failed' then now() + (attempts * interval '15 minutes') else null end
   where user_id = p_user and chronicle_date = p_date and channel = p_channel
$$;

-- ---------------------------------------------------------------------------
-- Onboarding : règles acceptées -> pseudonyme -> déclaration d'âge -> identifiant découvert
-- ---------------------------------------------------------------------------
create or replace function public.complete_onboarding(p_display_name text, p_age_band text, p_timezone text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_name text; v_handle text; v_done timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not private.rules_ok(v_uid) then raise exception 'rules_not_accepted' using errcode = '42501'; end if;
  if p_age_band not in ('under_15', '15_17', '18_plus') then raise exception 'invalid_age_band' using errcode = '22023'; end if;
  select onboarded_at into v_done from public.profiles where id = v_uid;
  if v_done is not null then raise exception 'already_onboarded' using errcode = 'P0001'; end if;

  v_name := private.validate_display_name(p_display_name, v_uid);
  update public.profile_settings
     set age_band = p_age_band,
         timezone = case when p_timezone is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone)
                         then p_timezone else timezone end
   where user_id = v_uid;
  update public.profiles set display_name = v_name, display_name_changed_at = now(), onboarded_at = now()
   where id = v_uid returning handle into v_handle;
  perform private.seed_default_indicators(v_uid);
  return jsonb_build_object('handle', v_handle, 'display_name', v_name);
end $$;

create or replace function public.set_display_name(p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_name text; v_last timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select display_name_changed_at into v_last from public.profiles where id = v_uid and onboarded_at is not null;
  if not found then raise exception 'onboarding_required' using errcode = '42501'; end if;
  if v_last > now() - interval '24 hours' then raise exception 'display_name_rate_limited' using errcode = 'P0001'; end if;
  v_name := private.validate_display_name(p_name, v_uid);
  update public.profiles set display_name = v_name, display_name_changed_at = now() where id = v_uid;
  return v_name;
end $$;

create or replace function public.set_avatar_preset(p_preset text) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set avatar_preset = p_preset where id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- Politiques RLS : propriétaire uniquement
-- ---------------------------------------------------------------------------
create policy templates_select on public.indicator_templates for select to authenticated using (true);
create policy category_templates_select on public.indicator_category_templates for select to authenticated using (true);

create policy indicator_categories_own on public.indicator_categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy indicators_own on public.indicators for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy checkins_own on public.checkins for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy checkin_answers_own on public.checkin_answers for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy goals_own on public.goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy goal_steps_own on public.goal_steps for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy goal_events_select_own on public.goal_events for select to authenticated using (user_id = (select auth.uid()));
create policy chronicles_own on public.chronicles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy chronicle_deliveries_select_own on public.chronicle_deliveries for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.indicator_category_templates, public.indicator_templates, public.indicator_categories,
  public.indicators, public.checkins, public.checkin_answers, public.goals, public.goal_steps, public.goal_events,
  public.chronicles, public.chronicle_deliveries from anon, authenticated;
grant select on public.indicator_category_templates, public.indicator_templates, public.goal_events,
  public.chronicle_deliveries to authenticated;
grant select, insert, update, delete on public.indicator_categories, public.indicators, public.checkins,
  public.checkin_answers, public.goals, public.goal_steps, public.chronicles to authenticated;
-- snapshot / user_id / checkin_id ne sont pas modifiables directement sur les réponses
revoke update on public.checkin_answers from authenticated;
grant update (value_num, value_text, value_choice) on public.checkin_answers to authenticated;
grant all on public.indicator_category_templates, public.indicator_templates, public.indicator_categories,
  public.indicators, public.checkins, public.checkin_answers, public.goals, public.goal_steps, public.goal_events,
  public.chronicles, public.chronicle_deliveries to service_role;

revoke execute on function public.restore_default_indicators(), public.complete_onboarding(text, text, text),
  public.set_display_name(text), public.set_avatar_preset(text) from public, anon;
grant execute on function public.restore_default_indicators(), public.complete_onboarding(text, text, text),
  public.set_display_name(text), public.set_avatar_preset(text) to authenticated, service_role;
-- Réservé au serveur (clé service) : jamais appelable depuis un navigateur.
revoke execute on function public.claim_chronicle_delivery(uuid, date, text),
  public.finish_chronicle_delivery(uuid, date, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_chronicle_delivery(uuid, date, text),
  public.finish_chronicle_delivery(uuid, date, text, text, text, text) to service_role;
