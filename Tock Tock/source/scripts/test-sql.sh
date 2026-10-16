#!/usr/bin/env bash
# Exécute les migrations + les tests SQL/RLS sur un vrai PostgreSQL.
#
# Deux modes :
#   1) TEST_DATABASE_URL défini  -> utilise cette base (ELLE SERA VIDÉE ; le nom doit contenir « test »).
#      ex. docker run -d -p 54329:5432 -e POSTGRES_PASSWORD=pw postgres:16
#          TEST_DATABASE_URL=postgresql://postgres:pw@localhost:54329/postgres_test npm run test:sql
#   2) sinon -> lance un cluster PostgreSQL temporaire (initdb) si les binaires sont disponibles.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
TESTS="$ROOT/supabase/tests"
CLEANUP=""
trap 'eval "$CLEANUP"' EXIT

psqlx() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  case "$TEST_DATABASE_URL" in *test*) ;; *) echo "Refus : le nom de la base doit contenir « test »." >&2; exit 2;; esac
  export PGCONNECT_TIMEOUT=10
  CONN=("$TEST_DATABASE_URL")
  psqlx "$TEST_DATABASE_URL" -c "drop schema if exists public cascade; create schema public; drop schema if exists private cascade; drop schema if exists test cascade; drop schema if exists auth cascade; drop schema if exists storage cascade;" >/dev/null
else
  PGBIN=""
  if command -v initdb >/dev/null 2>&1; then PGBIN="$(dirname "$(command -v initdb)")"; fi
  if [ -z "$PGBIN" ]; then PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"; fi
  if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/initdb" ]; then
    echo "PostgreSQL introuvable. Installez PostgreSQL >= 15 ou fournissez TEST_DATABASE_URL (voir l'en-tête du script)." >&2
    exit 2
  fi
  TMP="$(mktemp -d)"
  RUN=()
  if [ "$(id -u)" = "0" ]; then chown postgres "$TMP"; RUN=(runuser -u postgres --); fi
  CLEANUP='"${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
  "${RUN[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
  "${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -w -l "$TMP/log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$TMP' -c fsync=off -c synchronous_commit=off -c max_connections=100" start >/dev/null
  export PGHOST="$TMP" PGUSER=postgres
  "$PGBIN/createdb" tocktock_test
  export PGDATABASE=tocktock_test
  CONN=()
fi

run_file() { psqlx "${CONN[@]}" -f "$1" >/dev/null; }

echo "→ Compatibilité Supabase (rôles, auth, storage)"
run_file "$TESTS/00_stubs.sql"
run_file "$TESTS/01_helpers.sql"

echo "→ Migrations"
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  echo "   $(basename "$f")"
  run_file "$f"
done

echo "→ Tests"
for f in $(ls "$TESTS"/sql/*.sql | sort); do
  echo "   $(basename "$f")"
  run_file "$f"
done

# Test de concurrence : vrais processus parallèles qui créent des comptes en même temps.
echo "→ Concurrence des identifiants publics (8 processus × 25 comptes)"
for p in 1 2 3 4 5 6 7 8; do
  ( for i in $(seq 1 25); do
      psqlx "${CONN[@]}" -c "insert into auth.users(email) values ('conc-$p-$i@example.test')" >/dev/null
    done ) &
done
wait
psqlx "${CONN[@]}" -t -A -c "
  select case when count(*) = 200 and count(distinct handle) = 200 and count(distinct public_number) = 200
              then 'OK : 200 comptes, 200 identifiants distincts'
              else 'ÉCHEC : ' || count(*) || ' comptes, ' || count(distinct handle) || ' identifiants distincts' end
  from public.profiles p join auth.users u on u.id = p.id where u.email like 'conc-%@example.test'" | tee /tmp/tock_conc.txt
grep -q '^OK' /tmp/tock_conc.txt || { echo "Concurrence en échec" >&2; exit 1; }

if command -v python3 >/dev/null 2>&1; then
  echo "→ Cohérence code ↔ schéma (tables, colonnes, RPC, privilèges)"
  python3 "$ROOT/scripts/check_queries.py" "${CONN[@]}"
fi

echo "✔ Tous les tests SQL sont passés."
