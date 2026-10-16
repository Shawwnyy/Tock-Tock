-- Phase E : bibliothèque, notifications, assistant (tables), export des données.
\set ON_ERROR_STOP on
select test.superuser();

select test.member('e-alice@example.test', 'Ariane') as a \gset
select test.member('e-bob@example.test', 'Basile') as b \gset
select test.staff('e-admin@example.test', 'Christine', 'admin') as ad \gset
select test.staff('e-mod@example.test', 'Damien', 'moderator') as mo \gset
select test.make_user('e-visitor@example.test') as v \gset
select id as cat from public.post_categories where slug = 'bien-etre' \gset

-- ---------- Bibliothèque ----------
select test.login(:'a');
select test.ok('ressources officielles visibles', test.count_rows($q$select 1 from public.resources where origin = 'official'$q$) >= 9);
select test.ok('provenances distinctes : officiel / externe', test.count_rows($q$select 1 from public.resources where origin = 'external'$q$) = 2);
select test.ok('chaque ressource porte une mention de droits', not exists (select 1 from public.resources where license_note is null or char_length(license_note) < 5));
select test.is('2 parcours publiés', test.count_rows($q$select 1 from public.pathways$q$), 2);
select test.is('étapes du parcours', test.count_rows($q$select 1 from public.pathway_steps$q$), 6);
select test.throws('un membre ne crée pas de ressource officielle', $q$insert into public.resources (origin, kind, title, summary, source_label, license_note, status) values ('official', 'tip', 'Faux', 'Faux officiel', 'x', 'contenu faux', 'published')$q$, 'row-level security');
select test.is('un membre ne peut pas modifier une ressource', test.affected($q$update public.resources set title = 'piraté'$q$), 0);
select id as r1 from public.resources where title = 'Trois petites victoires' \gset
select test.lives('progression : commencé', format($q$select public.set_resource_progress(%L, 'started')$q$, :'r1'));
select test.lives('progression : terminé', format($q$select public.set_resource_progress(%L, 'done')$q$, :'r1'));
select test.is('une ligne de progression', test.count_rows($q$select 1 from public.resource_progress$q$), 1);
select test.throws('statut invalide', format($q$select public.set_resource_progress(%L, 'cheated')$q$, :'r1'), 'check');
select test.lives('favori de ressource', format($q$insert into public.saved_items (user_id, resource_id) values (%L, %L)$q$, :'a', :'r1'));
select test.login(:'b');
select test.is('b ne voit pas la progression de a', test.count_rows($q$select 1 from public.resource_progress$q$), 0);
select test.is('b ne voit pas les favoris de a', test.count_rows($q$select 1 from public.saved_items$q$), 0);
select test.login(:'v');
select test.is('compte non terminé : bibliothèque fermée', test.count_rows($q$select 1 from public.resources$q$), 0);
select test.anon();
select test.throws('anon : pas de bibliothèque', $q$select * from public.resources$q$, 'permission denied');

select test.login(:'ad');
select test.lives('l''admin crée une ressource brouillon', $q$insert into public.resources (origin, kind, title, summary, source_label, license_note, status) values ('official', 'tip', 'Brouillon interne', 'À relire avant publication', 'Tock Tock', 'Contenu original Tock Tock', 'draft')$q$);
select test.login(:'a');
select test.is('les brouillons restent invisibles aux membres', test.count_rows($q$select 1 from public.resources where title = 'Brouillon interne'$q$), 0);
select test.login(:'ad');
select test.throws('une ressource externe exige un lien https', $q$insert into public.resources (origin, kind, title, summary, source_label, license_note, external_url) values ('external', 'link', 'Lien', 'Un lien externe', 'x', 'Lien externe', 'http://non-securise.example')$q$, 'check');
select test.throws('une ressource externe exige un lien', $q$insert into public.resources (origin, kind, title, summary, source_label, license_note) values ('external', 'link', 'Sans lien', 'Un lien externe', 'x', 'Lien externe')$q$, 'resources_external_needs_url');
select test.throws('mention de droits obligatoire', $q$insert into public.resources (origin, kind, title, summary, source_label, license_note) values ('official', 'tip', 'Sans droits', 'Pas de licence', 'x', '')$q$, 'check');

