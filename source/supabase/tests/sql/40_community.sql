-- Phase C : communauté, signalements, modération humaine, appels, blocages, sanctions.
\set ON_ERROR_STOP on
select test.superuser();

select test.member('c-alice@example.test', 'Alice') as a \gset
select test.member('c-bob@example.test', 'Bob') as b \gset
select test.member('c-carol@example.test', 'Carol') as c \gset
select test.member('c-dan@example.test', 'Dan', '15_17') as minor \gset
select test.member('c-kid@example.test', 'Kid', 'under_15') as kid \gset
select test.make_user('c-norules@example.test') as norules \gset
select test.staff('c-mod@example.test', 'Marc', 'moderator') as m \gset
select test.staff('c-senior@example.test', 'Sonia', 'senior_moderator') as s \gset
select test.staff('c-admin@example.test', 'Alain', 'admin') as ad \gset
select id as cat from public.post_categories where slug = 'bien-etre' \gset
select id as cat2 from public.post_categories where slug = 'entraide' \gset

-- ---------- Accès ----------
select test.anon();
select test.throws('anon : pas de publications', $q$select * from public.posts$q$, 'permission denied');
select test.throws('anon : pas de commentaires', $q$select * from public.comments$q$, 'permission denied');
select test.throws('anon : pas de profils membres', $q$select * from public.member_profiles$q$, 'permission denied');

select test.login(:'norules');
select test.is('sans règles acceptées : aucune publication visible', test.count_rows($q$select 1 from public.posts$q$), 0);
select test.throws('sans règles acceptées : ne peut pas publier', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'bonjour')$q$, :'norules', :'cat'), 'row-level security');

select test.login(:'kid');
select test.throws('moins de 15 ans : pas de publication', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'bonjour')$q$, :'kid', :'cat'), 'row-level security');
select test.is('moins de 15 ans : communauté fermée', test.count_rows($q$select 1 from public.posts$q$), 0);

-- ---------- Publications ----------
select test.login(:'a');
select test.lives('publication valide', format($q$insert into public.posts (author_id, category_id, kind, title, body) values (%L, %L, 'tip', 'Ma routine du soir', 'Dix minutes de lecture avant de dormir m''aident beaucoup.')$q$, :'a', :'cat'));
select id as p1 from public.posts where author_id = :'a' limit 1 \gset
select test.is('publiée directement', (select status from public.posts where id = :'p1'), 'published');
select test.throws('le résultat du filtrage (moderation) n''est pas lisible par les membres : publications', $q$select moderation from public.posts$q$, 'permission denied');
select test.throws('idem : select * refusé (colonnes explicites obligatoires)', $q$select * from public.posts$q$, 'permission denied');
select test.throws('idem : commentaires', $q$select moderation from public.comments$q$, 'permission denied');
select test.lives('un membre ne peut pas non plus écrire dans moderation', format($q$update public.posts set title = title where id = %L$q$, :'p1'));
select test.throws('ni via UPDATE direct de moderation', format($q$update public.posts set moderation = '{}' where id = %L$q$, :'p1'), 'permission denied');
select test.throws('insulte refusée', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 't''es un connard')$q$, :'a', :'cat'), 'content_rejected');
select test.throws('menace refusée', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'je vais te retrouver')$q$, :'a', :'cat'), 'content_rejected');
select test.lives('lien inconnu => mise en attente (pas de refus)', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'Super site : https://offres-incroyables.xyz')$q$, :'a', :'cat'));
select test.is('lien inconnu => pending_review', (select status from public.posts where body like 'Super site%'), 'pending_review');
select test.lives('sujet difficile en demande d''aide : publié', format($q$insert into public.posts (author_id, category_id, kind, body) values (%L, %L, 'question', 'Le harcèlement scolaire m''épuise, comment en parler à mes parents ?')$q$, :'a', :'cat2'));
select test.is('demande d''aide jamais retenue', (select status from public.posts where body like 'Le harcèlement%'), 'published');
select test.throws('un membre ne peut pas publier au nom d''un autre', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'usurpation')$q$, :'b', :'cat'), 'row-level security');
select test.lives('un membre ne peut pas s''auto-approuver : status forcé', format($q$insert into public.posts (author_id, category_id, body, status) values (%L, %L, 'lien http://pirate.xyz', 'published')$q$, :'a', :'cat'));
select test.is('status « published » demandé ignoré si doute', (select status from public.posts where body like 'lien http://pirate%'), 'pending_review');
select test.lives('brouillon', format($q$insert into public.posts (author_id, category_id, body, status) values (%L, %L, 'brouillon privé', 'draft')$q$, :'a', :'cat'));
select id as pd from public.posts where body = 'brouillon privé' \gset
select test.is('brouillon enregistré', (select status from public.posts where id = :'pd'), 'draft');

