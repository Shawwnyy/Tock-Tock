-- Modération automatique du texte, pseudonymes, onboarding.
\set ON_ERROR_STOP on
select test.superuser();

create or replace function test.decision(p text, p_uid uuid default null) returns text language sql as
$$ select private.text_flags(p, p_uid) ->> 'decision' $$;

-- ---------- Contenus légitimes : jamais bloqués ----------
select test.is('message positif', test.decision('Bonjour, j''ai réussi à réviser 30 minutes aujourd''hui, merci pour vos encouragements !'), 'allow');
select test.is('« mort de rire »', test.decision('Je suis mort de rire, cette vidéo est géniale'), 'allow');
select test.is('désaccord respectueux', test.decision('Je ne suis pas d''accord avec toi : je trouve ton argument faible, mais merci d''avoir partagé.'), 'allow');
select test.is('sujet difficile en demande d''aide', test.decision('Le harcèlement scolaire m''a beaucoup touché, auriez-vous des conseils pour en parler ?'), 'allow');
select test.is('date et heure ne sont pas un téléphone', test.decision('Rendez-vous le 2026-10-16 17:47 pour la séance'), 'allow');
select test.is('texte vide', test.decision(''), 'allow');
select test.is('mot « classe » / « scunthorpe » ne déclenche pas', test.decision('Une classe passionnante sur le Sussex et Essex'), 'allow');

-- ---------- Blocages nets ----------
select test.is('insulte', test.decision('t''es qu''un connard'), 'block');
select test.is('insulte avec leet', test.decision('quel c0nn4rd'), 'block');
select test.is('insulte avec lettres répétées', test.decision('quel connnnnard'), 'block');
select test.is('insulte avec accents / casse', test.decision('SALOPE'), 'block');
select test.is('« ta gueule »', test.decision('ferme ta gueule'), 'block');
select test.is('menace', test.decision('Je vais te retrouver'), 'block');
select test.is('menace de mort', test.decision('on va te tuer'), 'block');
select test.is('incitation à l''autodestruction', test.decision('tue-toi'), 'block');
select test.is('discrimination', test.decision('sale arabe'), 'block');
select test.is('sollicitation sexuelle', test.decision('envoie-moi des photos de toi'), 'block');
select test.is('troubles alimentaires (pro-ana)', test.decision('rejoins notre groupe pro-ana'), 'block');
select test.is('raccourcisseur de lien', test.decision('regarde ça https://bit.ly/abc123'), 'block');

-- ---------- Mise en attente (doute) ----------
select test.is('lien externe inconnu', test.decision('voir https://offres-incroyables.xyz/promo'), 'hold');
select test.is('domaine nu inconnu', test.decision('visite ma-boutique.com pour des cadeaux'), 'hold');
select test.is('lien autorisé (wikipedia)', test.decision('plus d''infos : https://fr.wikipedia.org/wiki/Sommeil'), 'allow');
select test.is('lien autorisé (service-public.fr)', test.decision('voir www.service-public.fr/particuliers'), 'allow');
select test.is('téléphone', test.decision('appelle-moi au 06 12 34 56 78'), 'hold');
select test.is('téléphone +33', test.decision('mon numéro : +33 6 12 34 56 78'), 'hold');
select test.is('e-mail', test.decision('écris-moi à jean.dupont@exemple.fr'), 'hold');
select test.is('demande de coordonnées', test.decision('donne-moi ton snap'), 'hold');
select test.is('arnaque', test.decision('gagnez 500 euros en une heure'), 'hold');
select test.is('contenu choquant : examen humain', test.decision('vidéo gore de torture'), 'hold');

-- ---------- Détresse : aucune suppression, mais aide proposée ----------
select test.is('détresse : pas de blocage', test.decision('j''ai envie de mourir'), 'allow');
select test.ok('détresse : aide proposée', (private.text_flags('j''ai envie de mourir') ->> 'needs_support')::boolean);
select test.ok('détresse : « en finir »', (private.text_flags('je veux en finir') ->> 'needs_support')::boolean);
select test.ok('pas de fausse alerte sur un texte neutre', not (private.text_flags('belle journée') ->> 'needs_support')::boolean);

-- ---------- Mineurs : durcissement ----------
select test.make_user('minor-text@example.test') as mn \gset
select test.make_user('adult-text@example.test') as ad \gset
update public.profile_settings set age_band = '15_17' where user_id = :'mn';
update public.profile_settings set age_band = '18_plus' where user_id = :'ad';
select test.is('téléphone : adulte => hold', test.decision('06 12 34 56 78', :'ad'), 'hold');
select test.is('téléphone : mineur => block', test.decision('06 12 34 56 78', :'mn'), 'block');
select test.is('e-mail : mineur => block', test.decision('moi@exemple.fr', :'mn'), 'block');
select test.is('demande de coordonnées : mineur => block', test.decision('donne-moi ton snap', :'mn'), 'block');
select test.is('texte inoffensif : mineur => allow', test.decision('bravo pour ta petite victoire', :'mn'), 'allow');

