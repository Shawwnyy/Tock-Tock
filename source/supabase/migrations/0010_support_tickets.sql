-- Tock Tock — 0010 : aide et tickets de support (version serveur)
--
-- Principes :
--  * Un membre ne voit QUE ses tickets et les messages publics qui y répondent ; jamais les notes internes ni l'identité du personnel.
--  * Le personnel (permission « tickets.handle ») passe par des vues et des RPC : il voit le pseudonyme du membre et le contenu du
--    ticket, JAMAIS ses bilans, objectifs, chroniques ou conversations (aucune politique du personnel sur ces tables — testé).
--  * Le texte d'un ticket n'est jamais refusé (une personne en détresse peut être maladroite) : il est analysé, et un indicateur
--    « needs_support » relève la priorité pour que le personnel réponde en premier. Cet indicateur n'est visible que du personnel.
--  * Les informations techniques jointes sont filtrées par liste blanche (aucun contenu personnel possible).
--  * Limites : 5 tickets par jour, 10 tickets ouverts, 30 messages par jour.

insert into public.role_permissions (role, permission) values
  ('moderator', 'tickets.handle'), ('senior_moderator', 'tickets.handle'), ('admin', 'tickets.handle')
on conflict do nothing;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('bug', 'usage', 'data', 'suggestion', 'report', 'other')),
  subject text not null check (char_length(btrim(subject)) between 5 and 100),
  priority text not null default 'normal' check (priority in ('normal', 'important')),
  status text not null default 'open' check (status in ('open', 'pending_member', 'resolved', 'closed')),
  diagnostic jsonb not null default '{}',
  flags jsonb not null default '{}',
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index support_tickets_user_idx on public.support_tickets (user_id, created_at desc);
create index support_tickets_queue_idx on public.support_tickets (status, priority, created_at);
alter table public.support_tickets enable row level security;

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  is_staff boolean not null default false,
  internal boolean not null default false,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  check (not internal or is_staff)
);
create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);
alter table public.support_messages enable row level security;

-- Référence lisible TT-AAAAMMJJ-XXXX (unique, avec nouvel essai en cas de collision).
create or replace function private.support_ticket_ref() returns trigger
language plpgsql set search_path = '' as $$
declare v_ref text; v_try int := 0;
begin
  loop
    v_ref := 'TT-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from public.support_tickets where ref = v_ref);
    v_try := v_try + 1;
    if v_try > 20 then raise exception 'ref_generation_failed'; end if;
  end loop;
  new.ref := v_ref;
  return new;
end $$;
create trigger support_tickets_ref before insert on public.support_tickets
  for each row execute function private.support_ticket_ref();

-- ---------------------------------------------------------------------------
-- Politiques : le membre lit ses tickets et les messages publics. Aucune écriture directe (RPC uniquement).
-- ---------------------------------------------------------------------------
create policy support_tickets_own_select on public.support_tickets for select to authenticated
  using (user_id = (select auth.uid()));
create policy support_messages_own_select on public.support_messages for select to authenticated
  using (not internal and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = (select auth.uid())));

-- Vues du personnel : pseudonyme du membre, jamais son identifiant ni ses données privées.
create view public.staff_tickets with (security_barrier = true) as
select t.id, t.ref, t.created_at, t.updated_at, t.closed_at, t.status, t.priority, t.category, t.subject, t.flags, t.diagnostic,
       t.assigned_to, p.handle as user_handle,
       (select count(*) from public.support_messages m where m.ticket_id = t.id) as message_count
from public.support_tickets t join public.profiles p on p.id = t.user_id
where private.has_permission('tickets.handle');

create view public.staff_ticket_messages with (security_barrier = true) as
select m.id, m.ticket_id, m.created_at, m.is_staff, m.internal, m.body, a.handle as author_handle
from public.support_messages m left join public.profiles a on a.id = m.author_id
where private.has_permission('tickets.handle');