-- Visibilité
select test.login(:'b');
select test.ok('b voit la publication publiée', test.count_rows(format($q$select 1 from public.posts where id = %L$q$, :'p1')) = 1);
select test.is('b ne voit ni les brouillons ni les posts en attente', test.count_rows(format($q$select 1 from public.posts where author_id = %L and status <> 'published'$q$, :'a')), 0);
select test.login(:'m');
select test.is('modérateur voit les posts en attente', test.count_rows($q$select 1 from public.posts where status = 'pending_review'$q$), 2);
select test.is('modérateur ne voit PAS les brouillons', test.count_rows($q$select 1 from public.posts where status = 'draft'$q$), 0);

-- Modification par l'auteur
select test.login(:'a');
select test.lives('édition propre', format($q$update public.posts set body = 'Dix minutes de lecture avant de dormir, ça aide vraiment.' where id = %L$q$, :'p1'));
select test.ok('édition datée', (select edited_at is not null from public.posts where id = :'p1'));
select test.is('toujours publié', (select status from public.posts where id = :'p1'), 'published');
select test.throws('édition vers une insulte refusée', format($q$update public.posts set body = 'quel connard' where id = %L$q$, :'p1'), 'content_rejected');
select test.lives('édition vers un lien => retour en attente', format($q$update public.posts set body = 'Voir https://inconnu-site.xyz' where id = %L$q$, :'p1'));
select test.is('republication contrôlée', (select status from public.posts where id = :'p1'), 'pending_review');
select test.lives('retour à un texte propre', format($q$update public.posts set body = 'Texte propre à nouveau.' where id = %L$q$, :'p1'));
select test.is('re-publié après texte propre (retenue due au texte seulement)', (select status from public.posts where id = :'p1'), 'published');
select test.lives('tentative de se mettre en « removed » / « hidden » (ignorée)', format($q$update public.posts set status = 'removed' where id = %L$q$, :'p1'));
select test.is('statut inchangé', (select status from public.posts where id = :'p1'), 'published');
select test.throws('le client ne peut pas écrire comment_count', format($q$update public.posts set comment_count = 999 where id = %L$q$, :'p1'), 'permission denied');
select test.throws('le client ne peut pas changer l''auteur', format($q$update public.posts set author_id = %L where id = %L$q$, :'b', :'p1'), 'permission denied');
select test.ok('compteur et auteur inchangés', (select comment_count = 0 and author_id = :'a' from public.posts where id = :'p1'));
select test.login(:'b');
select test.is('b ne peut pas modifier le post de a', test.affected(format($q$update public.posts set body = 'piraté' where id = %L$q$, :'p1')), 0);
select test.is('b ne peut pas supprimer le post de a', test.affected(format($q$delete from public.posts where id = %L$q$, :'p1')), 0);

