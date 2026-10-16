-- Helpers de test dépendant du schéma applicatif.
-- Crée un membre complètement « onboardé » (règles acceptées, pseudonyme, âge déclaré).
create or replace function test.onboard(p_uid uuid, p_name text, p_age text default '18_plus') returns void language plpgsql as $$
begin
  reset role;
  insert into public.rules_acceptances (user_id, document_id)
    select p_uid, d.id from public.legal_documents d
    where d.published_at = (select max(x.published_at) from public.legal_documents x where x.kind = d.kind and x.published_at <= now())
    on conflict do nothing;
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
  perform public.complete_onboarding(p_name, p_age, 'Europe/Paris');
  perform set_config('request.jwt.claim.sub', '', false);
end $$;

create or replace function test.member(p_email text, p_name text, p_age text default '18_plus') returns uuid language plpgsql as $$
declare v uuid := test.make_user(p_email);
begin
  perform test.onboard(v, p_name, p_age);
  return v;
end $$;

create or replace function test.staff(p_email text, p_name text, p_role text) returns uuid language plpgsql as $$
declare v uuid := test.member(p_email, p_name);
begin
  insert into public.staff_roles (user_id, role) values (v, p_role);
  return v;
end $$;