-- ---------------------------------------------------------------------------
-- RPC (SECURITY DEFINER, search_path fixé)
-- ---------------------------------------------------------------------------
create or replace function public.create_ticket(
  p_category text, p_subject text, p_body text, p_priority text default 'normal', p_diagnostic jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_flags jsonb; v_diag jsonb; v_id uuid; v_ref text; v_needs boolean; v_prio text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then raise exception 'no_profile' using errcode = '42501'; end if;
  if p_category not in ('bug', 'usage', 'data', 'suggestion', 'report', 'other') then raise exception 'invalid_category' using errcode = '22023'; end if;
  if p_priority not in ('normal', 'important') then raise exception 'invalid_priority' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_subject, ''))) not between 5 and 100 then raise exception 'invalid_subject' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 15 and 2000 then raise exception 'invalid_body' using errcode = '22023'; end if;
  if (select count(*) from public.support_tickets where user_id = v_uid and created_at > now() - interval '1 day') >= private.cfg_int('tickets.max_per_day', 5) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if (select count(*) from public.support_tickets where user_id = v_uid and status in ('open', 'pending_member')) >= private.cfg_int('tickets.max_open', 10) then
    raise exception 'too_many_open' using errcode = '54000';
  end if;

  -- Informations techniques : liste blanche de clés, valeurs simples et courtes uniquement.
  select coalesce(jsonb_object_agg(k, left(v #>> '{}', 200)), '{}'::jsonb) into v_diag
  from jsonb_each(case when jsonb_typeof(p_diagnostic) = 'object' then p_diagnostic else '{}'::jsonb end) as e(k, v)
  where k in ('app', 'version', 'browser', 'os', 'timezone', 'screen', 'language', 'storage') and jsonb_typeof(v) in ('string', 'number', 'boolean');

  v_flags := private.text_flags(p_subject || ' ' || p_body, v_uid);
  v_needs := coalesce((v_flags ->> 'needs_support')::boolean, false);
  v_prio := case when v_needs then 'important' else p_priority end;

  insert into public.support_tickets (ref, user_id, category, subject, priority, diagnostic, flags)
  values ('pending', v_uid, p_category, btrim(p_subject), v_prio, v_diag, v_flags)
  returning id, ref into v_id, v_ref;
  insert into public.support_messages (ticket_id, author_id, body) values (v_id, v_uid, btrim(p_body));
  return jsonb_build_object('id', v_id, 'ref', v_ref, 'needs_support', v_needs);
end $$;

create or replace function public.add_ticket_message(p_ticket uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_status text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select status into v_status from public.support_tickets where id = p_ticket and user_id = v_uid;
  if v_status is null then raise exception 'not_found' using errcode = '22023'; end if;
  if v_status = 'closed' then raise exception 'ticket_closed' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then raise exception 'invalid_body' using errcode = '22023'; end if;
  if (select count(*) from public.support_messages where author_id = v_uid and not is_staff and created_at > now() - interval '1 day') >= private.cfg_int('tickets.messages_per_day', 30) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into public.support_messages (ticket_id, author_id, body) values (p_ticket, v_uid, btrim(p_body));
  update public.support_tickets set updated_at = now(), status = case when status in ('pending_member', 'resolved') then 'open' else status end where id = p_ticket;
end $$;

create or replace function public.close_my_ticket(p_ticket uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  update public.support_tickets set status = 'closed', closed_at = now(), updated_at = now() where id = p_ticket and user_id = v_uid;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
end $$;

create or replace function public.staff_reply_ticket(p_ticket uuid, p_body text, p_internal boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not private.has_permission('tickets.handle') then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'invalid_body' using errcode = '22023'; end if;
  if not exists (select 1 from public.support_tickets where id = p_ticket) then raise exception 'not_found' using errcode = '22023'; end if;
  insert into public.support_messages (ticket_id, author_id, is_staff, internal, body) values (p_ticket, v_uid, true, coalesce(p_internal, false), btrim(p_body));
  update public.support_tickets set updated_at = now(), assigned_to = coalesce(assigned_to, v_uid),
    status = case when not coalesce(p_internal, false) and status = 'open' then 'pending_member' else status end
  where id = p_ticket;
end $$;

create or replace function public.staff_set_ticket_status(p_ticket uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_old text; v_handle text;
begin
  if not private.has_permission('tickets.handle') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('open', 'pending_member', 'resolved', 'closed') then raise exception 'invalid_status' using errcode = '22023'; end if;
  select status into v_old from public.support_tickets where id = p_ticket;
  if v_old is null then raise exception 'not_found' using errcode = '22023'; end if;
  update public.support_tickets set status = p_status, updated_at = now(), closed_at = case when p_status = 'closed' then now() else null end where id = p_ticket;
  select handle into v_handle from public.profiles where id = v_uid;
  -- Trace du changement de statut (note interne, invisible du membre).
  insert into public.support_messages (ticket_id, author_id, is_staff, internal, body)
  values (p_ticket, v_uid, true, true, format('Statut : %s -> %s (par %s)', v_old, p_status, coalesce(v_handle, 'personnel')));
end $$;

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
revoke all on public.support_tickets, public.support_messages, public.staff_tickets, public.staff_ticket_messages from anon, authenticated;
grant select (id, ref, user_id, category, subject, priority, status, diagnostic, created_at, updated_at, closed_at) on public.support_tickets to authenticated;
grant select (id, ticket_id, is_staff, internal, body, created_at) on public.support_messages to authenticated;
grant select on public.staff_tickets, public.staff_ticket_messages to authenticated;
grant all on public.support_tickets, public.support_messages, public.staff_tickets, public.staff_ticket_messages to service_role;

revoke execute on function public.create_ticket(text, text, text, text, jsonb), public.add_ticket_message(uuid, text), public.close_my_ticket(uuid),
  public.staff_reply_ticket(uuid, text, boolean), public.staff_set_ticket_status(uuid, text) from public, anon;
grant execute on function public.create_ticket(text, text, text, text, jsonb), public.add_ticket_message(uuid, text), public.close_my_ticket(uuid),
  public.staff_reply_ticket(uuid, text, boolean), public.staff_set_ticket_status(uuid, text) to authenticated, service_role;