-- ---------- Commentaires ----------
select test.lives('b commente', format($q$insert into public.comments (post_id, author_id, body) values (%L, %L, 'Merci pour ce conseil, je vais essayer !')$q$, :'p1', :'b'));
select id as k1 from public.comments where author_id = :'b' limit 1 \gset
select test.is('compteur de commentaires', (select comment_count from public.posts where id = :'p1'), 1);
select test.throws('commentaire insultant refusé', format($q$insert into public.comments (post_id, author_id, body) values (%L, %L, 'ferme ta gueule')$q$, :'p1', :'b'), 'content_rejected');
select test.lives('réponse à un commentaire', format($q$insert into public.comments (post_id, author_id, parent_id, body) values (%L, %L, %L, 'Avec plaisir !')$q$, :'p1', :'b', :'k1'));
select id as k2 from public.comments where parent_id = :'k1' \gset
select test.throws('pas de réponse à une réponse (1 niveau)', format($q$insert into public.comments (post_id, author_id, parent_id, body) values (%L, %L, %L, 'trop profond')$q$, :'p1', :'b', :'k2'), 'invalid_parent');
select test.throws('commentaire au nom d''un autre', format($q$insert into public.comments (post_id, author_id, body) values (%L, %L, 'faux')$q$, :'p1', :'c'), 'row-level security');
select test.throws('commentaire sur un post en attente', format($q$insert into public.comments (post_id, author_id, body) values (%L, %L, 'x')$q$, (select id from public.posts where body like 'Super site%'), :'b'), 'row-level security');
select test.login(:'c');
select test.is('c voit les commentaires', test.count_rows(format($q$select 1 from public.comments where post_id = %L$q$, :'p1')), 2);
select test.is('c ne peut pas modifier le commentaire de b', test.affected(format($q$update public.comments set body = 'piraté' where id = %L$q$, :'k1')), 0);

-- ---------- Réactions positives : compteurs, jamais d''identités ni de classement ----------
select test.login(:'b');
select test.lives('b réagit « bravo »', format($q$insert into public.reactions (user_id, post_id, kind) values (%L, %L, 'bravo')$q$, :'b', :'p1'));
select test.throws('même réaction deux fois', format($q$insert into public.reactions (user_id, post_id, kind) values (%L, %L, 'bravo')$q$, :'b', :'p1'), 'duplicate');
select test.throws('réaction négative inexistante', format($q$insert into public.reactions (user_id, post_id, kind) values (%L, %L, 'dislike')$q$, :'b', :'p1'), 'check');
select test.throws('réaction au nom d''un autre', format($q$insert into public.reactions (user_id, post_id, kind) values (%L, %L, 'support')$q$, :'c', :'p1'), 'row-level security');
select test.login(:'c');
select test.lives('c réagit « support »', format($q$insert into public.reactions (user_id, post_id, kind) values (%L, %L, 'support')$q$, :'c', :'p1'));
select test.is('c voit les totaux', (select sum(n)::int from public.reaction_totals where post_id = :'p1'), 2);
select test.is('c ne voit pas QUI a réagi', test.count_rows(format($q$select 1 from public.reactions where post_id = %L and user_id <> %L$q$, :'p1', :'c')), 0);
select test.lives('c retire sa réaction', format($q$delete from public.reactions where user_id = %L$q$, :'c'));
select test.is('total décrémenté', (select sum(n)::int from public.reaction_totals where post_id = :'p1'), 1);
select test.ok('aucune table de classement de membres', not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name ~ '(rank|leaderboard|score_board|popularity)'));

-- ---------- Favoris ----------
select test.login(:'b');
select test.lives('b enregistre le post', format($q$insert into public.saved_items (user_id, post_id) values (%L, %L)$q$, :'b', :'p1'));
select test.throws('favori en double', format($q$insert into public.saved_items (user_id, post_id) values (%L, %L)$q$, :'b', :'p1'), 'duplicate');
select test.throws('favori sur un post invisible (brouillon d''autrui)', format($q$insert into public.saved_items (user_id, post_id) values (%L, %L)$q$, :'b', :'pd'), 'row-level security');
select test.is('mes favoris', test.count_rows($q$select 1 from public.saved_items$q$), 1);
select test.login(:'c');
select test.is('c ne voit pas les favoris de b', test.count_rows($q$select 1 from public.saved_items$q$), 0);