-- ---------- Accès à la liste de termes ----------
select test.make_user('plain@example.test') as pl \gset
select test.login(:'pl');
select test.ok('les membres ne voient aucun motif de filtrage', test.count_rows($q$select 1 from public.moderation_terms$q$) = 0);
select test.throws('les membres n''ajoutent pas de motif', $q$insert into public.moderation_terms (pattern, severity, category) values ('x', 'block', 'x')$q$, 'row-level security');
select test.ok('check_text accessible aux membres', (public.check_text('salut') ->> 'decision') = 'allow');
select test.anon();
select test.throws('check_text refusé à anon', $q$select public.check_text('salut')$q$, 'permission denied');

select test.superuser();
select test.staff('admin-text@example.test', 'Camille', 'admin') as adm \gset
select test.login(:'adm');
select test.lives('l''admin ajoute un motif', $q$insert into public.moderation_terms (pattern, severity, category, note) values ('\mzorglub\M', 'hold', 'test', 'test')$q$);
select test.is('nouveau motif actif', test.decision('un zorglub'), 'hold');
select test.superuser();
delete from public.moderation_terms where category = 'test';

-- ---------- Pseudonymes ----------
select test.is('pseudonyme valide', private.validate_display_name('Alice', null), 'Alice');
select test.is('espaces normalisés', private.validate_display_name('  Jean   Paul ', null), 'Jean Paul');
select test.is('accents et apostrophes OK', private.validate_display_name('Zoé d''Arc', null), 'Zoé d''Arc');
select test.throws('trop court', $q$select private.validate_display_name('x', null)$q$, 'invalid_display_name');
select test.throws('trop long', format($q$select private.validate_display_name(%L, null)$q$, repeat('a', 31)), 'invalid_display_name');
select test.throws('# interdit (imitation d''identifiant)', $q$select private.validate_display_name('user#00001', null)$q$, 'invalid_display_name');
select test.throws('@ interdit', $q$select private.validate_display_name('a@b', null)$q$, 'invalid_display_name');
select test.throws('« Admin » réservé', $q$select private.validate_display_name('Admin', null)$q$, 'reserved_display_name');
select test.throws('leet « M0d3rat3ur » réservé', $q$select private.validate_display_name('M0d3rat3ur', null)$q$, 'reserved_display_name');
select test.throws('« Tock Tock Support » réservé', $q$select private.validate_display_name('Tock Tock Support', null)$q$, 'reserved_display_name');
select test.throws('« user12345 » réservé', $q$select private.validate_display_name('user12345', null)$q$, 'reserved_display_name');
select test.throws('insulte en pseudonyme', $q$select private.validate_display_name('connard', null)$q$, 'display_name_rejected');

-- ---------- Onboarding ----------
select test.make_user('onb@example.test') as o \gset
select test.login(:'o');
select test.throws('onboarding refusé avant les règles', $q$select public.complete_onboarding('Olivia', '18_plus')$q$, 'rules_not_accepted');
select test.superuser();
insert into public.rules_acceptances (user_id, document_id)
  select :'o', d.id from public.legal_documents d
  where d.published_at = (select max(x.published_at) from public.legal_documents x where x.kind = d.kind);
select test.login(:'o');
select test.throws('âge invalide', $q$select public.complete_onboarding('Olivia', 'adult')$q$, 'invalid_age_band');
select test.throws('pseudonyme réservé', $q$select public.complete_onboarding('Moderateur', '18_plus')$q$, 'reserved_display_name');
select test.ok('toujours pas onboardé après échecs', (select onboarded_at is null from public.profiles where id = :'o'));
select test.ok('onboarding réussi', (public.complete_onboarding('Olivia', '15_17', 'Europe/Paris') ->> 'handle') ~ '^user#[0-9]{5,}$');
select test.ok('profil terminé', (select onboarded_at is not null and display_name = 'Olivia' from public.profiles where id = :'o'));
select test.is('âge déclaré enregistré', (select age_band from public.profile_settings), '15_17');
select test.is('fuseau enregistré', (select timezone from public.profile_settings), 'Europe/Paris');
select test.throws('onboarding en double refusé', $q$select public.complete_onboarding('Autre', '18_plus')$q$, 'already_onboarded');
select test.is('20 indicateurs par défaut', (select count(*)::int from public.indicators), 20);
select test.is('5 catégories par défaut', (select count(*)::int from public.indicator_categories), 5);
select test.ok('la douleur n''est PAS un indicateur de la moyenne (colonnes dédiées sur le bilan)', not exists (select 1 from public.indicators where template_key ilike '%pain%' or name ilike 'douleur%'));
select test.throws('changement de pseudonyme limité (24 h)', $q$select public.set_display_name('Olive')$q$, 'display_name_rate_limited');
select test.superuser();
update public.profiles set display_name_changed_at = now() - interval '2 days' where id = :'o';
select test.login(:'o');
select test.is('changement de pseudonyme après 24 h', public.set_display_name('Olive'), 'Olive');
select test.lives('avatar prédéfini', $q$select public.set_avatar_preset('leaf')$q$);
select test.throws('avatar inconnu', $q$select public.set_avatar_preset('http://evil')$q$, 'profiles_avatar_preset_chk');
-- Deux membres peuvent avoir le même pseudonyme : l'identifiant user#N les distingue.
select test.superuser();
select test.member('olive2@example.test', 'Olive') as o2 \gset
select test.ok('pseudonyme identique possible, identifiants différents',
  (select count(distinct handle) = 2 from public.profiles where display_name = 'Olive'));

select test.finish('20_text_moderation_onboarding');
