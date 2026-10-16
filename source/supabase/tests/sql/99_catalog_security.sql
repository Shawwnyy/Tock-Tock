-- Garde-fous globaux : empêchent qu'un oubli futur (table sans RLS, fonction exposée…) passe inaperçu.
\set ON_ERROR_STOP on
select test.superuser();

select test.ok('TOUTES les tables du schéma public ont la RLS activée',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity));

select test.is('anon n''a aucun droit sur les tables / vues publiques',
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'), 0);

select test.is('anon n''a aucun droit sur les séquences publiques',
  (select count(*)::int from information_schema.role_usage_grants where object_schema = 'public' and grantee = 'anon' and object_type = 'SEQUENCE'), 0);

select test.ok('toute fonction SECURITY DEFINER fixe son search_path',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'private') and p.prosecdef
                and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')));

-- Seules ces fonctions sont exposées par l'API (schéma public). Toute nouvelle fonction doit être ajoutée ici
-- après réflexion sur ses droits.
select test.is('liste exacte des RPC publiques',
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'),
  array['accept_rules','act_on_report','add_ticket_message','apply_sanction','bump_usage','check_text','claim_chronicle_delivery','close_my_ticket','complete_onboarding',
        'create_notification_for_user','create_ticket','deactivate_account','decide_appeal','enqueue_goal_due_notifications','export_my_data',
        'finish_chronicle_delivery','grant_staff_role','media_usage','moderate_content','reactivate_account','request_media_deletion',
        'restore_default_indicators','review_media','revoke_sanction','revoke_staff_role','search_members','set_avatar_preset',
        'set_display_name','set_resource_progress','staff_reply_ticket','staff_set_ticket_status']::text[]);

select test.is('anon ne peut exécuter AUCUNE RPC publique',
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'EXECUTE')), 0);

select test.is('fonctions réservées au serveur : aucun membre ne peut les exécuter',
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('bump_usage','claim_chronicle_delivery','finish_chronicle_delivery','media_usage',
                                                  'enqueue_goal_due_notifications','create_notification_for_user')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')), 0);

select test.is('anon n''a aucun accès au schéma private', has_schema_privilege('anon', 'private', 'USAGE'), false);

-- Politiques « ouvertes » (using true / with check true) : liste blanche explicite.
select test.is('politiques ouvertes = liste blanche',
  (select array_agg(tablename || '.' || policyname order by tablename, policyname) from pg_policies
    where schemaname in ('public', 'storage') and (qual = 'true' or with_check = 'true')),
  array['allowed_link_domains.allowed_link_domains_select','app_config.app_config_select','indicator_category_templates.category_templates_select',
        'indicator_templates.templates_select','post_categories.post_categories_select','post_media.post_media_insert']::text[]);

-- Tables privées : aucune politique ne mentionne un rôle du personnel.
select test.ok('aucune permission du personnel ne touche aux données privées',
  not exists (select 1 from pg_policies where tablename in ('checkins','checkin_answers','goals','goal_steps','goal_events','chronicles',
     'chronicle_deliveries','indicators','indicator_categories','chat_messages','chat_conversations','profile_settings')
     and (qual ~ 'has_permission' or with_check ~ 'has_permission')));

select test.ok('aucun bucket public', not exists (select 1 from storage.buckets where public));

select test.finish('99_catalog_security');