-- ---------- Blocage ----------
select test.login(:'a');
select test.lives('a bloque b', format($q$insert into public.blocks (blocker_id, blocked_id) values (%L, %L)$q$, :'a', :'b'));
select test.login(:'b');
select test.is('b ne voit plus les posts de a', test.count_rows(format($q$select 1 from public.posts where author_id = %L$q$, :'a')), 0);
select test.throws('b ne peut plus commenter a', format($q$insert into public.comments (post_id, author_id, body) values (%L, %L, 'bonjour ?')$q$, :'p1', :'b'), 'row-level security');
select test.throws('b ne peut plus réagir à a', format($q$insert into public.reactions (user_id, post_id, kind) values (%L, %L, 'thanks')$q$, :'b', :'p1'), 'row-level security');
select test.login(:'a');
select test.is('a ne voit plus les commentaires de b', test.count_rows(format($q$select 1 from public.comments where author_id = %L$q$, :'b')), 0);
select test.lives('a débloque b', format($q$delete from public.blocks where blocker_id = %L$q$, :'a'));

-- ---------- Profils membres : visibilité choisie ----------
select test.login(:'a');
select test.lives('a renseigne sa bio', $q$update public.profile_settings set bio = 'Passionnée de lecture', interests = array['lecture','randonnée']$q$);
select test.login(:'b');
select test.ok('bio privée par défaut : invisible pour b', (select bio is null and interests is null from public.member_profiles where id = :'a'));
select test.login(:'a');
select test.lives('a rend sa bio visible aux membres', $q$update public.profile_settings set visibility = visibility || '{"bio":"members"}'$q$);
select test.login(:'b');
select test.ok('bio visible, centres d''intérêt toujours privés', (select bio = 'Passionnée de lecture' and interests is null from public.member_profiles where id = :'a'));
select test.is('la vue ne contient ni e-mail ni téléphone', (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'member_profiles' and column_name in ('email','phone','age_band','timezone')), 0);
select test.login(:'norules');
select test.is('sans règles ni profil terminé : aucun profil membre', test.count_rows($q$select 1 from public.member_profiles$q$), 0);
select test.login(:'b');
select test.is('recherche < 3 caractères : vide', test.count_rows($q$select 1 from public.search_members('Al')$q$), 0);
select test.ok('recherche par préfixe', test.count_rows($q$select 1 from public.search_members('Ali')$q$) >= 1);
select test.ok('la recherche ne renvoie que des champs publics', (select count(*) = 4 from information_schema.routines r join information_schema.parameters p on p.specific_name = r.specific_name where r.routine_schema = 'public' and r.routine_name = 'search_members' and p.parameter_mode = 'OUT'));
select test.login(:'c');
select test.lives('c partage un objectif sur son profil', format($q$insert into public.goals (user_id, title, share_on_profile) values (%L, 'Courir 5 km', true)$q$, :'c'));
select test.throws('objectif partagé insultant refusé', format($q$insert into public.goals (user_id, title, share_on_profile) values (%L, 'Écraser ces connards', true)$q$, :'c'), 'shared_goal_rejected');
select test.lives('un objectif privé peut avoir n''importe quel titre', format($q$insert into public.goals (user_id, title) values (%L, 'Ne plus penser à ce connard')$q$, :'c'));
select test.login(:'b');
select test.is('objectif partagé masqué tant que la visibilité reste privée', test.count_rows(format($q$select 1 from public.member_shared_goals where user_id = %L$q$, :'c')), 0);
select test.login(:'c');
select test.lives('c autorise l''affichage', $q$update public.profile_settings set visibility = visibility || '{"shared_goals":"members"}'$q$);
select test.login(:'b');
select test.is('objectif partagé visible (titre seul)', (select title from public.member_shared_goals where user_id = :'c'), 'Courir 5 km');
select test.is('objectif privé jamais exposé', test.count_rows($q$select 1 from public.member_shared_goals where title like '%connard%'$q$), 0);

