-- ============================================================================
-- Tock Tock — 0007 : médias (images, audio, vidéo, PDF) — métadonnées, accès, quotas
-- Phase D. Le contrôle des octets (type réel, antivirus, détection de contenus) est fait CÔTÉ SERVEUR par
-- les Edge Functions `media-upload-init` / `media-upload-finalize` (voir supabase/functions et docs/SECURITY.md).
-- Cette migration garantit que, quoi que fasse un client, un fichier n'est lisible par d'autres membres
-- que s'il est « approved » ET rattaché à un contenu publié visible par eux.
--
-- Cycle de vie : uploading -> (rejected | quarantined | pending_review) -> approved -> deleted
-- Buckets : temp-uploads (dépôt initial) -> community-media (fichiers acceptés) | quarantine (fichiers suspects)
-- ============================================================================

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image', 'audio', 'video', 'document')),
  purpose text not null default 'post' check (purpose in ('post', 'resource')),
  -- Nom d'affichage nettoyé. Jamais utilisé comme chemin : le fichier est RENOMMÉ côté serveur.
  display_name text not null check (char_length(display_name) between 1 and 100),
  bucket text not null default 'temp-uploads' check (bucket in ('temp-uploads', 'community-media', 'quarantine')),
  storage_path text not null unique,
  declared_mime text,
  detected_mime text,
  size_bytes bigint not null check (size_bytes > 0),
  -- Durée DÉCLARÉE par le client : non vérifiable sans décodeur multimédia (voir limitations connues).
  duration_seconds int check (duration_seconds is null or duration_seconds >= 0),
  sha256 text,
  status text not null default 'uploading'
    check (status in ('uploading', 'pending_review', 'approved', 'rejected', 'quarantined', 'deleted')),
  scan_result jsonb not null default '{}',
  moderation_flags text[] not null default '{}',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  expires_at timestamptz
);
create index media_assets_owner_idx on public.media_assets (owner_id, created_at desc);
create index media_assets_status_idx on public.media_assets (status, created_at);
alter table public.media_assets enable row level security;

create table public.post_media (
  post_id uuid not null references public.posts(id) on delete cascade,
  media_id uuid not null references public.media_assets(id) on delete cascade,
  sort_order int not null default 0,
  primary key (post_id, media_id)
);
alter table public.post_media enable row level security;

create or replace function private.post_media_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.posts p where p.id = new.post_id and p.author_id = (select auth.uid())) then
    raise exception 'not_your_post' using errcode = '42501';
  end if;
  if not exists (select 1 from public.media_assets m where m.id = new.media_id and m.owner_id = (select auth.uid())
                  and m.status in ('pending_review', 'approved')) then
    raise exception 'media_not_ready' using errcode = '22023';
  end if;
  if (select count(*) from public.post_media where post_id = new.post_id) >= 6 then
    raise exception 'too_many_attachments' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger post_media_guard before insert on public.post_media for each row execute function private.post_media_guard();

-- Une ressource officielle peut aussi porter un média (redéfini en 0008).
create or replace function private.media_in_published_resource(p_media uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;

-- Lecture d'un fichier : propriétaire, relecteur habilité (en attente), ou membre autorisé (approuvé + contenu visible).
create or replace function private.can_read_media_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.media_assets m
    where m.storage_path = p_name and m.bucket = 'community-media'
      and (
        (m.owner_id = (select auth.uid()) and m.status in ('pending_review', 'approved'))
        or (m.status = 'pending_review' and private.has_permission('media.review'))
        or (m.status = 'approved' and private.can_read_community() and (
              exists (select 1 from public.post_media pm join public.posts p on p.id = pm.post_id
                       where pm.media_id = m.id and p.status = 'published'
                         and not private.hidden_between((select auth.uid()), p.author_id))
              or private.media_in_published_resource(m.id)))
      )
  )
$$;

-- Utilisation (quota) — réservé au serveur.
create or replace function public.media_usage(p_user uuid) returns table (bytes bigint, uploads_today int)
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(size_bytes) filter (where status not in ('rejected', 'deleted')), 0)::bigint,
         (count(*) filter (where created_at > now() - interval '1 day'))::int
  from public.media_assets where owner_id = p_user
$$;

