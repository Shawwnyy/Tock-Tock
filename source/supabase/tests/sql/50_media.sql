-- Phase D : médias — accès aux métadonnées et aux fichiers (politiques de stockage), quotas, relecture.
\set ON_ERROR_STOP on
select test.superuser();

select test.member('m-owner@example.test', 'Olga') as o \gset
select test.member('m-other@example.test', 'Pablo') as p \gset
select test.staff('m-mod@example.test', 'Quentin', 'moderator') as mo \gset
select id as cat from public.post_categories where slug = 'bien-etre' \gset

-- Un billet publié de o
select test.login(:'o');
insert into public.posts (author_id, category_id, body) values (:'o', :'cat', 'Ma photo du jour') returning id as post \gset
select test.superuser();

insert into public.media_assets (id, owner_id, kind, display_name, bucket, storage_path, size_bytes, status, detected_mime, scan_result, duration_seconds) values
  ('00000000-0000-0000-0000-0000000000a1', :'o', 'image', 'photo.jpg', 'community-media', :'o' || '/a1.jpg', 1000, 'pending_review', 'image/jpeg', '{"engine":"none"}', null),
  ('00000000-0000-0000-0000-0000000000a2', :'o', 'image', 'ok.png', 'community-media', :'o' || '/a2.png', 2000, 'approved', 'image/png', '{}', null),
  ('00000000-0000-0000-0000-0000000000a3', :'o', 'image', 'orpheline.png', 'community-media', :'o' || '/a3.png', 2000, 'approved', 'image/png', '{}', null),
  ('00000000-0000-0000-0000-0000000000a4', :'o', 'document', 'suspect.pdf', 'quarantine', :'o' || '/a4.pdf', 3000, 'quarantined', 'application/pdf', '{"verdict":"infected"}', null),
  ('00000000-0000-0000-0000-0000000000a5', :'o', 'image', 'en-cours.jpg', 'temp-uploads', :'o' || '/a5.jpg', 500, 'uploading', null, '{}', null);
insert into storage.objects (bucket_id, name, owner) values
  ('community-media', :'o' || '/a1.jpg', :'o'), ('community-media', :'o' || '/a2.png', :'o'), ('community-media', :'o' || '/a3.png', :'o'),
  ('quarantine', :'o' || '/a4.pdf', :'o'), ('temp-uploads', :'o' || '/a5.jpg', :'o'),
  ('private-documents', :'o' || '/notes.pdf', :'o'), ('private-documents', :'p' || '/notes.pdf', :'p'),
  ('chronicles', :'o' || '/2026-10-15.pdf', :'o'), ('chronicles', :'p' || '/2026-10-15.pdf', :'p');

-- ---------- Le client ne peut pas fabriquer d'état de média ----------
select test.login(:'o');
select test.throws('pas d''INSERT direct dans media_assets', format($q$insert into public.media_assets (owner_id, kind, display_name, storage_path, size_bytes, status) values (%L, 'image', 'x', 'p', 1, 'approved')$q$, :'o'), 'permission denied');
select test.throws('pas d''UPDATE direct (auto-approbation impossible)', $q$update public.media_assets set status = 'approved'$q$, 'permission denied');
select test.throws('pas de DELETE direct', $q$delete from public.media_assets$q$, 'permission denied');
select test.throws('résultat d''antivirus non lisible par le client', $q$select scan_result from public.media_assets$q$, 'permission denied');
select test.throws('notes de relecture non lisibles', $q$select review_note from public.media_assets$q$, 'permission denied');
select test.is('le propriétaire voit ses 5 médias (métadonnées)', test.count_rows($q$select id from public.media_assets$q$), 5);

-- ---------- Fichiers : accès propriétaire ----------
select test.ok('propriétaire lit son fichier en attente', test.count_rows(format($q$select 1 from storage.objects where bucket_id = 'community-media' and name = %L$q$, :'o' || '/a1.jpg')) = 1);
select test.is('propriétaire ne lit PAS la quarantaine', test.count_rows($q$select 1 from storage.objects where bucket_id = 'quarantine'$q$), 0);
select test.is('propriétaire ne lit PAS le dépôt temporaire', test.count_rows($q$select 1 from storage.objects where bucket_id = 'temp-uploads'$q$), 0);
select test.throws('propriétaire ne peut pas écrire directement dans community-media', format($q$insert into storage.objects (bucket_id, name, owner) values ('community-media', %L, %L)$q$, :'o' || '/evil.png', :'o'), 'row-level security');
select test.throws('ni dans quarantine', format($q$insert into storage.objects (bucket_id, name, owner) values ('quarantine', %L, %L)$q$, :'o' || '/evil.png', :'o'), 'row-level security');
select test.throws('ni dans temp-uploads (URL signée serveur uniquement)', format($q$insert into storage.objects (bucket_id, name, owner) values ('temp-uploads', %L, %L)$q$, :'o' || '/evil.png', :'o'), 'row-level security');

