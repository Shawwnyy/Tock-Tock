-- Aide : tickets de support. Isolation entre membres, notes internes, rôle du personnel, limites, informations techniques filtrées.
\set ON_ERROR_STOP on
select test.superuser();

select test.member('t-alice@example.test', 'Alice') as a \gset
select test.member('t-bob@example.test', 'Bob') as b \gset
select test.member('t-carol@example.test', 'Carol') as c \gset
select test.staff('t-mod@example.test', 'Marc', 'moderator') as m \gset

-- ---------- Accès ----------
select test.anon();
select test.throws('anon : pas de tickets', $q$select * from public.support_tickets$q$, 'permission denied');
select test.throws('anon : pas de RPC create_ticket', $q$select public.create_ticket('bug', 'Sujet valide', 'Description suffisamment longue')$q$, 'permission denied');

-- ---------- Création ----------
select test.login(:'a');
select public.create_ticket('bug', 'La sauvegarde ne marche pas', 'Quand je clique sur sauvegarder rien ne se passe depuis hier.', 'normal',
  '{"browser":"Chrome 130","os":"Windows","secret":"mot-de-passe","bilan":{"moral":3},"version":"1.1"}'::jsonb) ->> 'ref' as r1 \gset
select public.create_ticket('bug', 'La sauvegarde ne marche pas', 'Quand je clique sur sauvegarder rien ne se passe depuis hier.', 'normal', '{}'::jsonb) ->> 'id' as dummy \gset
select id as t1 from public.support_tickets where ref = :'r1' \gset
select test.ok('référence au format TT-AAAAMMJJ-XXXX', :'r1' ~ '^TT-[0-9]{8}-[0-9A-F]{4}$');
select test.is('le membre voit ses 2 tickets', test.count_rows($q$select 1 from public.support_tickets$q$), 2);
select test.is('statut initial', (select status from public.support_tickets where id = :'t1'), 'open');
select test.is('premier message = la description', test.count_rows(format($q$select 1 from public.support_messages where ticket_id = %L$q$, :'t1')), 1);
select test.is('informations techniques : clés autorisées seulement', (select diagnostic from public.support_tickets where id = :'t1'), '{"os": "Windows", "browser": "Chrome 130", "version": "1.1"}'::jsonb);
select test.throws('sujet trop court', $q$select public.create_ticket('bug', 'abc', 'Description suffisamment longue pour passer.')$q$, 'invalid_subject');
select test.throws('description trop courte', $q$select public.create_ticket('bug', 'Un sujet correct', 'court')$q$, 'invalid_body');
select test.throws('catégorie inconnue', $q$select public.create_ticket('piratage', 'Un sujet correct', 'Description suffisamment longue pour passer.')$q$, 'invalid_category');
select test.throws('priorité inconnue', $q$select public.create_ticket('bug', 'Un sujet correct', 'Description suffisamment longue pour passer.', 'critique')$q$, 'invalid_priority');

-- ---------- Écritures directes interdites, colonnes réservées au personnel ----------
select test.throws('pas d''INSERT direct', format($q$insert into public.support_tickets (ref, user_id, category, subject) values ('X', %L, 'bug', 'Sujet valide')$q$, :'a'), 'permission denied');
select test.throws('pas d''UPDATE direct (statut)', $q$update public.support_tickets set status = 'resolved'$q$, 'permission denied');
select test.throws('pas de DELETE direct', $q$delete from public.support_tickets$q$, 'permission denied');
select test.throws('les indicateurs du filtre (flags) sont illisibles par le membre', $q$select flags from public.support_tickets$q$, 'permission denied');
select test.throws('l''assignation est illisible par le membre', $q$select assigned_to from public.support_tickets$q$, 'permission denied');
select test.throws('l''auteur des messages est illisible par le membre', $q$select author_id from public.support_messages$q$, 'permission denied');
select test.throws('pas de vue du personnel pour un membre : file vide', $q$select 1/(count(*)) from public.staff_tickets$q$, 'division');

-- ---------- Isolation entre membres ----------
select test.login(:'b');
select test.is('b ne voit aucun ticket de a', test.count_rows($q$select 1 from public.support_tickets$q$), 0);
select test.is('b ne voit aucun message de a', test.count_rows($q$select 1 from public.support_messages$q$), 0);
select test.throws('b ne peut pas écrire sur le ticket de a', format($q$select public.add_ticket_message(%L, 'je m''incruste dans ce ticket')$q$, :'t1'), 'not_found');
select test.throws('b ne peut pas fermer le ticket de a', format($q$select public.close_my_ticket(%L)$q$, :'t1'), 'not_found');
select test.throws('b ne peut pas répondre en tant que personnel', format($q$select public.staff_reply_ticket(%L, 'bonjour')$q$, :'t1'), 'forbidden');
select test.throws('b ne peut pas changer un statut', format($q$select public.staff_set_ticket_status(%L, 'resolved')$q$, :'t1'), 'forbidden');

