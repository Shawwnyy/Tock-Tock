-- Planification (pg_cron + pg_net) — à exécuter UNE FOIS dans l'éditeur SQL de Supabase, APRÈS avoir déployé les fonctions
-- et défini le secret CRON_SECRET (voir docs/SETUP.md). Ce n'est volontairement PAS une migration : il contient des valeurs propres à votre projet.
-- Remplacez PROJECT_REF et CRON_SECRET (la même valeur que `supabase secrets set CRON_SECRET=...`).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Chroniques de minuit + rappels : toutes les 5 minutes (idempotent : relancer ne duplique rien).
select cron.schedule('tocktock-chronicles', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/scheduled-chronicles',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'CRON_SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 110000
  );
$$);

-- Maintenance quotidienne (échéances d'objectifs, purge des fichiers expirés) : 03:15 UTC.
select cron.schedule('tocktock-maintenance', '15 3 * * *', $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/maintenance',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'CRON_SECRET'),
    body := '{}'::jsonb
  );
$$);

-- Pour arrêter : select cron.unschedule('tocktock-chronicles'); select cron.unschedule('tocktock-maintenance');