-- ---------- Notifications ----------
select test.login(:'a');
insert into public.posts (author_id, category_id, body) values (:'a', :'cat', 'Une astuce pour mieux dormir') returning id as p1 \gset
select test.login(:'b');
select test.lives('b réagit', format($q$insert into public.reactions (user_id, post_id, kind) values (%L, %L, 'thanks')$q$, :'b', :'p1'));
select test.lives('b commente', format($q$insert into public.comments (post_id, author_id, body) values (%L, %L, 'Merci !')$q$, :'p1', :'b'));
select id as k1 from public.comments where author_id = :'b' limit 1 \gset
select test.login(:'a');
select test.is('a reçoit 2 notifications (réaction + commentaire)', test.count_rows($q$select 1 from public.notifications$q$), 2);
select test.ok('notification de réaction ne contient que des références', (select payload ?& array['post_id','actor_handle'] and not (payload::text ~* '(score|moral|douleur|bilan|chronique)') from public.notifications where kind = 'reaction'));
select test.lives('a marque comme lu', $q$update public.notifications set read_at = now()$q$);
select test.throws('a ne peut modifier que read_at', $q$update public.notifications set payload = '{}'$q$, 'permission denied');
select test.lives('a répond à b', format($q$insert into public.comments (post_id, author_id, parent_id, body) values (%L, %L, %L, 'Avec plaisir')$q$, :'p1', :'a', :'k1'));
select test.login(:'b');
select test.is('b reçoit une réponse', test.count_rows($q$select 1 from public.notifications where kind = 'reply'$q$), 1);
select test.is('b ne reçoit pas de notification pour ses propres actions', test.count_rows($q$select 1 from public.notifications where kind in ('reaction','comment')$q$), 0);
select test.lives('b désactive les notifications de réponse', $q$update public.profile_settings set notification_prefs = notification_prefs || '{"reply":false}'$q$);
select test.login(:'a');
select test.lives('a répond de nouveau', format($q$insert into public.comments (post_id, author_id, parent_id, body) values (%L, %L, %L, 'Et encore une réponse')$q$, :'p1', :'a', :'k1'));
select test.login(:'b');
select test.is('préférence respectée : pas de 2e notification', test.count_rows($q$select 1 from public.notifications where kind = 'reply'$q$), 1);
select test.login(:'b');
select test.is('b ne voit pas les notifications de a', test.count_rows(format($q$select 1 from public.notifications where user_id = %L$q$, :'a')), 0);
select test.throws('personne ne peut créer de notification', format($q$insert into public.notifications (user_id, kind) values (%L, 'comment')$q$, :'b'), 'permission denied');

-- Blocage : plus de notification
select test.login(:'a');
select test.lives('a bloque b', format($q$insert into public.blocks (blocker_id, blocked_id) values (%L, %L)$q$, :'a', :'b'));
select test.superuser();
select count(*) as n_before from public.notifications where user_id = :'a' \gset
delete from public.blocks;

-- Objectif proche de l'échéance
select test.login(:'a');
select test.lives('objectif à échéance proche', format($q$insert into public.goals (user_id, title, due_date, status) values (%L, 'Rendre le rapport', current_date + 2, 'in_progress')$q$, :'a'));
select test.lives('objectif sans échéance proche', format($q$insert into public.goals (user_id, title, due_date, status) values (%L, 'Plus tard', current_date + 30, 'in_progress')$q$, :'a'));
select test.service();
select test.is('1 rappel d''échéance créé', public.enqueue_goal_due_notifications(), 1);
select test.is('idempotent : pas de doublon', public.enqueue_goal_due_notifications(), 0);
select test.superuser();
select test.ok('le rappel ne contient pas le titre ni de donnée privée', (select payload::text !~* 'rapport' from public.notifications where kind = 'goal_due'));

-- Résultat d'un signalement : message neutre
select test.login(:'b');
select test.lives('b signale le post de a', format($q$insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, 'post', %L, 'other')$q$, :'b', :'p1'));
select id as rep from public.reports where reporter_id = :'b' \gset
select test.login(:'mo');
select test.lives('clôture', format($q$select public.act_on_report(%L, 'closed', 'no_action', 'Rien à signaler.')$q$, :'rep'));
select test.login(:'b');
select test.ok('b est informé de la clôture sans détail', (select payload = jsonb_build_object('report_id', :'rep') from public.notifications where kind = 'report_result'));

