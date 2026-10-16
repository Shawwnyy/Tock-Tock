-- Phase B : bilans, indicateurs personnalisés, objectifs, chroniques — validité ET confidentialité.
\set ON_ERROR_STOP on
select test.superuser();

select test.member('w1@example.test', 'Wendy') as w1 \gset
select test.member('w2@example.test', 'Walter') as w2 \gset
select test.staff('w-mod@example.test', 'Marcel', 'moderator') as wm \gset
select test.staff('w-adm@example.test', 'Nadine', 'admin') as wa \gset

-- ---------- Indicateurs personnalisés ----------
select test.login(:'w1');
select id as cat from public.indicator_categories where template_key = 'emotional' \gset
select id as mood from public.indicators where template_key = 'mood' \gset
select id as sleep from public.indicators where template_key = 'sleep' \gset

select test.lives('créer un indicateur numérique 1-5', format($q$insert into public.indicators (user_id, category_id, name, scale_min, scale_max) values (%L, %L, 'Humeur du matin', 1, 5)$q$, :'w1', :'cat'));
select id as morning from public.indicators where name = 'Humeur du matin' \gset
select test.lives('créer un indicateur texte', format($q$insert into public.indicators (user_id, category_id, name, response_type) values (%L, %L, 'Une phrase sur ma journée', 'text')$q$, :'w1', :'cat'));
select id as txt from public.indicators where name = 'Une phrase sur ma journée' \gset
select test.ok('un indicateur texte n''entre jamais dans la moyenne', (select not include_in_average from public.indicators where id = :'txt'));
select test.lives('créer un choix noté', format($q$insert into public.indicators (user_id, category_id, name, response_type, choices) values (%L, %L, 'Météo intérieure', 'choice', '[{"label":"Orage","score":2},{"label":"Nuageux","score":5},{"label":"Soleil","score":9}]')$q$, :'w1', :'cat'));
select id as ch from public.indicators where name = 'Météo intérieure' \gset
select test.ok('un choix noté peut entrer dans la moyenne', (select include_in_average from public.indicators where id = :'ch'));
select test.lives('créer un choix sans score', format($q$insert into public.indicators (user_id, category_id, name, response_type, choices) values (%L, %L, 'Activité', 'choice', '[{"label":"Sport"},{"label":"Lecture"}]')$q$, :'w1', :'cat'));
select test.ok('un choix sans score est exclu de la moyenne', (select not include_in_average from public.indicators where name = 'Activité'));
select test.lives('créer un oui/non', format($q$insert into public.indicators (user_id, category_id, name, response_type) values (%L, %L, 'Sorti prendre l''air', 'boolean')$q$, :'w1', :'cat'));
select id as bool from public.indicators where name = 'Sorti prendre l''air' \gset
select test.throws('échelle invalide', format($q$insert into public.indicators (user_id, category_id, name, scale_min, scale_max) values (%L, %L, 'X', 5, 5)$q$, :'w1', :'cat'), 'invalid_scale');
select test.throws('un seul choix refusé', format($q$insert into public.indicators (user_id, category_id, name, response_type, choices) values (%L, %L, 'X', 'choice', '[{"label":"a"}]')$q$, :'w1', :'cat'), 'invalid_choices');
select test.throws('score hors 0-10 refusé', format($q$insert into public.indicators (user_id, category_id, name, response_type, choices) values (%L, %L, 'X', 'choice', '[{"label":"a","score":11},{"label":"b","score":1}]')$q$, :'w1', :'cat'), 'invalid_choices');
select test.throws('catégorie d''un autre membre refusée', format($q$insert into public.indicators (user_id, category_id, name) values (%L, %L, 'X')$q$, :'w1', (select id from public.indicator_categories where user_id = :'w2' limit 1)), 'invalid_category');
select test.throws('impossible de créer un indicateur pour un autre membre', format($q$insert into public.indicators (user_id, category_id, name) values (%L, %L, 'X')$q$, :'w2', :'cat'), 'invalid_category');
select test.lives('créer sa propre catégorie', format($q$insert into public.indicator_categories (user_id, name) values (%L, 'Créativité')$q$, :'w1'));

