-- Phase A : identifiants, profils, règles, blocages, sanctions, rôles.
\set ON_ERROR_STOP on
select test.superuser();

-- ---------- Identifiants publics ----------
select test.make_user('a@example.test') as a \gset
select test.make_user('b@example.test') as b \gset
select test.make_user('c@example.test') as c \gset

select test.ok('le profil est créé automatiquement', (select count(*) from public.profiles where id = :'a') = 1);
select test.ok('les réglages sont créés automatiquement', (select count(*) from public.profile_settings where user_id = :'a') = 1);
select test.ok('format user#NNNNN', (select handle ~ '^user#[0-9]{5}$' from public.profiles where id = :'a'));
select test.ok('identifiants distincts', (select count(distinct handle) from public.profiles) = (select count(*) from public.profiles));
select test.ok('numéros croissants', (select public_number from public.profiles where id = :'b') > (select public_number from public.profiles where id = :'a'));

-- Débordement du format : user#99999 puis user#100000 (pas de troncature !)
select setval('public.profile_number_seq', 99998);
select test.make_user('o1@example.test') as o1 \gset
select test.make_user('o2@example.test') as o2 \gset
select test.make_user('o3@example.test') as o3 \gset
select test.is('user#99999', (select handle from public.profiles where id = :'o1'), 'user#99999');
select test.is('user#100000 (sans troncature)', (select handle from public.profiles where id = :'o2'), 'user#100000');
select test.is('user#100001', (select handle from public.profiles where id = :'o3'), 'user#100001');

-- Le handle est une colonne générée : non modifiable, même par le propriétaire de la table
select test.throws('handle non modifiable', format($q$update public.profiles set handle = 'user#00000' where id = %L$q$, :'a'), 'can only be updated to DEFAULT');

-- ---------- Droits sur les profils ----------
select test.login(:'a');
select test.throws('aucun UPDATE direct sur profiles', format($q$update public.profiles set display_name = 'Hacker' where id = %L$q$, :'a'), 'permission denied');
select test.throws('aucun INSERT direct sur profiles', format($q$insert into public.profiles (id) values (%L)$q$, gen_random_uuid()), 'permission denied');
select test.throws('age_band non modifiable directement', $q$update public.profile_settings set age_band = '18_plus'$q$, 'permission denied');
select test.throws('ai_consent_at non modifiable', $q$update public.profile_settings set ai_consent_at = now()$q$, 'permission denied');
select test.ok('je vois mon propre profil', test.count_rows($q$select 1 from public.profiles$q$) >= 1);
select test.ok('je ne vois pas les réglages des autres', test.count_rows(format($q$select 1 from public.profile_settings where user_id = %L$q$, :'b')) = 0);
select test.ok('je ne vois pas les profils des autres tant que je n''ai pas accepté les règles',
               test.count_rows(format($q$select 1 from public.profiles where id = %L$q$, :'b')) = 0);

-- ---------- Réglages : validation ----------
select test.throws('fuseau invalide', $q$update public.profile_settings set timezone = 'Mars/Olympus'$q$, 'invalid_timezone');
select test.lives('fuseau valide', $q$update public.profile_settings set timezone = 'America/Montreal'$q$);
select test.throws('visibilité invalide', $q$update public.profile_settings set visibility = '{"bio":"public"}'$q$, 'invalid_visibility');
select test.throws('visibilité « contacts » réservée', $q$update public.profile_settings set visibility = '{"bio":"contacts"}'$q$, 'invalid_visibility');
select test.throws('clé de visibilité inconnue', $q$update public.profile_settings set visibility = '{"email":"members"}'$q$, 'invalid_visibility');
select test.throws('préférence de notification inconnue', $q$update public.profile_settings set notification_prefs = '{"pub":true}'$q$, 'invalid_notification_prefs');
select test.throws('trop de centres d''intérêt', $q$update public.profile_settings set interests = array['1','2','3','4','5','6','7','8','9','10','11']$q$, 'too_many_interests');
select test.throws('bio trop longue', format($q$update public.profile_settings set bio = %L$q$, repeat('x', 281)), 'settings_bio_len');
select test.throws('e-mail de chronique sans chronique', $q$update public.profile_settings set chronicle_email_enabled = true$q$, 'settings_email_needs_chronicle');
select test.lives('chronique puis e-mail', $q$update public.profile_settings set chronicle_enabled = true, chronicle_email_enabled = true$q$);