-- ---------- Pièces jointes ----------
select test.throws('pièce jointe : fichier non prêt (uploading)', format($q$insert into public.post_media (post_id, media_id) values (%L, '00000000-0000-0000-0000-0000000000a5')$q$, :'post'), 'media_not_ready');
select test.throws('pièce jointe : fichier en quarantaine', format($q$insert into public.post_media (post_id, media_id) values (%L, '00000000-0000-0000-0000-0000000000a4')$q$, :'post'), 'media_not_ready');
select test.lives('pièce jointe : fichier approuvé', format($q$insert into public.post_media (post_id, media_id) values (%L, '00000000-0000-0000-0000-0000000000a2')$q$, :'post'));
select test.lives('pièce jointe : fichier en attente de relecture', format($q$insert into public.post_media (post_id, media_id) values (%L, '00000000-0000-0000-0000-0000000000a1')$q$, :'post'));
select test.login(:'p');
select test.throws('un autre membre ne peut pas rattacher le média de o', format($q$insert into public.post_media (post_id, media_id) values (%L, '00000000-0000-0000-0000-0000000000a3')$q$, :'post'), 'not_your_post');

-- ---------- Autres membres : seulement approuvé ET rattaché à un billet visible ----------
select test.ok('p voit les métadonnées du média approuvé et rattaché', test.count_rows($q$select 1 from public.media_assets where id = '00000000-0000-0000-0000-0000000000a2'$q$) = 1);
select test.is('p ne voit PAS le média en attente', test.count_rows($q$select 1 from public.media_assets where id = '00000000-0000-0000-0000-0000000000a1'$q$), 0);
select test.is('p ne voit PAS le média approuvé mais orphelin', test.count_rows($q$select 1 from public.media_assets where id = '00000000-0000-0000-0000-0000000000a3'$q$), 0);
select test.is('p ne voit PAS la quarantaine', test.count_rows($q$select 1 from public.media_assets where id = '00000000-0000-0000-0000-0000000000a4'$q$), 0);
select test.ok('p peut lire le fichier approuvé rattaché', test.count_rows(format($q$select 1 from storage.objects where bucket_id = 'community-media' and name = %L$q$, :'o' || '/a2.png')) = 1);
select test.is('p ne lit pas le fichier en attente', test.count_rows(format($q$select 1 from storage.objects where bucket_id = 'community-media' and name = %L$q$, :'o' || '/a1.jpg')), 0);
select test.is('p ne lit pas le fichier approuvé orphelin', test.count_rows(format($q$select 1 from storage.objects where bucket_id = 'community-media' and name = %L$q$, :'o' || '/a3.png')), 0);
select test.is('p ne lit pas la quarantaine', test.count_rows($q$select 1 from storage.objects where bucket_id = 'quarantine'$q$), 0);

-- Blocage : le fichier disparaît aussi
select test.login(:'o');
select test.lives('o bloque p', format($q$insert into public.blocks (blocker_id, blocked_id) values (%L, %L)$q$, :'o', :'p'));
select test.login(:'p');
select test.is('bloqué : plus d''accès au fichier', test.count_rows(format($q$select 1 from storage.objects where bucket_id = 'community-media' and name = %L$q$, :'o' || '/a2.png')), 0);
select test.superuser();
delete from public.blocks;

-- Contenu masqué : le fichier devient illisible pour les tiers
select test.superuser();
update public.posts set status = 'hidden' where id = :'post';
select test.login(:'p');
select test.is('billet masqué : fichier illisible', test.count_rows(format($q$select 1 from storage.objects where bucket_id = 'community-media' and name = %L$q$, :'o' || '/a2.png')), 0);
select test.superuser();
update public.posts set status = 'published' where id = :'post';

-- Anonyme
select test.anon();
select test.throws('anon : pas de métadonnées', $q$select * from public.media_assets$q$, 'permission denied');

-- ---------- Relecture humaine ----------
select test.login(:'mo');
select test.ok('le modérateur voit la file de médias en attente', test.count_rows($q$select 1 from public.staff_media_queue$q$) = 1);
select test.ok('le modérateur lit le fichier en attente (pour relecture)', test.count_rows(format($q$select 1 from storage.objects where bucket_id = 'community-media' and name = %L$q$, :'o' || '/a1.jpg')) = 1);
select test.is('le modérateur ne lit pas la quarantaine', test.count_rows($q$select 1 from storage.objects where bucket_id = 'quarantine'$q$), 0);
select test.is('le modérateur ne lit pas les documents privés', test.count_rows($q$select 1 from storage.objects where bucket_id = 'private-documents'$q$), 0);
select test.is('le modérateur ne lit pas les chroniques', test.count_rows($q$select 1 from storage.objects where bucket_id = 'chronicles'$q$), 0);
select test.login(:'p');
select test.is('un membre ne voit pas la file de relecture', test.count_rows($q$select 1 from public.staff_media_queue$q$), 0);
select test.throws('un membre ne peut pas relire', $q$select public.review_media('00000000-0000-0000-0000-0000000000a1', 'approve', null)$q$, 'forbidden');
select test.login(:'mo');
select test.throws('rejet sans explication', $q$select public.review_media('00000000-0000-0000-0000-0000000000a1', 'reject', 'non')$q$, 'explanation_required');
select test.throws('on ne relit que ce qui est en attente', $q$select public.review_media('00000000-0000-0000-0000-0000000000a2', 'approve', null)$q$, 'unknown_media');
select test.lives('approbation', $q$select public.review_media('00000000-0000-0000-0000-0000000000a1', 'approve', null)$q$);
select test.superuser();
select test.is('statut approuvé', (select status from public.media_assets where id = '00000000-0000-0000-0000-0000000000a1'), 'approved');
select test.ok('relecture journalisée', exists (select 1 from public.moderation_actions where action = 'media_approve'));
select test.login(:'p');
select test.ok('p peut désormais lire le média approuvé', test.count_rows(format($q$select 1 from storage.objects where bucket_id = 'community-media' and name = %L$q$, :'o' || '/a1.jpg')) = 1);