-- ---------- Bilan : réponses valides, vides, invalides ----------
select test.lives('créer un bilan', format($q$insert into public.checkins (user_id, checkin_date, events_note) values (%L, current_date, 'Réunion tendue le matin')$q$, :'w1'));
select id as ck from public.checkins where user_id = :'w1' and checkin_date = current_date \gset
select test.throws('un seul bilan par jour', format($q$insert into public.checkins (user_id, checkin_date) values (%L, current_date)$q$, :'w1'), 'duplicate');
select test.throws('date trop lointaine dans le futur', format($q$insert into public.checkins (user_id, checkin_date) values (%L, current_date + 5)$q$, :'w1'), 'invalid_checkin_date');

select test.lives('réponse 0 (zéro réel)', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_num) values (%L, %L, %L, 0)$q$, :'ck', :'w1', :'mood'));
select test.lives('réponse 7', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_num) values (%L, %L, %L, 7)$q$, :'ck', :'w1', :'sleep'));
select test.throws('réponse > max', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_num) values (%L, %L, %L, 11)$q$, :'ck', :'w1', :'morning'), 'answer_out_of_range');
select test.throws('réponse < min (échelle 1-5)', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_num) values (%L, %L, %L, 0)$q$, :'ck', :'w1', :'morning'), 'answer_out_of_range');
select test.throws('réponse non entière', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_num) values (%L, %L, %L, 3.5)$q$, :'ck', :'w1', :'morning'), 'answer_out_of_range');
select test.throws('texte pour un indicateur numérique', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_text) values (%L, %L, %L, 'bien')$q$, :'ck', :'w1', :'morning'), 'answer_out_of_range');
select test.throws('aucune valeur (réponse vide interdite : on supprime la ligne)', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id) values (%L, %L, %L)$q$, :'ck', :'w1', :'morning'), 'answer_out_of_range');
select test.throws('deux valeurs', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_num, value_text) values (%L, %L, %L, 3, 'x')$q$, :'ck', :'w1', :'morning'), 'answer_exactly_one_value');
select test.lives('réponse texte', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_text) values (%L, %L, %L, 'Une journée en dents de scie')$q$, :'ck', :'w1', :'txt'));
select test.lives('réponse choix valide', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_choice) values (%L, %L, %L, 'Soleil')$q$, :'ck', :'w1', :'ch'));
select test.lives('réponse oui/non', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_num) values (%L, %L, %L, 1)$q$, :'ck', :'w1', :'bool'));
select test.throws('un indicateur ne peut être répondu deux fois', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_num) values (%L, %L, %L, 3)$q$, :'ck', :'w1', :'sleep'), 'duplicate');
select test.throws('indicateur d''un autre membre', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_num) values (%L, %L, %L, 3)$q$, :'ck', :'w1', (select id from public.indicators where user_id = :'w2' limit 1)), 'unknown_indicator');
select test.ok('seules 5 réponses existent : les questions passées n''ont AUCUNE ligne (donc jamais 0)', (select count(*) from public.checkin_answers where checkin_id = :'ck') = 5);

-- Instantané : rempli par le serveur, immuable
select test.ok('instantané : nom', (select snapshot ->> 'name' from public.checkin_answers where indicator_id = :'mood') = 'Moral général');
select test.ok('instantané : catégorie', (select snapshot ->> 'category_name' from public.checkin_answers where indicator_id = :'mood') = 'État émotionnel');
select test.ok('instantané : échelle', (select (snapshot ->> 'scale_max')::int from public.checkin_answers where indicator_id = :'mood') = 10);
select test.lives('renommer et changer l''échelle de l''indicateur', format($q$update public.indicators set name = 'Mon humeur', scale_min = 1, scale_max = 5 where id = %L$q$, :'mood'));
select test.ok('l''ancien bilan garde l''ancienne définition', (select snapshot ->> 'name' from public.checkin_answers where indicator_id = :'mood') = 'Moral général'
  and (select (snapshot ->> 'scale_max')::int from public.checkin_answers where indicator_id = :'mood') = 10);
