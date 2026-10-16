-- ============================================================================
-- Tock Tock — 0004 : modération automatique du texte (niveaux 1 et 2) + pseudonymes
--
-- ⚠ Limites assumées : ce filtre est un FILET DE SÉCURITÉ minimal, à base de motifs. Il ne détecte pas
--   tout (ironie, langues étrangères, fautes volontaires, images) et peut produire des faux positifs.
--   La liste de départ est volontairement courte : l'équipe l'étend via la table moderation_terms.
--   Le principe retenu : décision 'block' (refus avec explication) uniquement pour les cas nets ;
--   'hold' (mise en attente d'examen humain) en cas de doute ; jamais de suppression automatique
--   parce qu'un sujet difficile est mentionné (demande d'aide, contexte éducatif).
-- ============================================================================

alter table public.profiles add column display_name_changed_at timestamptz;

create table public.moderation_terms (
  id uuid primary key default gen_random_uuid(),
  -- Expression régulière PostgreSQL (ARE), appliquée au texte normalisé ('norm') ou brut en minuscules ('raw').
  pattern text not null,
  applies_to text not null default 'norm' check (applies_to in ('norm', 'raw')),
  severity text not null check (severity in ('hold', 'block')),
  -- Sévérité appliquée si l'auteur est (déclaré) mineur ; par défaut la même.
  severity_minor text check (severity_minor in ('hold', 'block')),
  category text not null,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);
alter table public.moderation_terms enable row level security;

create table public.allowed_link_domains (
  domain text primary key check (domain = lower(domain) and domain !~ '[/\s]'),
  note text
);
alter table public.allowed_link_domains enable row level security;

