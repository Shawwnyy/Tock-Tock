// Déclarations MINIMALES pour vérifier les types hors Deno/npm (environnement sans accès au registre).
// En vrai projet, les types viennent de @supabase/supabase-js et de Deno.
declare const Deno: { env: { get(k: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void };
declare module '@supabase/supabase-js' {
  // deno-lint-ignore no-explicit-any
  export function createClient(url: string, key: string, opts?: any): any;
  export type SupabaseClient = any;
  export type Session = any;
}