select test.throws('le client ne peut pas modifier l''instantané', format($q$update public.checkin_answers set snapshot = '{"name":"truqué"}' where indicator_id = %L$q$, :'mood'), 'permission denied');
select test.throws('le client ne peut pas changer user_id', format($q$update public.checkin_answers set user_id = %L$q$, :'w2'), 'permission denied');
select test.lives('modifier une valeur', format($q$update public.checkin_answers set value_num = 2 where indicator_id = %L$q$, :'sleep'));
select test.throws('modifier avec une valeur invalide (validé contre l''instantané)', format($q$update public.checkin_answers set value_num = 12 where indicator_id = %L$q$, :'sleep'), 'answer_out_of_range');
select test.lives('désactiver un indicateur', format($q$update public.indicators set is_active = false where id = %L$q$, :'sleep'));
select test.ok('la réponse passée est conservée', (select count(*) from public.checkin_answers where indicator_id = :'sleep') = 1);
select test.lives('supprimer définitivement l''indicateur', format($q$delete from public.indicators where id = %L$q$, :'sleep'));
select test.ok('la réponse passée survit à la suppression de l''indicateur (indicator_id NULL, instantané intact)',
  (select count(*) from public.checkin_answers where snapshot ->> 'name' = 'Qualité du sommeil' and indicator_id is null) = 1);
select test.lives('nouveau jour : bilan de demain autorisé', format($q$insert into public.checkins (user_id, checkin_date) values (%L, current_date + 1)$q$, :'w1'));
-- Douleur : colonnes dédiées, validées
select test.lives('douleur 6/10 avec zone', format($q$update public.checkins set pain_score = 6, pain_zone = 'Dos', pain_note = 'Après le sport' where id = %L$q$, :'ck'));
select test.throws('douleur > 10', format($q$update public.checkins set pain_score = 11 where id = %L$q$, :'ck'), 'check');
select test.throws('clés du bilan immuables', format($q$update public.checkins set checkin_date = current_date - 3 where id = %L$q$, :'ck'), 'immutable_checkin_keys');

-- ---------- Objectifs ----------
select test.lives('créer un objectif', format($q$insert into public.goals (user_id, title, due_date, status) values (%L, 'Lire 15 minutes par jour', current_date + 2, 'in_progress')$q$, :'w1'));
select id as g from public.goals where user_id = :'w1' \gset
select test.ok('événement « created » journalisé', (select count(*) from public.goal_events where goal_id = :'g' and event = 'created') = 1);
select test.lives('terminer l''objectif', format($q$update public.goals set status = 'done' where id = %L$q$, :'g'));
select test.ok('completed_at renseigné', (select completed_at is not null from public.goals where id = :'g'));
select test.ok('changement de statut journalisé', (select count(*) from public.goal_events where goal_id = :'g' and event = 'status_changed') = 1);
select test.lives('reprendre l''objectif', format($q$update public.goals set status = 'paused' where id = %L$q$, :'g'));
select test.ok('completed_at effacé', (select completed_at is null from public.goals where id = :'g'));
select test.lives('ajouter une étape', format($q$insert into public.goal_steps (goal_id, user_id, title) values (%L, %L, 'Choisir un livre')$q$, :'g', :'w1'));
select test.throws('étape sur l''objectif d''un autre membre', format($q$insert into public.goal_steps (goal_id, user_id, title) values (%L, %L, 'Intrus')$q$, :'g', :'w2'), 'unknown_goal');
select test.lives('valider l''étape', format($q$update public.goal_steps set done = true where goal_id = %L$q$, :'g'));
select test.ok('done_at renseigné', (select done_at is not null from public.goal_steps where goal_id = :'g'));
select test.throws('statut invalide', format($q$update public.goals set status = 'failed' where id = %L$q$, :'g'), 'check');
select test.throws('on ne cède pas un objectif', format($q$update public.goals set user_id = %L where id = %L$q$, :'w2', :'g'), 'immutable_owner');