-- ---------- Détresse : priorité relevée, indicateur visible du personnel seulement ----------
select test.login(:'c');
select public.create_ticket('usage', 'Je n''y arrive plus', 'Je veux mourir, plus rien ne va et je ne comprends pas l''application.') as res \gset
select test.ok('l''appli est prévenue (needs_support) pour afficher des ressources d''aide', (:'res'::jsonb ->> 'needs_support')::boolean);
select test.is('priorité relevée automatiquement', (select priority from public.support_tickets where id = (:'res'::jsonb ->> 'id')::uuid), 'important');
select test.is('le texte n''est pas refusé (aucun blocage d''une personne en difficulté)', test.count_rows($q$select 1 from public.support_tickets$q$), 1);

-- ---------- Personnel : file, réponses, notes internes ----------
select test.login(:'m');
select test.ok('le modérateur voit la file (3 tickets)', test.count_rows($q$select 1 from public.staff_tickets$q$) = 3);
select test.ok('il voit le pseudonyme, pas l''identifiant', not exists (select 1 from information_schema.columns where table_name = 'staff_tickets' and column_name = 'user_id'));
select test.ok('il voit l''indicateur de détresse', exists (select 1 from public.staff_tickets where (flags ->> 'needs_support')::boolean));
select test.throws('il ne lit pas la table brute (colonne sensible)', $q$select flags from public.support_tickets$q$, 'permission denied');
select test.is('RLS : le personnel ne lit pas les tickets bruts des membres', test.count_rows($q$select 1 from public.support_tickets$q$), 0);
select test.is('aucune donnée privée de bien-être pour le personnel', test.count_rows($q$select 1 from public.checkins$q$), 0);
select test.lives('réponse publique', format($q$select public.staff_reply_ticket(%L, 'Bonjour Alice, pouvez-vous essayer avec un autre navigateur ?')$q$, :'t1'));
select test.lives('note interne', format($q$select public.staff_reply_ticket(%L, 'Probablement le même souci que le ticket précédent.', true)$q$, :'t1'));
select test.is('la réponse publique passe le ticket en attente du membre', (select status from public.staff_tickets where id = :'t1'), 'pending_member');
select test.is('le personnel voit les 3 messages (dont la note interne)', test.count_rows(format($q$select 1 from public.staff_ticket_messages where ticket_id = %L$q$, :'t1')), 3);
select test.throws('message vide refusé', format($q$select public.staff_reply_ticket(%L, '   ')$q$, :'t1'), 'invalid_body');

select test.login(:'a');
select test.is('a voit 2 messages (sa description + la réponse), pas la note interne', test.count_rows(format($q$select 1 from public.support_messages where ticket_id = %L$q$, :'t1')), 2);
select test.ok('la réponse est marquée « personnel »', exists (select 1 from public.support_messages where ticket_id = :'t1' and is_staff));
select test.is('le ticket attend la réponse du membre', (select status from public.support_tickets where id = :'t1'), 'pending_member');
select test.lives('a répond', format($q$select public.add_ticket_message(%L, 'J''ai essayé avec Firefox, ça marche mieux.')$q$, :'t1'));
select test.is('sa réponse rouvre le ticket', (select status from public.support_tickets where id = :'t1'), 'open');

select test.login(:'m');
select test.lives('le personnel résout', format($q$select public.staff_set_ticket_status(%L, 'resolved')$q$, :'t1'));
select test.throws('statut inconnu refusé', format($q$select public.staff_set_ticket_status(%L, 'brillant')$q$, :'t1'), 'invalid_status');
select test.ok('le changement de statut est tracé en note interne', exists (select 1 from public.staff_ticket_messages where ticket_id = :'t1' and internal and body like 'Statut : open -> resolved%'));

select test.login(:'a');
select test.is('a ne voit pas la trace interne', test.count_rows(format($q$select 1 from public.support_messages where ticket_id = %L and body like 'Statut :%%'$q$, :'t1')), 0);
select test.lives('a ferme son ticket', format($q$select public.close_my_ticket(%L)$q$, :'t1'));
select test.is('fermé', (select status from public.support_tickets where id = :'t1'), 'closed');
select test.throws('plus de message sur un ticket fermé', format($q$select public.add_ticket_message(%L, 'encore une question')$q$, :'t1'), 'ticket_closed');

-- ---------- Limites ----------
select test.superuser();
select test.member('t-dave@example.test', 'Dave') as d \gset
select test.login(:'d');
select count(*) as made from (select public.create_ticket('other', 'Suggestion numéro ' || g, 'Ceci est une description suffisamment longue.') from generate_series(1, 5) g) x \gset
select test.is('5 tickets par jour autorisés', :'made'::int, 5);
select test.throws('le 6e est refusé (limite journalière)', $q$select public.create_ticket('other', 'Suggestion de trop', 'Ceci est une description suffisamment longue.')$q$, 'rate_limited');

-- ---------- Suppression de compte : les tickets disparaissent avec le compte ----------
select test.superuser();
select count(*) as before_n from public.support_tickets where user_id = :'d' \gset
delete from auth.users where id = :'d';
select test.is('les tickets d''un compte supprimé sont supprimés', (select count(*)::int from public.support_tickets where user_id = :'d'), 0);

select test.finish('70_support_tickets');