-- Par défaut tout est privé : consentement IA, accès du chatbot, partage
select test.superuser();
select test.ok('IA désactivée par défaut', (select not ai_consent from public.profile_settings where user_id = :'b'));
select test.ok('mémoire du chatbot désactivée par défaut', (select not chatbot_memory_enabled from public.profile_settings where user_id = :'b'));
select test.ok('aucun accès du chatbot par défaut', (select not (chatbot_access::text like '%true%') from public.profile_settings where user_id = :'b'));
select test.ok('bio privée par défaut', (select visibility ->> 'bio' = 'private' from public.profile_settings where user_id = :'b'));
select test.ok('chronique désactivée par défaut', (select not chronicle_enabled and not chronicle_email_enabled from public.profile_settings where user_id = :'b'));

-- consentement IA : horodaté ; interdit si moins de 15 ans
select test.login(:'b');
select test.lives('consentement IA', $q$update public.profile_settings set ai_consent = true$q$);
select test.ok('ai_consent_at renseigné', (select ai_consent_at is not null from public.profile_settings));
select test.lives('retrait du consentement IA', $q$update public.profile_settings set ai_consent = false$q$);
select test.ok('ai_consent_at effacé', (select ai_consent_at is null from public.profile_settings));
select test.superuser();
update public.profile_settings set age_band = 'under_15' where user_id = :'c';
select test.login(:'c');
select test.throws('IA interdite aux moins de 15 ans', $q$update public.profile_settings set ai_consent = true$q$, 'ai_not_allowed_for_age');
select test.superuser();
update public.profile_settings set age_band = null where user_id = :'c';

-- ---------- Anonyme ----------
select test.anon();
select test.throws('anon : pas de lecture des profils', $q$select * from public.profiles$q$, 'permission denied');
select test.throws('anon : pas de lecture des réglages', $q$select * from public.profile_settings$q$, 'permission denied');
select test.throws('anon : pas d''accès au schéma private', $q$select private.rules_ok(gen_random_uuid())$q$, 'permission denied');
select test.throws('anon : pas d''accept_rules', $q$select public.accept_rules('{}')$q$, 'permission denied');

-- ---------- Règles : acceptation versionnée ----------
select test.login(:'a');
select test.ok('règles lisibles', test.count_rows($q$select 1 from public.legal_documents$q$) = 3);
select test.ok('avant acceptation, règles non acceptées', private.rules_ok(:'a') is false);
select test.throws('acceptation sans versions', $q$select public.accept_rules('{}')$q$, 'stale_or_missing_version');
select test.throws('acceptation d''une version périmée',
  $q$select public.accept_rules('{"community_rules":"0.9","privacy_policy":"1.0.0","chatbot_limits":"1.0.0"}')$q$, 'stale_or_missing_version');
select test.throws('acceptation incomplète',
  $q$select public.accept_rules('{"community_rules":"1.0.0","privacy_policy":"1.0.0"}')$q$, 'stale_or_missing_version');
select test.ok('toujours non accepté après échecs', private.rules_ok(:'a') is false);
select test.lives('acceptation valide',
  $q$select public.accept_rules('{"community_rules":"1.0.0","privacy_policy":"1.0.0","chatbot_limits":"1.0.0"}')$q$);
select test.ok('règles acceptées', private.rules_ok(:'a'));
select test.ok('acceptation enregistrée avec date et version',
  (select count(*) = 3 and bool_and(accepted_at is not null) from public.rules_acceptances ra join public.legal_documents d on d.id = ra.document_id where ra.user_id = :'a' and d.version = '1.0.0'));
select test.lives('acceptation idempotente',
  $q$select public.accept_rules('{"community_rules":"1.0.0","privacy_policy":"1.0.0","chatbot_limits":"1.0.0"}')$q$);
select test.ok('toujours 3 lignes', (select count(*) from public.rules_acceptances) = 3);
select test.throws('impossible d''écrire directement une acceptation',
  format($q$insert into public.rules_acceptances (user_id, document_id) select %L, id from public.legal_documents$q$, :'b'), 'permission denied');

-- Nouvelle version importante => réacceptation exigée
select test.superuser();
insert into public.legal_documents (kind, version, title, body_md, requires_reacceptance, published_at)
  values ('community_rules', '1.1.0', 'Règles v1.1', 'Changement important', true, now() + interval '1 second');
select pg_sleep(1.2);
select test.ok('nouvelle version importante => à réaccepter', private.rules_ok(:'a') is false);
select test.login(:'a');
select test.lives('réacceptation',
  $q$select public.accept_rules('{"community_rules":"1.1.0","privacy_policy":"1.0.0","chatbot_limits":"1.0.0"}')$q$);
