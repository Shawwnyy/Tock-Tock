-- ============================================================================
-- Tock Tock — 0008 : bibliothèque de ressources et parcours (Phase E)
-- Trois provenances clairement séparées :
--   official : créé par l'équipe Tock Tock          (table resources, origin = 'official')
--   external : lien vers un site tiers, choisi par l'équipe (origin = 'external'), jamais republié
--   member   : publication d'un membre de type « ressource » (table posts, kind = 'resource', droits attestés)
-- ============================================================================

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  origin text not null check (origin in ('official', 'external')),
  kind text not null check (kind in ('tip', 'exercise', 'sheet', 'image', 'audio', 'video', 'pdf', 'link')),
  title text not null check (char_length(title) between 3 and 140),
  summary text not null check (char_length(summary) between 3 and 400),
  body_md text,
  media_id uuid references public.media_assets(id) on delete set null,
  external_url text check (external_url is null or external_url ~ '^https://[^\s]+$'),
  source_label text not null,
  -- Mention de droits obligatoire : on ne republie jamais un contenu protégé sans autorisation.
  license_note text not null check (char_length(license_note) >= 5),
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint resources_external_needs_url check (origin <> 'external' or external_url is not null)
);
alter table public.resources enable row level security;

create table public.pathways (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  summary text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order int not null default 0
);
alter table public.pathways enable row level security;

create table public.pathway_steps (
  pathway_id uuid not null references public.pathways(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  step_order int not null,
  is_optional boolean not null default false,
  hint text,
  primary key (pathway_id, resource_id)
);
alter table public.pathway_steps enable row level security;

create table public.resource_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  status text not null check (status in ('started', 'done')),
  updated_at timestamptz not null default now(),
  primary key (user_id, resource_id)
);
alter table public.resource_progress enable row level security;

alter table public.saved_items add constraint saved_items_resource_fk
  foreign key (resource_id) references public.resources(id) on delete cascade;

create or replace function private.media_in_published_resource(p_media uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.resources r where r.media_id = p_media and r.status = 'published')
$$;

-- La bibliothèque est accessible à tout membre ayant terminé son inscription (même hors communauté).
create or replace function private.can_read_library() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.onboarded_at is not null)
$$;

create or replace function public.set_resource_progress(p_resource uuid, p_status text) returns void
language sql security definer set search_path = '' as $$
  insert into public.resource_progress (user_id, resource_id, status)
  select (select auth.uid()), r.id, p_status from public.resources r
   where r.id = p_resource and r.status = 'published' and private.can_read_library()
  on conflict (user_id, resource_id) do update set status = excluded.status, updated_at = now()
$$;

create policy resources_select on public.resources for select to authenticated
  using ((status = 'published' and (select private.can_read_library())) or (select private.has_permission('resources.manage')));
create policy resources_manage on public.resources for all to authenticated
  using ((select private.has_permission('resources.manage'))) with check ((select private.has_permission('resources.manage')));
create policy pathways_select on public.pathways for select to authenticated
  using ((status = 'published' and (select private.can_read_library())) or (select private.has_permission('resources.manage')));
create policy pathways_manage on public.pathways for all to authenticated
  using ((select private.has_permission('resources.manage'))) with check ((select private.has_permission('resources.manage')));
create policy pathway_steps_select on public.pathway_steps for select to authenticated
  using (exists (select 1 from public.pathways p where p.id = pathway_id));
create policy pathway_steps_manage on public.pathway_steps for all to authenticated
  using ((select private.has_permission('resources.manage'))) with check ((select private.has_permission('resources.manage')));
create policy resource_progress_own on public.resource_progress for select to authenticated using (user_id = (select auth.uid()));
create policy resource_progress_delete on public.resource_progress for delete to authenticated using (user_id = (select auth.uid()));

-- Un favori de ressource exige que la ressource soit visible.
drop policy saved_items_insert on public.saved_items;
create policy saved_items_insert on public.saved_items for insert to authenticated
  with check (user_id = (select auth.uid())
              and (post_id is null or exists (select 1 from public.posts p where p.id = post_id))
              and (resource_id is null or exists (select 1 from public.resources r where r.id = resource_id)));