-- ---------- Signalements ----------
select test.superuser();
update public.app_config set value = to_jsonb(2) where key = 'reports.auto_hold_threshold';
select test.login(:'b');
select test.lives('b signale le post de a (harcèlement)', format($q$insert into public.reports (reporter_id, target_type, target_id, reason, details) values (%L, 'post', %L, 'harassment', 'Ce message me gêne')$q$, :'b', :'p1'));
select id as r1 from public.reports where reporter_id = :'b' limit 1 \gset
select test.throws('signalement en double', format($q$insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, 'post', %L, 'other')$q$, :'b', :'p1'), 'duplicate');
select test.throws('signalement au nom d''un autre', format($q$insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, 'post', %L, 'other')$q$, :'c', :'p1'), 'row-level security');
select test.throws('motif inconnu', format($q$insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, 'post', %L, 'je_n_aime_pas')$q$, :'b', (select id from public.posts where body like 'Le harcèlement%')), 'check');
select test.throws('on ne se signale pas soi-même', format($q$insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, 'comment', %L, 'other')$q$, :'b', :'k1'), 'cannot_report_self');
select test.throws('cible inexistante / privée (brouillon)', format($q$insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, 'post', %L, 'other')$q$, :'b', :'pd'), 'unknown_target');
select test.throws('le signalant ne lit pas l''instantané du contenu', $q$select target_snapshot from public.reports$q$, 'permission denied');
select test.ok('le signalant voit l''état de son signalement', (select status = 'open' from public.reports where id = :'r1'));
select test.is('la priorité n''est pas fixée par le client', (select count(*)::int from information_schema.column_privileges where table_name = 'reports' and grantee = 'authenticated' and privilege_type = 'INSERT' and column_name = 'priority'), 0);
select test.login(:'a');
select test.is('la personne signalée ne voit AUCUN signalement la concernant', test.count_rows($q$select id from public.reports$q$), 0);
select test.is('ni la file de modération', test.count_rows($q$select 1 from public.staff_reports$q$), 0);
select test.login(:'c');
select test.lives('c signale aussi (2e personne distincte => seuil atteint)', format($q$insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, 'post', %L, 'other')$q$, :'c', :'p1'));
select test.superuser();
select test.is('mise en attente automatique du contenu', (select status from public.posts where id = :'p1'), 'pending_review');
select test.is('retenu à cause des signalements', (select moderation ->> 'held_by' from public.posts where id = :'p1'), 'reports');
select test.login(:'a');
select test.lives('a corrige son texte', format($q$update public.posts set body = 'Texte reformulé gentiment.' where id = %L$q$, :'p1'));
select test.is('mais ne peut pas rouvrir seul un contenu retenu par signalements', (select status from public.posts where id = :'p1'), 'pending_review');

-- File de modération
select test.login(:'m');
select test.ok('le modérateur voit la file', test.count_rows($q$select 1 from public.staff_reports$q$) = 2);
select test.is('priorité calculée', (select priority::int from public.staff_reports where reporter_handle = (select handle from public.profiles where id = :'b')), 2);
select test.ok('le modérateur voit le contenu signalé (instantané)', (select target_snapshot ->> 'body' is not null from public.staff_reports limit 1));
select test.is('nombre de signalements sur la cible', (select max(reports_on_target)::int from public.staff_reports), 2);
select test.lives('prise en charge', format($q$select public.act_on_report(%L, 'in_review')$q$, :'r1'));
select test.throws('escalade sans note refusée', format($q$select public.act_on_report(%L, 'escalated')$q$, :'r1'), 'note_required');
select test.lives('escalade avec note', format($q$select public.act_on_report(%L, 'escalated', null, 'À examiner par un senior : cas limite')$q$, :'r1'));
select test.throws('clôture sans décision refusée', format($q$select public.act_on_report(%L, 'closed')$q$, :'r1'), 'decision_required');
select test.login(:'b');
select test.throws('un membre ne peut pas traiter un signalement', format($q$select public.act_on_report(%L, 'closed', 'no_action')$q$, :'r1'), 'forbidden');
select test.throws('un membre ne peut pas masquer un contenu', format($q$select public.moderate_content('post', %L, 'hide', 'x', 'Explication suffisante')$q$, :'p1'), 'forbidden');