-- Suppression demandée par le propriétaire : le fichier est retiré des contenus et purgé par la tâche de nettoyage.
create or replace function public.request_media_deletion(p_media uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  update public.media_assets set status = 'deleted', expires_at = now() where id = p_media and owner_id = v_uid and status <> 'deleted';
  if not found then raise exception 'unknown_media' using errcode = '22023'; end if;
  delete from public.post_media where media_id = p_media;
end $$;

-- Relecture humaine d'un média en attente.
create or replace function public.review_media(p_media uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); m public.media_assets; v_status text;
begin
  if not private.has_permission('media.review') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'invalid_decision' using errcode = '22023'; end if;
  if p_decision = 'reject' and (p_note is null or char_length(btrim(p_note)) < 10) then
    raise exception 'explanation_required' using errcode = '22023';
  end if;
  select * into m from public.media_assets where id = p_media and status = 'pending_review';
  if m.id is null then raise exception 'unknown_media' using errcode = '22023'; end if;
  if m.owner_id = v_actor then raise exception 'cannot_review_own_media' using errcode = '42501'; end if;
  v_status := case p_decision when 'approve' then 'approved' else 'rejected' end;
  update public.media_assets
     set status = v_status, reviewed_by = v_actor, reviewed_at = now(), review_note = p_note,
         approved_at = case when v_status = 'approved' then now() end,
         expires_at = case when v_status = 'rejected' then now() + interval '7 days' end
   where id = p_media;
  insert into public.moderation_actions (moderator_id, moderator_handle, action, target_user_id, target_user_handle,
                                         target_type, target_id, reason, explanation)
    values (v_actor, (select handle from public.profiles where id = v_actor), 'media_' || p_decision, m.owner_id,
            (select handle from public.profiles where id = m.owner_id), 'media', p_media, p_decision, p_note);
end $$;

-- File de relecture des médias : métadonnées uniquement (le fichier se lit via une URL temporaire, sous contrôle d'accès).
create view public.staff_media_queue with (security_barrier = true) as
select m.id, m.created_at, m.kind, m.display_name, m.size_bytes, m.duration_seconds, m.detected_mime,
       m.moderation_flags, m.scan_result, m.storage_path, p.handle as owner_handle,
       coalesce((select pr.age_band in ('under_15', '15_17') from public.profile_settings pr where pr.user_id = m.owner_id), false) as owner_is_minor
from public.media_assets m
join public.profiles p on p.id = m.owner_id
where m.status = 'pending_review' and private.has_permission('media.review');

-- ---------------------------------------------------------------------------
-- Politiques RLS
-- ---------------------------------------------------------------------------
create policy media_assets_select on public.media_assets for select to authenticated using (
  owner_id = (select auth.uid())
  or (status = 'approved'
      and (exists (select 1 from public.post_media pm where pm.media_id = media_assets.id)    -- hérite de la visibilité du billet
           or private.media_in_published_resource(id)))
);
create policy post_media_select on public.post_media for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_media.post_id));
create policy post_media_insert on public.post_media for insert to authenticated with check (true);   -- vérifié par le trigger
create policy post_media_delete on public.post_media for delete to authenticated
  using (exists (select 1 from public.posts p where p.id = post_media.post_id and p.author_id = (select auth.uid())));

revoke all on public.media_assets, public.post_media, public.staff_media_queue from anon, authenticated;
-- Le client lit des métadonnées sûres ; il ne voit jamais scan_result ni les notes de relecture.
grant select (id, owner_id, kind, purpose, display_name, bucket, storage_path, detected_mime, size_bytes,
              duration_seconds, status, created_at, approved_at) on public.media_assets to authenticated;
grant select, insert, delete on public.post_media to authenticated;
grant select on public.staff_media_queue to authenticated;
grant all on public.media_assets, public.post_media, public.staff_media_queue to service_role;

revoke execute on function public.media_usage(uuid) from public, anon, authenticated;
grant execute on function public.media_usage(uuid) to service_role;
revoke execute on function public.request_media_deletion(uuid), public.review_media(uuid, text, text) from public, anon;
grant execute on function public.request_media_deletion(uuid), public.review_media(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Stockage : buckets privés séparés + politiques
--   temp-uploads     : dépôt initial (écriture par URL signée créée par le serveur ; AUCUNE lecture cliente)
--   quarantine       : fichiers suspects (aucun accès client)
--   community-media  : fichiers acceptés (lecture contrôlée par private.can_read_media_object)
--   private-documents: documents privés d'un membre (dossier = son identifiant)
--   chronicles       : PDF des chroniques (dossier = identifiant du membre ; JAMAIS public)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit) values
  ('temp-uploads', 'temp-uploads', false, 52428800),
  ('quarantine', 'quarantine', false, 52428800),
  ('community-media', 'community-media', false, 52428800),
  ('private-documents', 'private-documents', false, 10485760),
  ('chronicles', 'chronicles', false, 10485760)
on conflict (id) do update set public = false;

create policy storage_community_media_read on storage.objects for select to authenticated
  using (bucket_id = 'community-media' and private.can_read_media_object(name));

create policy storage_private_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'private-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy storage_private_docs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'private-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy storage_private_docs_update on storage.objects for update to authenticated
  using (bucket_id = 'private-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy storage_private_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'private-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Chroniques : lecture par le propriétaire uniquement ; écriture réservée au serveur (clé service).
create policy storage_chronicles_read on storage.objects for select to authenticated
  using (bucket_id = 'chronicles' and (storage.foldername(name))[1] = (select auth.uid())::text);