revoke all on public.resources, public.pathways, public.pathway_steps, public.resource_progress from anon, authenticated;
grant select, insert, update, delete on public.resources, public.pathways, public.pathway_steps to authenticated;
grant select, delete on public.resource_progress to authenticated;
grant all on public.resources, public.pathways, public.pathway_steps, public.resource_progress to service_role;
revoke execute on function public.set_resource_progress(uuid, text) from public, anon;
grant execute on function public.set_resource_progress(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ressources officielles de départ (rédigées pour Tock Tock ; aucun contenu tiers republié)
-- ---------------------------------------------------------------------------
insert into public.resources (origin, kind, title, summary, body_md, source_label, license_note, tags, status, sort_order, published_at) values
('official', 'tip', 'Faire son bilan en trois minutes',
 'Un bilan court vaut mieux qu''un bilan parfait jamais fait.',
 E'## Le principe\n\nTu n''as pas besoin de répondre à toutes les questions. Réponds à celles qui te parlent aujourd''hui, **laisse les autres vides** : une question sautée n''est jamais comptée comme un zéro.\n\n## En pratique\n\n1. Choisis trois questions qui comptent pour toi en ce moment.\n2. Note-les sans trop réfléchir : ta première impression est souvent la bonne.\n3. Ajoute une phrase si tu en as envie (un événement, un ressenti).\n4. C''est terminé. Tu pourras compléter plus tard.\n\n> Ces notes sont un repère personnel, pas un jugement.',
 'Tock Tock', 'Contenu original Tock Tock', '{bilan,habitudes}', 'published', 1, now()),
('official', 'exercise', 'Découper un objectif en petites étapes',
 'Transformer une grande intention en une première action de dix minutes.',
 E'## Exercice (10 minutes)\n\n1. **Écris l''objectif** tel qu''il te vient, même vague.\n2. **Pourquoi c''est important pour toi ?** Une phrase suffit.\n3. **Quelle serait la plus petite étape possible ?** Celle qui prend moins de dix minutes.\n4. **Quand ?** Choisis un moment réaliste, pas idéal.\n5. **Et si ça ne se passe pas comme prévu ?** Note une version encore plus petite.\n\nPrendre du retard n''est pas un échec : on ajuste l''étape, pas la valeur de la personne.',
 'Tock Tock', 'Contenu original Tock Tock', '{objectifs,organisation}', 'published', 2, now()),
('official', 'exercise', 'Trois petites victoires',
 'Repérer ce qui a fonctionné aujourd''hui, même modestement.',
 E'## Exercice (3 minutes)\n\nNote **trois choses** qui se sont bien passées ou que tu as réussies aujourd''hui. Elles peuvent être minuscules : un message envoyé, un repas pris, une pause respectée.\n\nPour chacune, ajoute **ce que tu as fait** pour que ça arrive. Il ne s''agit pas de forcer la positivité : une journée peut être difficile **et** contenir une petite victoire.',
 'Tock Tock', 'Contenu original Tock Tock', '{victoires,bien-etre}', 'published', 3, now()),
('official', 'exercise', 'Préparer demain en trois étapes',
 'Une mini-liste réaliste pour démarrer la journée suivante plus sereinement.',
 E'## Exercice (5 minutes)\n\n1. **Une chose importante** que tu aimerais avancer demain.\n2. **Une chose agréable** que tu t''autorises.\n3. **Une chose que tu laisses de côté** volontairement.\n\nGarde ta liste courte : trois lignes. Tu peux la demander à l''assistant ou l''ajouter à ta chronique de minuit.',
 'Tock Tock', 'Contenu original Tock Tock', '{organisation,demain}', 'published', 4, now()),
('official', 'exercise', 'Mettre des mots sur ce que je ressens',
 'Un petit vocabulaire pour nommer une émotion, sans la juger.',
 E'## Exercice\n\nComplète : « En ce moment, je me sens **…** parce que **…**. J''aurais besoin de **…**. »\n\nQuelques mots pour t''aider : *fatigué·e, soulagé·e, inquiet·ète, content·e, agacé·e, découragé·e, fier·ère, seul·e, entouré·e, calme, tendu·e, motivé·e*.\n\nTu peux en choisir plusieurs. Aucune émotion n''est « mauvaise » : elle donne une information sur ce qui compte pour toi.\n\n*Cet exercice est un outil de réflexion. Il ne remplace pas l''avis d''un professionnel de santé.*',
 'Tock Tock', 'Contenu original Tock Tock', '{emotions,reflexion}', 'published', 5, now()),
('official', 'tip', 'Une journée difficile peut aussi faire avancer',
 'Reconnaître les efforts même quand le résultat n''est pas au rendez-vous.',
 E'Une journée peut être **dure et porteuse de progrès** à la fois. Quand tu relis ton bilan, cherche :\n\n- ce que tu as **tenté**, même sans le terminer ;\n- ce que tu as **appris** sur toi ou sur ta façon de travailler ;\n- ce dont tu avais **besoin** et que tu pourras demander ou t''accorder demain.\n\nUne note basse n''est pas une condamnation : c''est un repère pour prendre soin de toi.',
 'Tock Tock', 'Contenu original Tock Tock', '{bien-etre,resilience}', 'published', 6, now()),
('official', 'tip', 'Organiser sa journée selon son énergie',
 'Placer les tâches exigeantes quand tu as de l''énergie, les tâches légères quand elle baisse.',
 E'1. Repère les moments de la journée où ton énergie est **plutôt haute** ou **plutôt basse** (ton historique peut t''y aider).\n2. Place **une** tâche exigeante dans un moment favorable.\n3. Garde les tâches légères (ranger, répondre à des messages) pour les moments creux.\n4. Prévois une vraie pause : elle fait partie du travail.',
 'Tock Tock', 'Contenu original Tock Tock', '{organisation,energie}', 'published', 7, now()),
('official', 'sheet', 'Quand et comment demander de l''aide',
 'Des repères pour savoir vers qui se tourner, en France.',
 E'## Tu n''as pas à traverser ça seul·e\n\nParler à une personne de confiance (un proche, un adulte, un enseignant, un médecin) est souvent le premier pas.\n\n## Numéros utiles en France\n\n- **112** : urgence immédiate (gratuit, 24 h/24).\n- **3114** : numéro national de prévention du suicide, 24 h/24, gratuit.\n- **119** : enfance en danger.\n- **3018** : harcèlement et violences numériques.\n- **15** : SAMU (urgence médicale) · **17** : police · **18** : pompiers.\n\nSi tu es dans un autre pays, un annuaire international existe : findahelpline.com.\n\n*Tock Tock n''est pas un service d''urgence et ne surveille pas les conversations : en cas de danger, appelle un service d''urgence.*',
 'Tock Tock', 'Contenu original Tock Tock', '{aide,urgence}', 'published', 8, now()),
('official', 'sheet', 'Protéger sa vie privée en ligne',
 'Quelques réflexes simples pour échanger en confiance.',
 E'- Utilise un **pseudonyme** : personne n''a besoin de ton vrai nom.\n- **Ne partage jamais** ton adresse, ton numéro, ton établissement ou tes réseaux sociaux avec des inconnus.\n- Si quelqu''un te demande ces informations ou te propose de parler « en privé » ailleurs : **signale** et **bloque**.\n- Tu n''as pas à justifier un blocage.\n- Tes bilans et chroniques restent privés tant que tu ne décides pas toi-même de partager quelque chose.',
 'Tock Tock', 'Contenu original Tock Tock', '{vie-privee,securite}', 'published', 9, now());

insert into public.resources (origin, kind, title, summary, external_url, source_label, license_note, tags, status, sort_order, published_at) values
('external', 'link', '3114 — Prévention du suicide', 'Site du numéro national de prévention du suicide (France). Contenu externe, non géré par Tock Tock.',
 'https://3114.fr', '3114.fr', 'Lien externe : contenu non republié', '{aide,urgence}', 'published', 20, now()),
('external', 'link', 'e-Enfance — 3018', 'Association de protection de l''enfance en ligne (harcèlement, cyberviolences). Contenu externe.',
 'https://e-enfance.org', 'e-enfance.org', 'Lien externe : contenu non republié', '{harcelement,securite}', 'published', 21, now());

insert into public.pathways (title, summary, status, sort_order) values
 ('Démarrer avec Tock Tock', 'Trois exercices pour prendre ses repères, à ton rythme.', 'published', 1),
 ('Avancer par petites étapes', 'Un parcours doux pour transformer une intention en actions réalistes.', 'published', 2);

insert into public.pathway_steps (pathway_id, resource_id, step_order, is_optional, hint)
select p.id, r.id, v.ord, v.opt, v.hint
from (values
  ('Démarrer avec Tock Tock', 'Faire son bilan en trois minutes', 1, false, 'Commence par là.'),
  ('Démarrer avec Tock Tock', 'Trois petites victoires', 2, false, null),
  ('Démarrer avec Tock Tock', 'Préparer demain en trois étapes', 3, true, 'Facultatif : quand tu te sens prêt·e.'),
  ('Avancer par petites étapes', 'Découper un objectif en petites étapes', 1, false, null),
  ('Avancer par petites étapes', 'Organiser sa journée selon son énergie', 2, true, null),
  ('Avancer par petites étapes', 'Une journée difficile peut aussi faire avancer', 3, false, null)
) as v(ptitle, rtitle, ord, opt, hint)
join public.pathways p on p.title = v.ptitle
join public.resources r on r.title = v.rtitle;