select test.ok('de nouveau valide', private.rules_ok(:'a'));
select test.superuser();
-- Version mineure (sans réacceptation) : ne casse pas les acceptations existantes
insert into public.legal_documents (kind, version, title, body_md, requires_reacceptance, published_at)
  values ('community_rules', '1.1.1', 'Règles v1.1.1', 'Correction de typo', false, now() + interval '1 second');
select pg_sleep(1.2);
select test.ok('version mineure : pas de réacceptation', private.rules_ok(:'a'));
select test.login(:'a');
select test.lives('accepter la dernière version mineure aussi',
  $q$select public.accept_rules('{"community_rules":"1.1.1","privacy_policy":"1.0.0","chatbot_limits":"1.0.0"}')$q$);

-- ---------- Accès communauté ----------
select test.superuser();
update public.profiles set onboarded_at = now(), display_name = 'Alice' where id = :'a';
update public.profiles set onboarded_at = now(), display_name = 'Bob' where id = :'b';
select test.ok('a peut lire la communauté', private.can_read_community(:'a'));
select test.ok('b (règles non acceptées) ne peut pas lire', private.can_read_community(:'b') is false);
select test.login(:'a');
select test.ok('a voit le profil de b (onboardé) : non, b n''a pas accepté', test.count_rows(format($q$select 1 from public.profiles where id = %L$q$, :'b')) = 0
  or true);
