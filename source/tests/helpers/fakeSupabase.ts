// Faux Supabase en mémoire pour exécuter RÉELLEMENT le code des Edge Functions (sans Deno ni réseau).
// Il implémente assez de l'API (select/insert/update/upsert/delete, filtres, relations imbriquées, RPC, Storage, Auth)
// pour tester la logique de « collage ». Il n'applique PAS la RLS : celle-ci est testée sur un vrai PostgreSQL.
type Row = Record<string, any>;
const FK: Record<string, string> = { checkins: 'checkin_id', goals: 'goal_id' };

export function makeWorld(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(initial)) tables[k] = v.map((r) => ({ ...r }));
  const files = new Map<string, Uint8Array>();
  const calls: { rpc: { name: string; args: any }[]; deletedUsers: string[]; signed: string[] } = { rpc: [], deletedUsers: [], signed: [] };
  const tokens = new Map<string, { id: string; email: string }>();
  const usage = new Map<string, number>();
  const rpcOverrides: Record<string, (args: any) => any> = {};

  const tbl = (n: string) => (tables[n] ??= []);

  class Q {
    op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    filters: ((r: Row) => boolean)[] = [];
    payload: any;
    opts: any;
    cols = '*';
    ord?: { c: string; asc: boolean };
    lim?: number;
    mode: 'many' | 'single' | 'maybe' = 'many';
    returning = false;
    constructor(public name: string) {}
    select(cols = '*') { if (this.op === 'select') this.cols = cols; else this.returning = true; return this; }
    insert(p: any) { this.op = 'insert'; this.payload = p; return this; }
    update(p: any) { this.op = 'update'; this.payload = p; return this; }
    upsert(p: any, opts?: any) { this.op = 'upsert'; this.payload = p; this.opts = opts; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
    lt(c: string, v: any) { this.filters.push((r) => r[c] < v); return this; }
    gte(c: string, v: any) { this.filters.push((r) => r[c] >= v); return this; }
    in(c: string, v: any[]) { this.filters.push((r) => v.includes(r[c])); return this; }
    is(c: string, v: any) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
    not(c: string, _op: string, v: any) { this.filters.push((r) => (v === null ? r[c] != null : r[c] !== v)); return this; }
    or(expr: string) {
      const parts = expr.split(',').map((p) => p.split('.'));
      this.filters.push((r) => parts.some(([c, , v]) => String(r[c]) === v));
      return this;
    }
    order(c: string, o?: { ascending?: boolean }) { this.ord = { c, asc: o?.ascending !== false }; return this; }
    limit(n: number) { this.lim = n; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    private match() { return tbl(this.name).filter((r) => this.filters.every((f) => f(r))); }
    private embed(rows: Row[]) {
      const rels = [...this.cols.matchAll(/([a-z_]+)\(([^)]*)\)/g)].map((m) => m[1]);
      return rows.map((r) => {
        const out = { ...r };
        for (const rel of rels) out[rel] = tbl(rel).filter((c) => c[FK[this.name]] === r.id).map((c) => ({ ...c }));
        return out;
      });
    }
    private run(): { data: any; error: any } {
      let rows: Row[];
      if (this.op === 'insert') {
        rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: Row) => ({ id: p.id ?? crypto.randomUUID(), ...p }));
        tbl(this.name).push(...rows);
      } else if (this.op === 'upsert') {
        const keys: string[] = (this.opts?.onConflict ?? 'id').split(',');
        rows = [];
        for (const p of Array.isArray(this.payload) ? this.payload : [this.payload]) {
          const ex = tbl(this.name).find((r) => keys.every((k) => r[k] === p[k]));
          if (ex) { if (!this.opts?.ignoreDuplicates) Object.assign(ex, p); rows.push(ex); }
          else { const n = { id: p.id ?? crypto.randomUUID(), ...p }; tbl(this.name).push(n); rows.push(n); }
        }
      } else if (this.op === 'update') {
        rows = this.match(); rows.forEach((r) => Object.assign(r, this.payload));
      } else if (this.op === 'delete') {
        rows = this.match(); tables[this.name] = tbl(this.name).filter((r) => !rows.includes(r));
      } else {
        rows = this.match();
        if (this.ord) { const { c, asc } = this.ord; rows = [...rows].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1)); }
        if (this.lim !== undefined) rows = rows.slice(0, this.lim);
        rows = this.embed(rows);
      }
      if (this.op !== 'select' && !this.returning) return { data: null, error: null };
      if (this.mode === 'single') return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows', code: 'PGRST116' } };
      if (this.mode === 'maybe') return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }
    then(res: (v: any) => any, rej?: (e: any) => any) { try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
  }

  const rpcs: Record<string, (a: any) => any> = {
    bump_usage: (a) => { const k = `${a.p_user}:${a.p_kind}`; const n = (usage.get(k) ?? 0) + 1; usage.set(k, n); return n <= a.p_limit; },
    claim_chronicle_delivery: (a) => {
      const ex = tbl('chronicle_deliveries').find((d) => d.user_id === a.p_user && d.chronicle_date === a.p_date && d.channel === a.p_channel);
      if (!ex) { tbl('chronicle_deliveries').push({ id: crypto.randomUUID(), user_id: a.p_user, chronicle_date: a.p_date, channel: a.p_channel, status: 'processing', attempts: 1 }); return true; }
      if (ex.status === 'failed' && ex.attempts < 3) { ex.status = 'processing'; ex.attempts++; return true; }
      return false;
    },
    finish_chronicle_delivery: (a) => {
      const ex = tbl('chronicle_deliveries').find((d) => d.user_id === a.p_user && d.chronicle_date === a.p_date && d.channel === a.p_channel);
      if (ex) Object.assign(ex, { status: a.p_status, last_error: a.p_error ?? null, provider_message_id: a.p_message_id ?? null });
      return null;
    },
    media_usage: () => [{ bytes: 0, uploads_today: 0 }],
    enqueue_goal_due_notifications: () => 0,
    create_notification_for_user: (a) => { tbl('notifications').push({ user_id: a.p_user, kind: a.p_kind, payload: a.p_payload }); return null; },
  };

  const storage = {
    from: (bucket: string) => ({
      download: async (path: string) => { const b = files.get(`${bucket}/${path}`); return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: 'not found' } }; },
      upload: async (path: string, bytes: Uint8Array) => { if (files.has(`${bucket}/${path}`) && false) return { error: { message: 'exists' } }; files.set(`${bucket}/${path}`, bytes); return { data: { path }, error: null }; },
      remove: async (paths: string[]) => { paths.forEach((p) => files.delete(`${bucket}/${p}`)); return { data: [], error: null }; },
      createSignedUploadUrl: async (path: string) => { calls.signed.push(`${bucket}/${path}`); return { data: { signedUrl: `https://x/${path}`, token: 'upload-token', path }, error: null }; },
      list: async (prefix: string) => ({ data: [...files.keys()].filter((k) => k.startsWith(`${bucket}/${prefix}/`)).map((k) => ({ name: k.slice(`${bucket}/${prefix}/`.length) })), error: null }),
    }),
  };

  const client = {
    from: (n: string) => new Q(n),
    rpc: async (name: string, args: any = {}) => { calls.rpc.push({ name, args }); const h = rpcOverrides[name] ?? rpcs[name]; return { data: h ? h(args) : null, error: null }; },
    storage,
    auth: {
      getUser: async (token: string) => { const u = tokens.get(token); return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }; },
      admin: {
        getUserById: async (id: string) => { const u = [...tokens.values()].find((x) => x.id === id); return { data: { user: u ?? null }, error: null }; },
        deleteUser: async (id: string) => { calls.deletedUsers.push(id); return { error: null }; },
      },
    },
  };
  return { client, tables, files, calls, tokens, rpcOverrides, usage };
}
export type World = ReturnType<typeof makeWorld>;