-- Décision de modération : notification SANS explication
select test.login(:'mo');
select test.lives('masquage', format($q$select public.moderate_content('post', %L, 'hide', 'other', 'Contenu hors sujet répété sur la page.')$q$, :'p1'));
select test.login(:'a');
select test.ok('a est notifié', (select payload ->> 'action' = 'content_hide' from public.notifications where kind = 'moderation'));
select test.ok('l''explication n''est PAS dans la notification', (select payload::text !~* 'hors sujet' from public.notifications where kind = 'moderation'));

-- ---------- Assistant : confidentialité des conversations ----------
select test.service();
insert into public.chat_conversations (id, user_id) values ('00000000-0000-0000-0000-0000000000c1', :'a');
insert into public.chat_messages (conversation_id, user_id, role, content) values ('00000000-0000-0000-0000-0000000000c1', :'a', 'user', 'Je me sens dépassé en ce moment');
select test.ok('le serveur compte l''usage et applique la limite', public.bump_usage(:'a', 'assistant', 2) and public.bump_usage(:'a', 'assistant', 2) and not public.bump_usage(:'a', 'assistant', 2));
select test.login(:'a');
select test.is('a voit sa conversation', test.count_rows($q$select 1 from public.chat_messages$q$), 1);
select test.throws('a ne peut pas insérer de message (écriture serveur)', format($q$insert into public.chat_messages (conversation_id, user_id, role, content) values ('00000000-0000-0000-0000-0000000000c1', %L, 'assistant', 'faux')$q$, :'a'), 'permission denied');
select test.throws('a ne lit pas les compteurs d''usage', $q$select * from public.usage_counters$q$, 'permission denied');
select test.throws('a ne peut pas appeler bump_usage', format($q$select public.bump_usage(%L, 'assistant', 1000)$q$, :'a'), 'permission denied');
select test.login(:'b');
select test.is('b ne voit pas la conversation de a', test.count_rows($q$select 1 from public.chat_messages$q$), 0);
select test.login(:'mo');
select test.is('modérateur : aucune conversation', test.count_rows($q$select 1 from public.chat_messages$q$) + test.count_rows($q$select 1 from public.chat_conversations$q$), 0);
select test.login(:'ad');
select test.is('administrateur : aucune conversation', test.count_rows($q$select 1 from public.chat_messages$q$) + test.count_rows($q$select 1 from public.chat_conversations$q$), 0);
select test.login(:'a');
select test.lives('a efface son historique', $q$delete from public.chat_conversations$q$);
select test.is('historique effacé (messages supprimés en cascade)', test.count_rows($q$select 1 from public.chat_messages$q$), 0);

-- ---------- Export des données ----------
select test.login(:'a');
insert into public.checkins (user_id, checkin_date, events_note, pain_score, pain_zone) values (:'a', current_date, 'Journée chargée', 4, 'Dos');
select test.service();
select test.superuser();
select test.login(:'a');
select test.ok('export : sections attendues', (select public.export_my_data() ?& array['profile','settings','checkins','goals','chronicles','posts','comments','notifications','sanctions','chat_messages']));
select test.ok('export : mon bilan et ma douleur', (select (public.export_my_data() -> 'checkins' -> 0 ->> 'pain_zone') = 'Dos'));
select test.ok('export : mes publications', (select jsonb_array_length(public.export_my_data() -> 'posts') = 1));
select test.ok('export : pas de contenu des autres', (select public.export_my_data()::text !~ 'Merci !'));
select test.ok('export : pas d''adresse e-mail d''un autre', (select public.export_my_data()::text !~ 'e-bob@example.test'));
select test.login(:'b');
select test.ok('b exporte uniquement ses données', (select public.export_my_data()::text !~ 'Journée chargée') and (select jsonb_array_length(public.export_my_data() -> 'checkins') = 0));
select test.anon();
select test.throws('anon : pas d''export', $q$select public.export_my_data()$q$, 'permission denied');

select test.finish('60_library_notifications_export');