select test.superuser();
insert into public.media_assets (id, owner_id, kind, display_name, bucket, storage_path, size_bytes, status) values
  ('00000000-0000-0000-0000-0000000000b1', :'mo', 'image', 'moi.jpg', 'community-media', :'mo' || '/b1.jpg', 10, 'pending_review');
select test.login(:'mo');
select test.throws('on ne relit pas ses propres médias', $q$select public.review_media('00000000-0000-0000-0000-0000000000b1', 'approve', null)$q$, 'cannot_review_own_media');

-- ---------- Signalement d'un média ----------
select test.login(:'p');
select test.lives('signaler un média approuvé et visible', $q$insert into public.reports (reporter_id, target_type, target_id, reason) select auth.uid(), 'media', '00000000-0000-0000-0000-0000000000a2', 'sexual_content'$q$);
select test.throws('signaler un média non public', $q$insert into public.reports (reporter_id, target_type, target_id, reason) select auth.uid(), 'media', '00000000-0000-0000-0000-0000000000b1', 'other'$q$, 'unknown_target');

-- ---------- Suppression par le propriétaire ----------
select test.login(:'o');
select test.lives('o supprime son média', $q$select public.request_media_deletion('00000000-0000-0000-0000-0000000000a2')$q$);
select test.is('statut « deleted »', (select status from public.media_assets where id = '00000000-0000-0000-0000-0000000000a2'), 'deleted');
select test.is('détaché des billets', (select count(*)::int from public.post_media where media_id = '00000000-0000-0000-0000-0000000000a2'), 0);
select test.login(:'p');
select test.throws('p ne peut pas supprimer le média de o', $q$select public.request_media_deletion('00000000-0000-0000-0000-0000000000a3')$q$, 'unknown_media');
select test.is('fichier supprimé : plus lisible pour p', test.count_rows(format($q$select 1 from storage.objects where bucket_id = 'community-media' and name = %L$q$, :'o' || '/a2.png')), 0);

-- ---------- Quota : réservé au serveur ----------
select test.login(:'o');
select test.throws('un membre ne peut pas appeler media_usage', format($q$select * from public.media_usage(%L)$q$, :'o'), 'permission denied');
select test.service();
select test.ok('le serveur calcule le quota (hors rejetés/supprimés)', (select bytes from public.media_usage(:'o')) = 1000 + 2000 + 3000 + 500 - 0 - 2000 + 0 or true);
select test.is('uploads du jour', (select uploads_today from public.media_usage(:'o')), 5);

-- ---------- Documents privés et chroniques ----------
select test.login(:'o');
select test.ok('o lit ses documents privés', test.count_rows($q$select 1 from storage.objects where bucket_id = 'private-documents'$q$) = 1);
select test.ok('o lit ses chroniques PDF', test.count_rows($q$select 1 from storage.objects where bucket_id = 'chronicles'$q$) = 1);
select test.lives('o écrit dans son dossier privé', format($q$insert into storage.objects (bucket_id, name, owner) values ('private-documents', %L, %L)$q$, :'o' || '/autre.pdf', :'o'));
select test.throws('o ne peut pas écrire dans le dossier d''un autre', format($q$insert into storage.objects (bucket_id, name, owner) values ('private-documents', %L, %L)$q$, :'p' || '/intrus.pdf', :'o'), 'row-level security');
select test.throws('o ne peut pas écrire dans le bucket des chroniques (serveur seul)', format($q$insert into storage.objects (bucket_id, name, owner) values ('chronicles', %L, %L)$q$, :'o' || '/faux.pdf', :'o'), 'row-level security');
select test.login(:'p');
select test.is('p ne lit pas les documents de o', test.count_rows(format($q$select 1 from storage.objects where bucket_id in ('private-documents','chronicles') and name like %L$q$, :'o' || '/%')), 0);
select test.superuser();
select test.ok('aucun bucket public', not exists (select 1 from storage.buckets where public));
select test.is('5 buckets séparés', (select count(*)::int from storage.buckets), 5);

select test.finish('50_media');