-- ---------- Chronique ----------
select test.lives('créer une chronique', format($q$insert into public.chronicles (user_id, chronicle_date, title, sections) values (%L, current_date, 'Chronique du jour', '{"summary":"Une journée contrastée."}')$q$, :'w1'));
select test.throws('sections invalides (pas un objet)', format($q$insert into public.chronicles (user_id, chronicle_date, title, sections) values (%L, current_date - 1, 't', '[1]')$q$, :'w1'), 'chronicle_sections_shape');
select test.throws('une chronique par jour', format($q$insert into public.chronicles (user_id, chronicle_date, title, sections) values (%L, current_date, 't', '{}')$q$, :'w1'), 'duplicate');

-- ---------- CONFIDENTIALITÉ : isolation totale ----------
select test.login(:'w2');
select test.is('w2 ne voit aucun bilan de w1', test.count_rows(format($q$select 1 from public.checkins where user_id = %L$q$, :'w1')), 0);
select test.is('w2 ne voit aucune réponse de w1', test.count_rows(format($q$select 1 from public.checkin_answers where user_id = %L$q$, :'w1')), 0);
select test.is('w2 ne voit aucun objectif de w1', test.count_rows(format($q$select 1 from public.goals where user_id = %L$q$, :'w1')), 0);
select test.is('w2 ne voit aucune étape de w1', test.count_rows($q$select 1 from public.goal_steps where title = 'Choisir un livre'$q$), 0);
select test.is('w2 ne voit aucune chronique de w1', test.count_rows(format($q$select 1 from public.chronicles where user_id = %L$q$, :'w1')), 0);
select test.is('w2 ne voit aucun indicateur de w1', test.count_rows(format($q$select 1 from public.indicators where user_id = %L$q$, :'w1')), 0);
select test.is('w2 ne voit pas la douleur de w1', test.count_rows($q$select 1 from public.checkins where pain_score is not null$q$), 0);
select test.is('w2 ne peut pas modifier le bilan de w1', test.affected(format($q$update public.checkins set events_note = 'piraté' where id = %L$q$, :'ck')), 0);
select test.is('w2 ne peut pas supprimer le bilan de w1', test.affected(format($q$delete from public.checkins where id = %L$q$, :'ck')), 0);
select test.throws('w2 ne peut pas écrire une réponse dans le bilan de w1', format($q$insert into public.checkin_answers (checkin_id, user_id, indicator_id, value_num) values (%L, %L, %L, 5)$q$, :'ck', :'w2', (select id from public.indicators where user_id = :'w2' limit 1)), 'unknown_checkin');

-- Le personnel de modération n'a AUCUN accès aux données privées
select test.login(:'wm');
select test.is('modérateur : aucun bilan', test.count_rows($q$select 1 from public.checkins$q$), 0);
select test.is('modérateur : aucune réponse', test.count_rows($q$select 1 from public.checkin_answers$q$), 0);
select test.is('modérateur : aucun objectif', test.count_rows($q$select 1 from public.goals$q$), 0);
select test.is('modérateur : aucune chronique', test.count_rows($q$select 1 from public.chronicles$q$), 0);
select test.is('modérateur : aucun réglage des autres', test.count_rows(format($q$select 1 from public.profile_settings where user_id <> %L$q$, :'wm')), 0);
select test.login(:'wa');
select test.is('administrateur : aucun bilan', test.count_rows($q$select 1 from public.checkins$q$), 0);
select test.is('administrateur : aucune chronique', test.count_rows($q$select 1 from public.chronicles$q$), 0);
select test.is('administrateur : aucun objectif', test.count_rows($q$select 1 from public.goals$q$), 0);
select test.is('administrateur : aucun réglage des autres', test.count_rows(format($q$select 1 from public.profile_settings where user_id <> %L$q$, :'wa')), 0);