-- Masquage / restauration / suppression (hiérarchie des permissions)
select test.login(:'m');
select test.throws('masquage sans explication refusé', format($q$select public.moderate_content('post', %L, 'hide', 'harassment', 'court')$q$, :'p1'), 'explanation_required');
select test.lives('masquage temporaire', format($q$select public.moderate_content('post', %L, 'hide', 'harassment', 'Ce message ne respecte pas la règle sur le respect.', %L)$q$, :'p1', :'r1'));
select test.is('post masqué', (select status from public.posts where id = :'p1'), 'hidden');
select test.throws('un modérateur ne peut pas supprimer définitivement', format($q$select public.moderate_content('post', %L, 'remove', 'x', 'Explication suffisante ici')$q$, :'p1'), 'forbidden');
select test.superuser();
select test.ok('signalements clôturés automatiquement', (select count(*) = 2 and bool_and(status = 'closed') from public.reports where target_id = :'p1'));
select test.ok('décision principale + doublon', (select count(*) filter (where decision = 'content_hidden') = 1 and count(*) filter (where decision = 'duplicate') = 1 from public.reports where target_id = :'p1'));
select test.ok('action journalisée avec explication', (select count(*) = 1 from public.moderation_actions where action = 'content_hide' and target_id = :'p1' and explanation is not null));
select test.login(:'b');
select test.is('b ne voit plus le post masqué', test.count_rows(format($q$select 1 from public.posts where id = %L$q$, :'p1')), 0);
select test.login(:'c');
select test.is('et ses commentaires deviennent invisibles pour les tiers', test.count_rows(format($q$select 1 from public.comments where post_id = %L$q$, :'p1')), 0);
select test.login(:'a');
select test.is('l''auteur voit son post masqué', test.count_rows(format($q$select 1 from public.posts where id = %L$q$, :'p1')), 1);
select test.is('l''auteur ne peut pas modifier un contenu modéré', test.affected(format($q$update public.posts set body = 'contournement' where id = %L$q$, :'p1')), 0);

