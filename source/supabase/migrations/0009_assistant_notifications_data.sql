-- ============================================================================
-- Tock Tock — 0009 : assistant (conversations), notifications, quotas d'usage, export des données
-- Phase E.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Conversations avec l'assistant : privées. Écrites par le SERVEUR (Edge Function `assistant`) uniquement,
-- et seulement si la personne a activé la mémoire conversationnelle. Jamais accessibles au personnel.
-- ---------------------------------------------------------------------------
create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Conversation' check (char_length(title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  mode text not null default 'guided' check (mode in ('guided', 'ai')),
  crisis boolean not null default false,
  created_at timestamptz not null default now()
);
create index chat_messages_conv_idx on public.chat_messages (conversation_id, created_at);
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

-- Compteurs d'usage (limites quotidiennes, coûts maîtrisés) — serveur uniquement.
create table public.usage_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  kind text not null,
  n int not null default 0,
  primary key (user_id, day, kind)
);
alter table public.usage_counters enable row level security;

create or replace function public.bump_usage(p_user uuid, p_kind text, p_limit int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  insert into public.usage_counters (user_id, day, kind, n) values (p_user, current_date, p_kind, 1)
    on conflict (user_id, day, kind) do update set n = public.usage_counters.n + 1
    returning n into v_n;
  return v_n <= p_limit;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications : contiennent des RÉFÉRENCES, jamais de score, ressenti, santé ni contenu de chronique.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('reaction', 'comment', 'reply', 'moderation', 'report_result', 'reminder', 'chronicle', 'goal_due')),
  payload jsonb not null default '{}' check (pg_column_size(payload) < 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create unique index notifications_goal_due_uq on public.notifications (user_id, ((payload ->> 'goal_id'))) where kind = 'goal_due';
alter table public.notifications enable row level security;

create or replace function private.notif_enabled(p_uid uuid, p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (notification_prefs ->> p_kind)::boolean from public.profile_settings where user_id = p_uid), true)
$$;