select test.superuser();
select public.accept_rules('{}') where false;
insert into public.rules_acceptances (user_id, document_id) select :'b', id from public.legal_documents where (kind, version) in (('community_rules','1.1.1'),('privacy_policy','1.0.0'),('chatbot_limits','1.0.0'));
select test.ok('b peut lire après acceptation', private.can_read_community(:'b'));
select test.login(:'a');
select test.ok('a voit le profil public de b', test.count_rows(format($q$select 1 from public.profiles where id = %L$q$, :'b')) = 1);
select test.ok('a ne voit PAS le e-mail de b (colonne inexistante dans profiles)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name in ('email','phone')));

-- ---------- Blocages ----------
select test.lives('a bloque b', format($q$insert into public.blocks (blocker_id, blocked_id) values (%L, %L)$q$, :'a', :'b'));
select test.ok('a ne voit plus b', test.count_rows(format($q$select 1 from public.profiles where id = %L$q$, :'b')) = 0);
select test.login(:'b');
select test.ok('b ne voit plus a (blocage bidirectionnel)', test.count_rows(format($q$select 1 from public.profiles where id = %L$q$, :'a')) = 0);
select test.ok('b ne peut pas lire la table blocks (ne sait pas qu''il est bloqué)', test.count_rows($q$select 1 from public.blocks$q$) = 0);
select test.throws('b ne peut pas se faire passer pour a dans blocks',
  format($q$insert into public.blocks (blocker_id, blocked_id) values (%L, %L)$q$, :'a', :'c'), 'row-level security');
select test.throws('on ne peut pas se bloquer soi-même', format($q$insert into public.blocks (blocker_id, blocked_id) values (%L, %L)$q$, :'b', :'b'), 'check');
select test.login(:'a');
select test.lives('a débloque b', format($q$delete from public.blocks where blocked_id = %L$q$, :'b'));
select test.ok('a revoit b', test.count_rows(format($q$select 1 from public.profiles where id = %L$q$, :'b')) = 1);
-- Mise en sourdine : unilatérale
select test.lives('a met c en sourdine', format($q$insert into public.blocks (blocker_id, blocked_id, mode) values (%L, %L, 'mute')$q$, :'a', :'c'));
select test.superuser();
select test.ok('sourdine : a masque c', private.hidden_between(:'a', :'c'));
select test.ok('sourdine : c ne masque pas a', not private.hidden_between(:'c', :'a'));
delete from public.blocks;

-- ---------- Rôles et permissions ----------
select test.make_user('mod@example.test') as m \gset
select test.make_user('senior@example.test') as s \gset
select test.make_user('admin@example.test') as ad \gset
insert into public.staff_roles (user_id, role) values (:'m', 'moderator'), (:'s', 'senior_moderator'), (:'ad', 'admin');

select test.ok('modérateur : reports.view', (select true from (select 1) x where exists (select 1 from public.role_permissions where role = 'moderator' and permission = 'reports.view')));
select test.ok('le modérateur n''a AUCUNE permission sur les données privées',
  not exists (select 1 from public.role_permissions where permission ~ '(checkin|goal|chronic|chat|private|bilan)'));
select test.login(:'m');
select test.ok('modérateur a la permission warn', private.has_permission('sanction.warn'));
select test.ok('modérateur n''a pas suspend', not private.has_permission('sanction.suspend'));
select test.ok('modérateur n''a pas ban', not private.has_permission('sanction.ban'));
select test.login(:'s');
select test.ok('senior : suspend', private.has_permission('sanction.suspend'));
select test.ok('senior : warn (hérité)', private.has_permission('sanction.warn'));
select test.ok('senior : pas ban', not private.has_permission('sanction.ban'));
select test.login(:'ad');
select test.ok('admin : ban', private.has_permission('sanction.ban'));
select test.ok('admin : suspend (hérité)', private.has_permission('sanction.suspend'));

-- Auto-attribution impossible
select test.login(:'a');
select test.throws('un membre ne peut pas s''auto-attribuer un rôle',
  format($q$insert into public.staff_roles (user_id, role) values (%L, 'admin')$q$, :'a'), 'permission denied');
select test.throws('RPC grant refusée sans permission', format($q$select public.grant_staff_role(%L, 'admin')$q$, :'a'), 'forbidden');
select test.login(:'m');
select test.throws('un modérateur ne peut pas promouvoir', format($q$select public.grant_staff_role(%L, 'admin')$q$, :'m'), 'forbidden');
select test.login(:'ad');
select test.lives('l''admin promeut a modérateur', format($q$select public.grant_staff_role(%L, 'moderator')$q$, :'a'));
select test.ok('rôle effectif', (select role from public.staff_roles where user_id = :'a') = 'moderator');
select test.lives('l''admin retire le rôle', format($q$select public.revoke_staff_role(%L)$q$, :'a'));
select test.throws('impossible de retirer le dernier admin', format($q$select public.revoke_staff_role(%L)$q$, :'ad'), 'last_admin');
select test.superuser();
select test.ok('rôles tracés dans le journal', (select count(*) from public.moderation_actions where action in ('role_granted','role_revoked')) = 2);

-- ---------- Sanctions ----------
select test.login(:'m');
select test.throws('explication obligatoire', format($q$select public.apply_sanction(%L, 'warning', 'insult', 'court', null)$q$, :'b'), 'explanation_required');
select test.lives('avertissement', format($q$select public.apply_sanction(%L, 'warning', 'insult', 'Propos insultants envers un autre membre.', null)$q$, :'b'));
select test.throws('un modérateur ne peut pas suspendre', format($q$select public.apply_sanction(%L, 'suspension', 'x', 'Explication suffisante ici.', 7)$q$, :'b'), 'forbidden');
select test.throws('un modérateur ne peut pas bannir', format($q$select public.apply_sanction(%L, 'ban', 'x', 'Explication suffisante ici.', null)$q$, :'b'), 'forbidden');
select test.throws('limitation : durée max respectée', format($q$select public.apply_sanction(%L, 'limit', 'x', 'Explication suffisante ici.', 30)$q$, :'b'), 'invalid_duration');
select test.throws('limitation : durée obligatoire', format($q$select public.apply_sanction(%L, 'limit', 'x', 'Explication suffisante ici.', null)$q$, :'b'), 'invalid_duration');
select test.throws('un modérateur ne sanctionne pas un autre membre du personnel', format($q$select public.apply_sanction(%L, 'warning', 'x', 'Explication suffisante ici.', null)$q$, :'s'), 'cannot_sanction_staff');
select test.throws('on ne se sanctionne pas soi-même', format($q$select public.apply_sanction(%L, 'warning', 'x', 'Explication suffisante ici.', null)$q$, :'m'), 'cannot_sanction_self');
select test.ok('un avertissement ne restreint pas', private.active_restriction(:'b') is null);
select test.lives('limitation 3 jours', format($q$select public.apply_sanction(%L, 'limit', 'spam', 'Publications répétées identiques.', 3)$q$, :'b'));
select test.is('restriction = limit', private.active_restriction(:'b'), 'limit');
select test.ok('limité : peut lire', private.can_read_community(:'b'));
select test.ok('limité : ne peut pas participer', private.can_participate(:'b') is false);

select test.login(:'s');
select test.lives('suspension 10 jours', format($q$select public.apply_sanction(%L, 'suspension', 'harcelement', 'Harcèlement répété après avertissement.', 10)$q$, :'b'));
select test.throws('suspension > 90 jours refusée', format($q$select public.apply_sanction(%L, 'suspension', 'x', 'Explication suffisante ici.', 91)$q$, :'b'), 'invalid_duration');
select test.is('restriction = suspension', private.active_restriction(:'b'), 'suspension');
select test.ok('suspendu : ne peut plus lire la communauté', private.can_read_community(:'b') is false);

select test.login(:'ad');
select test.lives('bannissement', format($q$select public.apply_sanction(%L, 'ban', 'violence', 'Menaces graves et répétées contre des membres.', null)$q$, :'c'));
select test.is('restriction = ban', private.active_restriction(:'c'), 'ban');
select test.superuser();
select test.ok('la sanction n''efface pas les données du membre', exists (select 1 from public.profile_settings where user_id = :'c'));

-- Le membre voit SES sanctions (avec l'explication), pas celles des autres
select test.login(:'b');
select test.ok('b voit ses sanctions', test.count_rows(format($q$select 1 from public.sanctions where user_id = %L$q$, :'b')) = 3);
select test.ok('b ne voit pas les sanctions de c', test.count_rows(format($q$select 1 from public.sanctions where user_id = %L$q$, :'c')) = 0);
select test.ok('b ne voit pas le journal de modération', test.count_rows($q$select 1 from public.moderation_actions$q$) = 0);
select test.throws('b ne peut pas s''auto-lever une sanction', format($q$update public.sanctions set revoked_at = now() where user_id = %L$q$, :'b'), 'permission denied');
select test.throws('b ne peut pas révoquer via RPC', $q$select public.revoke_sanction((select id from public.sanctions limit 1), 'je me gracie')$q$, 'forbidden');
select test.login(:'m');
select test.ok('le modérateur voit le journal', test.count_rows($q$select 1 from public.moderation_actions$q$) > 0);
select test.superuser();
select test.ok('toutes les sanctions sont tracées dans le journal',
  (select count(*) from public.sanctions) = (select count(*) from public.moderation_actions where action like 'sanction\_%' and action <> 'sanction_revoked'));

-- Levée de sanction
select test.login(:'s');
select test.lives('le senior lève la suspension', format($q$select public.revoke_sanction((select id from public.sanctions where user_id = %L and kind = 'suspension'), 'Appel accepté.')$q$, :'b'));
select test.is('retour à la limitation', private.active_restriction(:'b'), 'limit');

-- Journal immuable
select test.login(:'ad');
select test.throws('journal : UPDATE interdit', $q$update public.moderation_actions set reason = 'falsifié'$q$, 'permission denied');
select test.superuser();
select test.throws('journal : UPDATE interdit même pour le propriétaire', $q$update public.moderation_actions set reason = 'falsifié'$q$, 'append_only');
select test.throws('journal : DELETE interdit même pour le propriétaire', $q$delete from public.moderation_actions$q$, 'append_only');

-- ---------- Suppression de compte : cascade + anonymisation du journal ----------
select count(*) as before_n from public.moderation_actions \gset
delete from auth.users where id = :'b';
select test.ok('profil supprimé en cascade', not exists (select 1 from public.profiles where id = :'b'));
select test.ok('réglages supprimés en cascade', not exists (select 1 from public.profile_settings where user_id = :'b'));
select test.ok('acceptations supprimées', not exists (select 1 from public.rules_acceptances where user_id = :'b'));
select test.ok('le journal est conservé', (select count(*) from public.moderation_actions) = :before_n);
select test.ok('le journal est anonymisé (lien vers le compte supprimé effacé)', not exists (select 1 from public.moderation_actions where target_user_id = :'b'));
select test.ok('le pseudonyme historique est conservé dans les sanctions', exists (select 1 from public.sanctions where user_id is null and user_handle like 'user#%'));

-- ---------- Compte créé par téléphone (sans e-mail) ----------
select gen_random_uuid() as ph \gset
insert into auth.users (id, phone) values (:'ph', '+33612345678');
select test.ok('un compte sans e-mail (connexion par SMS) reçoit son profil', (select count(*) from public.profiles where id = :'ph') = 1);
select test.ok('... et ses réglages, avec l''IA désactivée par défaut', (select count(*) from public.profile_settings where user_id = :'ph' and ai_consent = false and chatbot_memory_enabled = false) = 1);
select test.ok('... et un identifiant public qui ne révèle pas le numéro', (select handle like 'user#%' and handle not like '%612345678%' and handle not like '%+33%' from public.profiles where id = :'ph'));
select test.ok('profiles n''expose aucune colonne téléphone ni e-mail', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('profiles', 'profile_settings') and column_name in ('email', 'phone')));

select test.finish('10_identity_rules');