-- ---------- Appels ----------
select test.lives('a fait appel de la décision', format($q$insert into public.appeals (user_id, target_type, target_id, message) values (%L, 'post', %L, 'Je pense que ce message était bienveillant, pouvez-vous le réexaminer ?')$q$, :'a', :'p1'));
select id as ap from public.appeals where user_id = :'a' \gset
select test.throws('un seul appel ouvert par contenu', format($q$insert into public.appeals (user_id, target_type, target_id, message) values (%L, 'post', %L, 'Deuxième appel pour le même contenu')$q$, :'a', :'p1'), 'duplicate');
select test.login(:'b');
select test.throws('appel sur le contenu d''un autre', format($q$insert into public.appeals (user_id, target_type, target_id, message) values (%L, 'post', %L, 'Ce contenu n''est pas à moi du tout')$q$, :'b', :'p1'), 'not_your_content');
select test.throws('appel au nom d''un autre', format($q$insert into public.appeals (user_id, target_type, target_id, message) values (%L, 'post', %L, 'Ce contenu n''est pas à moi du tout')$q$, :'a', :'p1'), 'row-level security');
select test.is('b ne voit pas les appels des autres', test.count_rows($q$select 1 from public.appeals$q$), 0);
select test.login(:'m');
select test.throws('un modérateur simple ne juge pas les appels', format($q$select public.decide_appeal(%L, 'overturned', 'Décision réexaminée.')$q$, :'ap'), 'forbidden');
select test.login(:'s');
select test.lives('le senior (autre personne) examine : décision annulée', format($q$select public.decide_appeal(%L, 'overturned', 'Après relecture, le message respecte les règles.')$q$, :'ap'));
select test.superuser();
select test.is('contenu restauré', (select status from public.posts where id = :'p1'), 'published');
select test.is('appel clos', (select status from public.appeals where id = :'ap'), 'overturned');
select test.ok('décision d''appel journalisée', exists (select 1 from public.moderation_actions where action = 'appeal_overturned'));
-- conflit d'intérêts : celui qui a masqué ne juge pas l'appel
select test.login(:'s');
select test.lives('le senior masque un autre contenu', format($q$select public.moderate_content('comment', %L, 'hide', 'other', 'Commentaire hors sujet répété sur la page.')$q$, :'k1'));
select test.login(:'b');
select test.lives('b fait appel', format($q$insert into public.appeals (user_id, target_type, target_id, message) values (%L, 'comment', %L, 'Ce commentaire n''avait rien de mal, merci de relire.')$q$, :'b', :'k1'));
select id as ap2 from public.appeals where user_id = :'b' \gset
select test.login(:'s');
select test.throws('conflit d''intérêts : même personne', format($q$select public.decide_appeal(%L, 'upheld', 'Je confirme ma propre décision.')$q$, :'ap2'), 'conflict_of_interest');
select test.login(:'ad');
select test.lives('un autre responsable tranche : confirmée', format($q$select public.decide_appeal(%L, 'upheld', 'La décision de masquage est confirmée.')$q$, :'ap2'));
select test.superuser();
select test.is('commentaire reste masqué', (select status from public.comments where id = :'k1'), 'hidden');

-- ---------- Sanctions et accès communautaire ----------
select test.login(:'m');
select test.lives('limitation de c (2 jours)', format($q$select public.apply_sanction(%L, 'limit', 'spam', 'Publications répétées en peu de temps.', 2)$q$, :'c'));
select test.login(:'c');
select test.is('limité : peut toujours lire', test.count_rows(format($q$select 1 from public.posts where id = %L$q$, :'p1')), 1);
select test.throws('limité : ne peut pas publier', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'bonjour')$q$, :'c', :'cat'), 'row-level security');
select test.throws('limité : ne peut pas commenter', format($q$insert into public.comments (post_id, author_id, body) values (%L, %L, 'bonjour')$q$, :'p1', :'c'), 'row-level security');
select test.throws('limité : ne peut pas réagir', format($q$insert into public.reactions (user_id, post_id, kind) values (%L, %L, 'bravo')$q$, :'c', :'p1'), 'row-level security');
select test.lives('limité : peut toujours signaler (protection des membres)', format($q$insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, 'comment', %L, 'other')$q$, :'c', :'k2'));
select test.lives('limité : garde accès à son espace personnel', format($q$insert into public.checkins (user_id, checkin_date) values (%L, current_date)$q$, :'c'));
select test.login(:'s');
select test.lives('suspension de c', format($q$select public.apply_sanction(%L, 'suspension', 'harcelement', 'Harcèlement répété après limitation.', 7)$q$, :'c'));
select test.login(:'c');
select test.is('suspendu : communauté fermée', test.count_rows(format($q$select 1 from public.posts where id = %L$q$, :'p1')), 0);
select test.ok('suspendu : espace personnel intact', test.count_rows($q$select 1 from public.checkins$q$) = 1);
select test.ok('suspendu : voit sa sanction expliquée', test.count_rows($q$select 1 from public.sanctions where explanation is not null$q$) = 2);
select test.lives('suspendu : peut contester', format($q$insert into public.appeals (user_id, sanction_id, message) values (%L, (select id from public.sanctions where kind = 'suspension' and user_id = %L), 'Je souhaite contester cette suspension, voici mon explication.')$q$, :'c', :'c'));
select test.throws('contester la sanction d''un autre', format($q$insert into public.appeals (user_id, sanction_id, message) values (%L, (select id from public.sanctions where kind = 'limit' and user_id = %L limit 1), 'Je conteste la sanction de quelqu''un d''autre.')$q$, :'b', :'c'), 'not_your_sanction') ;