create or replace function private.notify(p_uid uuid, p_kind text, p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_uid is not null and private.notif_enabled(p_uid, p_kind) then
    insert into public.notifications (user_id, kind, payload) values (p_uid, p_kind, p_payload);
  end if;
end $$;

create or replace function private.notify_on_reaction() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_author uuid;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is not null and v_author <> new.user_id and not private.hidden_between(v_author, new.user_id) then
    perform private.notify(v_author, 'reaction', jsonb_build_object('post_id', new.post_id,
      'actor_handle', (select handle from public.profiles where id = new.user_id)));
  end if;
  return null;
end $$;
create trigger notify_reaction after insert on public.reactions for each row execute function private.notify_on_reaction();

create or replace function private.notify_on_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_post_author uuid; v_parent_author uuid; v_handle text := (select handle from public.profiles where id = new.author_id);
begin
  if new.status <> 'published' then return null; end if;
  select author_id into v_post_author from public.posts where id = new.post_id;
  if new.parent_id is not null then
    select author_id into v_parent_author from public.comments where id = new.parent_id;
    if v_parent_author <> new.author_id and not private.hidden_between(v_parent_author, new.author_id) then
      perform private.notify(v_parent_author, 'reply', jsonb_build_object('post_id', new.post_id, 'comment_id', new.id, 'actor_handle', v_handle));
    end if;
  end if;
  if v_post_author <> new.author_id and v_post_author is distinct from v_parent_author
     and not private.hidden_between(v_post_author, new.author_id) then
    perform private.notify(v_post_author, 'comment', jsonb_build_object('post_id', new.post_id, 'comment_id', new.id, 'actor_handle', v_handle));
  end if;
  return null;
end $$;
create trigger notify_comment after insert on public.comments for each row execute function private.notify_on_comment();

-- Décisions de modération : la notification dit QU'une décision existe ; le détail et l'explication
-- se lisent dans « Mon compte > Modération » (jamais dans la notification ni l'e-mail).
create or replace function private.notify_on_moderation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.target_user_id is not null and (new.action in ('content_hide', 'content_remove', 'media_reject', 'appeal_upheld', 'appeal_overturned')
                                         or new.action like 'sanction\_%' and new.action <> 'sanction_revoked') then
    perform private.notify(new.target_user_id, 'moderation', jsonb_build_object('action', new.action));
  end if;
  return null;
end $$;
create trigger notify_moderation after insert on public.moderation_actions for each row execute function private.notify_on_moderation();

-- Résultat d'un signalement : message neutre, sans détail ni sanction prise contre la personne signalée.
create or replace function private.notify_on_report_closed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'closed' and old.status <> 'closed' and new.reporter_id is not null then
    perform private.notify(new.reporter_id, 'report_result', jsonb_build_object('report_id', new.id));
  end if;
  return null;
end $$;
create trigger notify_report_closed after update of status on public.reports for each row execute function private.notify_on_report_closed();

create or replace function public.enqueue_goal_due_notifications() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with ins as (
    insert into public.notifications (user_id, kind, payload)
    select g.user_id, 'goal_due', jsonb_build_object('goal_id', g.id)
    from public.goals g
    join public.profile_settings s on s.user_id = g.user_id
    where g.status in ('todo', 'in_progress') and g.due_date between current_date and current_date + 3
      and coalesce((s.notification_prefs ->> 'goal_due')::boolean, true)
    on conflict do nothing
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;

create or replace function public.create_notification_for_user(p_user uuid, p_kind text, p_payload jsonb default '{}') returns void
language sql security definer set search_path = '' as $$
  select private.notify(p_user, p_kind, p_payload)
$$;

-- ---------------------------------------------------------------------------
-- Export complet des données personnelles (droit d'accès / portabilité).
-- SECURITY INVOKER : la RLS garantit qu'on n'exporte que SES données ; les filtres explicites
-- évitent d'y mêler le contenu public d'autrui.
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data() returns jsonb
language plpgsql stable set search_path = '' as $$
declare v uuid := (select auth.uid());
begin
  if v is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v),
    'settings', (select to_jsonb(s) from public.profile_settings s where s.user_id = v),
    'rules_acceptances', (select coalesce(jsonb_agg(jsonb_build_object('kind', d.kind, 'version', d.version, 'accepted_at', a.accepted_at)), '[]')
                            from public.rules_acceptances a join public.legal_documents d on d.id = a.document_id where a.user_id = v),
    'indicator_categories', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.indicator_categories t where t.user_id = v),
    'indicators', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.indicators t where t.user_id = v),
    'checkins', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.checkins t where t.user_id = v),
    'checkin_answers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.checkin_answers t where t.user_id = v),
    'goals', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.goals t where t.user_id = v),
    'goal_steps', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.goal_steps t where t.user_id = v),
    'goal_events', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.goal_events t where t.user_id = v),
    'chronicles', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.chronicles t where t.user_id = v),
    'chronicle_deliveries', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.chronicle_deliveries t where t.user_id = v),
    'posts', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'body', t.body, 'kind', t.kind, 'status', t.status, 'created_at', t.created_at)), '[]')
                from public.posts t where t.author_id = v),
    'comments', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'post_id', t.post_id, 'body', t.body, 'status', t.status, 'created_at', t.created_at)), '[]')
                   from public.comments t where t.author_id = v),
    'reactions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.reactions t where t.user_id = v),
    'saved_items', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.saved_items t where t.user_id = v),
    'blocks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.blocks t where t.blocker_id = v),
    'media', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'display_name', m.display_name,
                'size_bytes', m.size_bytes, 'status', m.status, 'created_at', m.created_at)), '[]') from public.media_assets m where m.owner_id = v),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'target_type', r.target_type, 'reason', r.reason,
                'status', r.status, 'created_at', r.created_at)), '[]') from public.reports r where r.reporter_id = v),
    'sanctions', (select coalesce(jsonb_agg(jsonb_build_object('kind', s.kind, 'reason_code', s.reason_code, 'explanation', s.explanation,
                'starts_at', s.starts_at, 'ends_at', s.ends_at, 'revoked_at', s.revoked_at)), '[]') from public.sanctions s where s.user_id = v),
    'appeals', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.appeals t where t.user_id = v),
    'resource_progress', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.resource_progress t where t.user_id = v),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.notifications t where t.user_id = v),
    'chat_conversations', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.chat_conversations t where t.user_id = v),
    'chat_messages', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.chat_messages t where t.user_id = v),
    'note', 'Les notes internes de l''équipe de modération et les identités d''autres membres ne sont pas incluses.'
  );
end $$;

-- ---------------------------------------------------------------------------
-- Politiques et droits
-- ---------------------------------------------------------------------------
create policy chat_conversations_own on public.chat_conversations for select to authenticated using (user_id = (select auth.uid()));
create policy chat_conversations_delete on public.chat_conversations for delete to authenticated using (user_id = (select auth.uid()));
create policy chat_messages_own on public.chat_messages for select to authenticated using (user_id = (select auth.uid()));
create policy chat_messages_delete on public.chat_messages for delete to authenticated using (user_id = (select auth.uid()));
create policy notifications_own on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.chat_conversations, public.chat_messages, public.usage_counters, public.notifications from anon, authenticated;
grant select, delete on public.chat_conversations, public.chat_messages to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.chat_conversations, public.chat_messages, public.usage_counters, public.notifications to service_role;

revoke execute on function public.bump_usage(uuid, text, int), public.enqueue_goal_due_notifications(),
  public.create_notification_for_user(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.bump_usage(uuid, text, int), public.enqueue_goal_due_notifications(),
  public.create_notification_for_user(uuid, text, jsonb) to service_role;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated, service_role;