-- Texte normalisé pour la détection : minuscules, accents retirés, « leet » décodé, ponctuation -> espaces,
-- répétitions de lettres (≥ 3) ramenées à 2 (« connnnard » -> « connard »).
create or replace function private.normalize_text(p_text text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(
           regexp_replace(
             translate(lower(coalesce(p_text, '')),
                       'àâäáãåéèêëíìîïóòôöõúùûüçñœæ@$0134578',
                       'aaaaaaeeeeiiiiooooouuuucnoaasoieastb'),
             '(.)\1{2,}', '\1\1', 'g'),
           '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function private.worse(a text, b text) returns text
language sql immutable set search_path = '' as $$
  select case when 'block' in (a, b) then 'block' when 'hold' in (a, b) then 'hold' else 'allow' end
$$;

create or replace function private.text_flags(p_text text, p_author uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_raw text := lower(coalesce(p_text, ''));
  v_norm text := private.normalize_text(p_text);
  v_minor boolean := case when p_author is null then false else private.is_minor(p_author) end;
  v_decision text := 'allow';
  v_cats text[] := '{}';
  v_support boolean := false;
  r record;
  v_url text;
  v_host text;
  v_sev text;
begin
  if v_raw = '' then
    return jsonb_build_object('decision', 'allow', 'categories', '[]'::jsonb, 'needs_support', false);
  end if;

  for r in select * from public.moderation_terms where active loop
    if (case r.applies_to when 'raw' then v_raw else v_norm end) ~ r.pattern then
      v_sev := case when v_minor then coalesce(r.severity_minor, r.severity) else r.severity end;
      v_decision := private.worse(v_decision, v_sev);
      v_cats := array_append(v_cats, r.category);
    end if;
  end loop;

  -- Liens : raccourcisseurs refusés (destination masquée) ; domaines hors liste blanche mis en attente.
  for v_url in
    select m[1] from regexp_matches(v_raw,
      '((?:https?://|www\.)[^\s<>"'']+|\m[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|fr|net|org|io|ru|xyz|top|info|co|me|be|ch|ca|ly|gl|cc|tk|biz|link|click|shop|site|online)\M(?:/[^\s<>"'']*)?)', 'g') as m
  loop
    v_host := split_part(regexp_replace(regexp_replace(v_url, '^https?://', ''), '^www\.', ''), '/', 1);
    if v_host in ('bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at', 'ow.ly', 'tiny.cc') then
      v_decision := private.worse(v_decision, 'block');
      v_cats := array_append(v_cats, 'link_shortener');
    elsif not exists (select 1 from public.allowed_link_domains d where v_host = d.domain or v_host like '%.' || d.domain) then
      v_decision := private.worse(v_decision, 'hold');
      v_cats := array_append(v_cats, 'link');
    end if;
  end loop;

  -- Détresse exprimée par la personne elle-même : on ne bloque RIEN, on propose de l'aide.
  if v_norm ~ '\m(je (veux|voudrais|vais) (mourir|me tuer|en finir|disparaitre)|envie de (mourir|me tuer|en finir)|me faire du mal|me suicider|plus envie de vivre|idees noires|je n en peux plus)\M' then
    v_support := true;
  end if;

  return jsonb_build_object(
    'decision', v_decision,
    'categories', (select coalesce(jsonb_agg(distinct c), '[]'::jsonb) from unnest(v_cats) c),
    'needs_support', v_support);
end $$;

-- Liste de départ (à étendre et relire par l'équipe de modération).
insert into public.moderation_terms (pattern, applies_to, severity, severity_minor, category, note) values
  -- Insultes et attaques personnelles
  ('\m(connard|connasse|connards|salope|salopes|enfoire|enfoires|encule|encules|batard|batards|ordure|pourriture|abruti|abrutie|abrutis|merdeux|pute|putes|petasse|crevard|cretin|cretine)\M', 'norm', 'block', null, 'insult', 'Insultes courantes'),
  ('\mta gueule\M', 'norm', 'block', null, 'insult', null),
  ('\mnique (ta|ton|tes)\M', 'norm', 'block', null, 'insult', null),
  ('\mva te faire (foutre|enculer)\M', 'norm', 'block', null, 'insult', null),
  -- Menaces et harcèlement
  ('\m(je|on) (vais|va|vas) (te |vous )?(tuer|buter|crever|massacrer|defoncer|frapper|retrouver|egorger|violer|exploser)\M', 'norm', 'block', null, 'threat', 'Menaces directes'),
  ('\mje sais ou tu (habites|vis|etudies|travailles)\M', 'norm', 'block', null, 'threat', null),
  ('\m(tue toi|suicide toi|va te (tuer|pendre|jeter)|va (mourir|crever))\M', 'norm', 'block', null, 'harassment', 'Incitation à l''autodestruction dirigée contre quelqu''un'),
  -- Discrimination
  ('\msales? (arabes?|noirs?|negres?|juifs?|pedes?|pd|gouines?|bougnoules?|chinetoques?|roms?|migrants?|musulmans?|handicapes?)\M', 'norm', 'block', null, 'discrimination', null),
  ('\m(retourne|rentre|rentrez) (dans|chez) (ton|ta|tes|votre|vos) (pays|race)\M', 'norm', 'block', null, 'discrimination', null),
  -- Contenus sexuels / sollicitations
  ('\m(envoie|envoies|envoyez|montre|montres|montrez)( moi)? (des |tes |ta |ton )?(photos?|nudes?|seins|fesses|corps)\M', 'norm', 'block', null, 'sexual_solicitation', 'Sollicitation, notamment envers des mineurs'),
  ('\m(nudes?|porno|pornographique|xxx|onlyfans)\M', 'norm', 'hold', 'block', 'sexual_content', null),
  ('\m(photos?|videos?) (de toi )?(nue?s?|a poil)\M', 'norm', 'hold', 'block', 'sexual_content', null),
  -- Contenus dangereux
  ('\m(pro ?ana|pro ?mia|thinspo)\M', 'norm', 'block', null, 'dangerous_content', 'Promotion des troubles alimentaires'),
  ('\m(defi|challenge) (du )?(foulard|blackout|etouffement)\M', 'norm', 'block', null, 'dangerous_content', null),
  ('\m(gore|decapitation|decapite|torture)\M', 'norm', 'hold', null, 'violent_content', 'Contenu potentiellement choquant : examen humain'),
  -- Spam / arnaques / contournement
  ('\m(gagne|gagner|gagnez) [0-9]+ ?(euros?|€|dollars?)', 'raw', 'hold', null, 'scam', null),
  ('\m(cliquez|clique) (ici|sur ce lien)\M', 'norm', 'hold', null, 'scam', null),
  ('\m(bitcoin|crypto|forex|investissement) (garanti|sans risque)\M', 'norm', 'hold', null, 'scam', null),
  ('\m(contourner|bypass|eviter) (la )?moderation\M', 'norm', 'hold', null, 'moderation_evasion', null),
  -- Coordonnées privées (mises en attente ; bloquées pour les mineurs déclarés)
  ('[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}', 'raw', 'hold', 'block', 'personal_info', 'Adresse e-mail'),
  ('(?:(?:\+|00)33|\m0)\s*[1-9](?:[\s.\-]*[0-9]{2}){4}\M', 'raw', 'hold', 'block', 'personal_info', 'Numéro de téléphone français'),
  ('\+[0-9]{1,3}[\s.\-]*[0-9](?:[\s.\-]*[0-9]){7,12}', 'raw', 'hold', 'block', 'personal_info', 'Numéro international'),
  ('\m(donne|donnes|passe|passes|file|envoie|envoies|ecris|contacte)( moi)? (ton|tes|ta|votre) (numero|num|tel|telephone|snap|snapchat|insta|instagram|tiktok|whatsapp|telegram|discord|adresse|mail|email)\M', 'norm', 'hold', 'block', 'contact_request', 'Demande de coordonnées'),
  ('\mon (parle|discute|se parle) (en prive|sur (snap|snapchat|whatsapp|telegram|insta|instagram|discord))\M', 'norm', 'hold', 'block', 'contact_request', null),
  ('\m(viens|vient) (en )?(mp|prive|dm)\M', 'norm', 'hold', 'block', 'contact_request', null);

insert into public.allowed_link_domains (domain, note) values
  ('service-public.fr', 'Information administrative'), ('wikipedia.org', 'Encyclopédie'),
  ('3114.fr', 'Prévention du suicide (France)'), ('e-enfance.org', 'Protection de l''enfance en ligne'),
  ('santepubliquefrance.fr', 'Santé publique'), ('ameli.fr', 'Assurance maladie'),
  ('education.gouv.fr', 'Éducation nationale'), ('cnil.fr', 'Données personnelles'),
  ('findahelpline.com', 'Annuaire international de lignes d''écoute');

-- Prévisualisation côté client (décision et catégories uniquement ; les motifs restent confidentiels).
create or replace function public.check_text(p_text text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.text_flags(left(p_text, 20000), (select auth.uid()))
$$;

-- ---------------------------------------------------------------------------
-- Pseudonymes : pas d'usurpation du personnel, d'identifiant ou d'insulte
-- ---------------------------------------------------------------------------
create or replace function private.validate_display_name(p_name text, p_uid uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'); v_compact text;
begin
  if char_length(v_name) not between 2 and 30 or v_name !~ '^[^[:cntrl:]#<>@/\\]+$' then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;
  v_compact := replace(private.normalize_text(v_name), ' ', '');
  if v_compact ~ '(admin|moderat|modo|tocktock|support|staff|officiel|equipe|assistant|system|anonym)' or lower(replace(v_name, ' ', '')) ~ '^user[0-9]*$' then
    raise exception 'reserved_display_name' using errcode = '22023';
  end if;
  if (private.text_flags(v_name, p_uid) ->> 'decision') <> 'allow' then
    raise exception 'display_name_rejected' using errcode = '22023';
  end if;
  return v_name;
end $$;

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
create policy moderation_terms_manage on public.moderation_terms for all to authenticated
  using ((select private.has_permission('terms_filter.manage')))
  with check ((select private.has_permission('terms_filter.manage')));
create policy allowed_link_domains_select on public.allowed_link_domains for select to authenticated using (true);
create policy allowed_link_domains_manage on public.allowed_link_domains for all to authenticated
  using ((select private.has_permission('terms_filter.manage')))
  with check ((select private.has_permission('terms_filter.manage')));

revoke all on public.moderation_terms, public.allowed_link_domains from anon, authenticated;
grant select, insert, update, delete on public.moderation_terms to authenticated;   -- filtré par la politique (admin seulement)
grant select on public.allowed_link_domains to authenticated;
grant insert, update, delete on public.allowed_link_domains to authenticated;
grant all on public.moderation_terms, public.allowed_link_domains to service_role;

revoke execute on function public.check_text(text) from public, anon;
grant execute on function public.check_text(text) to authenticated, service_role;