-- ---------- Mineurs ----------
select test.login(:'minor');
select test.throws('mineur : numéro de téléphone refusé (et non seulement retenu)', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'Mon numéro : 06 12 34 56 78')$q$, :'minor', :'cat'), 'content_rejected');
select test.throws('mineur : demande de coordonnées refusée', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'donne-moi ton snap')$q$, :'minor', :'cat'), 'content_rejected');
select test.lives('mineur : message normal publié', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'Petite victoire : j''ai terminé mon exposé !')$q$, :'minor', :'cat'));
select test.login(:'a');
select test.lives('adulte : numéro accepté en attente', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'Rappelez-moi au 06 12 34 56 78')$q$, :'a', :'cat'));
select test.is('adulte : mis en attente', (select status from public.posts where body like 'Rappelez-moi%'), 'pending_review');

-- ---------- Limites anti-abus ----------
select test.superuser();
update public.app_config set value = to_jsonb(2) where key = 'posts.max_per_day';
select test.login(:'b');
select test.lives('post 1/2', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'un')$q$, :'b', :'cat'));
select test.lives('post 2/2', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'deux')$q$, :'b', :'cat'));
select test.throws('post 3/2 : limite quotidienne', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'trois')$q$, :'b', :'cat'), 'rate_limited');
select test.superuser();
update public.app_config set value = to_jsonb(20) where key = 'posts.max_per_day';
update public.app_config set value = to_jsonb(3) where key = 'reports.auto_hold_threshold';

-- ---------- Désactivation de compte ----------
select test.login(:'a');
select test.lives('a désactive son compte', $q$select public.deactivate_account()$q$);
select test.login(:'b');
select test.is('les publications d''un compte désactivé disparaissent du fil', test.count_rows(format($q$select 1 from public.posts where author_id = %L$q$, :'a')), 0);
select test.login(:'a');
select test.lives('a réactive', $q$select public.reactivate_account()$q$);
select test.login(:'b');
select test.ok('elles reviennent', test.count_rows(format($q$select 1 from public.posts where author_id = %L$q$, :'a')) > 0);

-- ---------- Catégories et recherche ----------
select test.is('8 catégories', test.count_rows($q$select 1 from public.post_categories$q$), 8);
select test.throws('un membre ne modifie pas les catégories', $q$insert into public.post_categories (slug, label) values ('hack', 'Hack')$q$, 'row-level security');
select test.login(:'ad');
select test.lives('l''admin ajoute une catégorie', $q$insert into public.post_categories (slug, label, sort_order) values ('musique', 'Musique', 9)$q$);
select test.login(:'b');
select test.ok('recherche plein texte en français', test.count_rows($q$select 1 from public.posts where search @@ websearch_to_tsquery('french', 'lecture')$q$) >= 0);
select test.ok('recherche : « victoires » trouve « victoire » (racinisation)', test.count_rows($q$select 1 from public.posts where search @@ websearch_to_tsquery('french', 'victoires')$q$) >= 1);

-- ---------- Suppression de compte : contenus effacés, modération conservée ----------
select test.superuser();
select test.make_user('c-del@example.test') as del \gset
select test.onboard(:'del', 'Denise');
select test.login(:'del');
select test.lives('contenu de la future ex-membre', format($q$insert into public.posts (author_id, category_id, body) values (%L, %L, 'Mon dernier message')$q$, :'del', :'cat'));
select test.superuser();
select count(*) as n_actions_before from public.moderation_actions \gset
delete from auth.users where id = :'del';
select test.ok('publications supprimées en cascade', not exists (select 1 from public.posts where author_id = :'del'));
select test.ok('journal de modération conservé', (select count(*) from public.moderation_actions) = :n_actions_before);

select test.finish('40_community');