select test.anon();
select test.throws('anon : pas de bilans', $q$select * from public.checkins$q$, 'permission denied');
select test.throws('anon : pas d''objectifs', $q$select * from public.goals$q$, 'permission denied');
select test.throws('anon : pas de chroniques', $q$select * from public.chronicles$q$, 'permission denied');

-- ---------- Chroniques : envoi idempotent ----------
select test.service();
select test.ok('1re réservation : oui', public.claim_chronicle_delivery(:'w1', date '2026-03-01', 'email'));
select test.ok('2e réservation immédiate : non (déjà en cours)', not public.claim_chronicle_delivery(:'w1', date '2026-03-01', 'email'));
select public.finish_chronicle_delivery(:'w1', date '2026-03-01', 'email', 'sent', null, 'msg_1');
select test.ok('après envoi : jamais deux fois', not public.claim_chronicle_delivery(:'w1', date '2026-03-01', 'email'));
select test.ok('un autre jour est indépendant', public.claim_chronicle_delivery(:'w1', date '2026-03-02', 'email'));
select public.finish_chronicle_delivery(:'w1', date '2026-03-02', 'email', 'failed', 'timeout');
select test.ok('échec : pas de nouvelle tentative immédiate (délai)', not public.claim_chronicle_delivery(:'w1', date '2026-03-02', 'email'));
update public.chronicle_deliveries set next_attempt_at = now() - interval '1 minute' where chronicle_date = date '2026-03-02';
select test.ok('échec : nouvelle tentative après le délai', public.claim_chronicle_delivery(:'w1', date '2026-03-02', 'email'));
select test.is('tentatives comptées', (select attempts from public.chronicle_deliveries where chronicle_date = date '2026-03-02'), 2);
select public.finish_chronicle_delivery(:'w1', date '2026-03-02', 'email', 'failed', 'timeout');
update public.chronicle_deliveries set next_attempt_at = now() - interval '1 minute', attempts = 3 where chronicle_date = date '2026-03-02';
select test.ok('3 tentatives maximum', not public.claim_chronicle_delivery(:'w1', date '2026-03-02', 'email'));
select public.claim_chronicle_delivery(:'w1', date '2026-03-03', 'email');
update public.chronicle_deliveries set locked_until = now() - interval '1 minute' where chronicle_date = date '2026-03-03';
select test.ok('réservation périmée (plantage) : reprise possible', public.claim_chronicle_delivery(:'w1', date '2026-03-03', 'email'));
select test.login(:'w1');
select test.throws('un membre ne peut pas réserver/envoyer', format($q$select public.claim_chronicle_delivery(%L, date '2026-04-01', 'email')$q$, :'w1'), 'permission denied');
select test.ok('un membre voit l''historique de ses envois', test.count_rows($q$select 1 from public.chronicle_deliveries$q$) = 3);
select test.throws('un membre ne peut pas falsifier l''historique', $q$update public.chronicle_deliveries set status = 'sent'$q$, 'permission denied');
select test.login(:'w2');
select test.is('w2 ne voit pas l''historique d''envoi de w1', test.count_rows($q$select 1 from public.chronicle_deliveries$q$), 0);

-- ---------- Indicateurs par défaut : restauration idempotente ----------
select test.login(:'w1');
select test.lives('restaurer les indicateurs par défaut', $q$select public.restore_default_indicators()$q$);
select test.ok('l''indicateur de modèle supprimé est recréé', exists (select 1 from public.indicators where template_key = 'sleep' and deleted_at is null));
select test.lives('restaurer deux fois', $q$select public.restore_default_indicators()$q$);
select test.is('pas de doublon de modèle', (select count(*)::int from public.indicators where template_key = 'sleep'), 1);

select test.finish('30_wellbeing_privacy');
