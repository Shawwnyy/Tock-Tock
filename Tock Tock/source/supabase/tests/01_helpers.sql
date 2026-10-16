-- Mini-framework d'assertions (aucune extension requise, pas de pgTAP).
-- Les résultats sont comptés dans des GUC de session, lisibles quel que soit le rôle courant.

create schema if not exists test;
grant usage on schema test to public;

create or replace function test._inc(p_name text) returns void language plpgsql as $$
begin
  perform set_config(p_name, (coalesce(nullif(current_setting(p_name, true), ''), '0')::int + 1)::text, false);
end $$;

create or replace function test.ok(p_desc text, p_cond boolean) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then
    perform test._inc('test.pass');
  else
    perform test._inc('test.fail');
    raise warning 'ÉCHEC : %', p_desc;
  end if;
end $$;

create or replace function test.is(p_desc text, p_actual anyelement, p_expected anyelement) returns void language plpgsql as $$
begin
  if p_actual is not distinct from p_expected then
    perform test._inc('test.pass');
  else
    perform test._inc('test.fail');
    raise warning 'ÉCHEC : % — obtenu [%], attendu [%]', p_desc, p_actual, p_expected;
  end if;
end $$;

-- Vérifie qu'une instruction échoue (message contenant p_pattern, ou SQLSTATE).
create or replace function test.throws(p_desc text, p_sql text, p_pattern text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_pattern is null or sqlerrm ilike '%' || p_pattern || '%' or sqlstate = p_pattern then
      perform test._inc('test.pass');
    else
      perform test._inc('test.fail');
      raise warning 'ÉCHEC : % — erreur inattendue [%] (%), attendu [%]', p_desc, sqlerrm, sqlstate, p_pattern;
    end if;
    return;
  end;
  perform test._inc('test.fail');
  raise warning 'ÉCHEC : % — aucune erreur levée', p_desc;
end $$;

-- Vérifie qu'une instruction réussit.
create or replace function test.lives(p_desc text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform test._inc('test.pass');
  exception when others then
    perform test._inc('test.fail');
    raise warning 'ÉCHEC : % — erreur [%] (%)', p_desc, sqlerrm, sqlstate;
  end;
end $$;

-- Exécute une requête et renvoie le nombre de lignes (sous le rôle courant, donc soumis à la RLS).
create or replace function test.count_rows(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute 'select count(*) from (' || p_sql || ') q' into n;
  return n;
end $$;

-- Exécute une instruction DML et renvoie le nombre de lignes touchées (sous le rôle courant, donc soumis à la RLS).
create or replace function test.affected(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- Change d'identité : se comporte comme une requête PostgREST authentifiée.
create or replace function test.login(p_uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  execute 'set role authenticated';
end $$;

create or replace function test.anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'anon', false);
  execute 'set role anon';
end $$;

create or replace function test.service() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
  execute 'set role service_role';
end $$;

create or replace function test.superuser() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);
end $$;

create or replace function test.finish(p_suite text) returns void language plpgsql as $$
declare p int := coalesce(nullif(current_setting('test.pass', true), ''), '0')::int;
        f int := coalesce(nullif(current_setting('test.fail', true), ''), '0')::int;
begin
  reset role;
  raise notice '[%] % réussis, % échoués', p_suite, p, f;
  perform set_config('test.pass', '0', false);
  perform set_config('test.fail', '0', false);
  if f > 0 then
    raise exception 'La suite % a % échec(s)', p_suite, f;
  end if;
end $$;

-- Crée un utilisateur de test (déclenche la création du profil) et renvoie son uuid.
create or replace function test.make_user(p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v, p_email);
  return v;
end $$;

create or replace function test.debug_note(p text) returns void language plpgsql as $$ begin raise notice 'DEBUG: %', p; end $$;
