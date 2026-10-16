#!/usr/bin/env python3
"""Vérifie que les requêtes écrites dans le code (interface + Edge Functions) correspondent AU SCHÉMA RÉEL des migrations :
tables, colonnes sélectionnées/filtrées/écrites, fonctions RPC et noms de paramètres, et — pour l'interface, qui s'exécute avec
le rôle « authenticated » — les privilèges par colonne (un « select('*') » échoue si une colonne n'est pas accordée).
Usage : python3 scripts/check_queries.py [URL_POSTGRES]   (sinon variables PGHOST/PGUSER/PGDATABASE ; appelé par scripts/test-sql.sh)
Limites : analyse textuelle (expressions régulières), pas un vrai parseur TypeScript ; elle ignore les requêtes construites dynamiquement.
"""
import pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONN = sys.argv[1:2]

def psql(sql):
    r = subprocess.run(['psql', '-X', '-q', '-At', '-F', '|', *CONN, '-c', sql], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('psql: ' + r.stderr)
    return [l for l in r.stdout.splitlines() if l]

cols, sel, ins, upd = {}, {}, {}, {}
for t, c, s, i, u in (l.split('|') for l in psql(
    "select c.table_name, c.column_name, has_column_privilege('authenticated', format('public.%I', c.table_name)::regclass, c.column_name, 'select'),"
    " has_column_privilege('authenticated', format('public.%I', c.table_name)::regclass, c.column_name, 'insert'),"
    " has_column_privilege('authenticated', format('public.%I', c.table_name)::regclass, c.column_name, 'update')"
    " from information_schema.columns c where c.table_schema = 'public'")):
    cols.setdefault(t, set()).add(c)
    sel.setdefault(t, {})[c] = s == 't'; ins.setdefault(t, {})[c] = i == 't'; upd.setdefault(t, {})[c] = u == 't'
rpcs = {}
for name, args in (l.split('|') for l in psql("select proname, coalesce(array_to_string(proargnames, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")):
    rpcs.setdefault(name, set()).update(a for a in args.split(',') if a)

problems = []
def bad(f, msg):
    problems.append(f'{f}: {msg}')

def split_top(s):
    out, depth, cur = [], 0, ''
    for ch in s:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur.strip()); cur = ''
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out

def check_select(f, table, spec, as_user):
    for part in split_top(spec):
        m = re.match(r'^(?:(\w+):)?(\w+)(?:!\w+)?\((.*)\)$', part, re.S)
        if m:  # relation imbriquée
            rel = m.group(2)
            if rel not in cols:
                bad(f, f"relation inconnue « {rel} » dans select de {table}")
            else:
                check_select(f, rel, m.group(3), as_user)
            continue
        c = part.split(':')[-1].strip()
        if c == '*':
            if as_user and not all(sel[table].values()):
                missing = [k for k, v in sel[table].items() if not v]
                bad(f, f"select('*') sur « {table} » : le rôle authenticated n'a pas le droit de lire {missing}")
        elif c not in cols[table]:
            bad(f, f"colonne inconnue « {table}.{c} » (select)")
        elif as_user and not sel[table][c]:
            bad(f, f"« {table}.{c} » : lecture non accordée au rôle authenticated")

def obj_keys(text, start):
    """Clés de premier niveau de l'objet littéral commençant à text[start] == '{'."""
    depth, keys, i, prev = 0, [], start, ''
    buf = ''
    while i < len(text):
        ch = text[i]
        if ch in '{([':
            depth += 1
            if depth == 1:
                i += 1; prev = '{'; continue
        elif ch in '})]':
            depth -= 1
            if depth == 0:
                break
        if depth == 1:
            m = re.match(r'\s*(\.\.\.)?\s*(\w+)\s*(:|,|\}|$)', text[i:]) if prev in '{,' else None
            if m and not m.group(1):
                keys.append(m.group(2)); i += m.end() - (1 if m.group(3) in ',}' else 0); prev = ':' ; continue
            if ch == ',':
                prev = ','
            elif not ch.isspace():
                prev = prev if prev == ':' else 'x'
        i += 1
    return keys

files = [(p, True) for p in (ROOT / 'src').rglob('*.ts*')] + [(p, False) for p in (ROOT / 'supabase/functions').rglob('*.ts')]
n_checked = 0
for path, as_user in files:
    text = path.read_text()
    rel = str(path.relative_to(ROOT))
    for m in re.finditer(r"\.from\('(\w+)'\)", text):
        table = m.group(1)
        if table not in cols:
            if re.search(r"storage\.$", text[max(0, m.start() - 8):m.start()]):
                continue
            bad(rel, f"table/vue inconnue « {table} »"); continue
        chain = text[m.end(): m.end() + 900]
        end = re.search(r';|\.from\(', chain)
        chain = chain[: end.start()] if end else chain
        n_checked += 1
        sm = re.search(r"\.select\('([^']*)'", chain)
        if sm:
            check_select(rel, table, sm.group(1), as_user)
        for fm in re.finditer(r"\.(?:eq|neq|lt|lte|gt|gte|in|is|not|order|textSearch)\('(\w+)'", chain):
            if fm.group(1) not in cols[table]:
                bad(rel, f"colonne inconnue « {table}.{fm.group(1)} » (filtre)")
        for om in re.finditer(r"\.(insert|update|upsert)\(\s*(?=\{)", chain):
            kind = om.group(1)
            for k in obj_keys(chain, om.end()):
                if k not in cols[table]:
                    bad(rel, f"colonne inconnue « {table}.{k} » ({kind})")
                elif as_user:
                    ok = (ins if kind == 'insert' else upd if kind == 'update' else None)
                    if kind == 'upsert':
                        if not (ins[table][k] and upd[table][k]):
                            bad(rel, f"« {table}.{k} » : upsert non permis pour authenticated")
                    elif not ok[table][k]:
                        bad(rel, f"« {table}.{k} » : {kind} non accordé au rôle authenticated")
    for m in re.finditer(r"\.rpc\('(\w+)'(?:\s*,\s*(\{))?", text):
        name = m.group(1)
        if name not in rpcs:
            bad(rel, f"fonction RPC inconnue « {name} »"); continue
        if m.group(2):
            for k in obj_keys(text, m.end() - 1):
                if k not in rpcs[name]:
                    bad(rel, f"RPC « {name} » : paramètre inconnu « {k} » (attendus : {sorted(rpcs[name])})")

print(f'check_queries : {n_checked} requêtes analysées')
if problems:
    print('PROBLÈMES :')
    for p in sorted(set(problems)):
        print('  ✘', p)
    sys.exit(1)
print('✔ Toutes les requêtes analysées correspondent au schéma et aux privilèges.')
