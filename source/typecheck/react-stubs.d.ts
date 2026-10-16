// Types MINIMAUX de remplacement pour vérifier le code sans @types/react (non installables ici).
// Le vrai projet utilise @types/react via package.json ; ces stubs sont volontairement permissifs.
declare module 'react' {
  export type ReactNode = any;
  export type FormEvent = any;
  export type ButtonHTMLAttributes<T> = any;
  export function useState<S>(init: S | (() => S)): [S, (v: S | ((p: S) => S)) => void];
  export function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
  export function useMemo<T>(fn: () => T, deps: unknown[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: unknown[]): T;
  export function useRef<T>(v: T): { current: T };
  export function useRef<T>(v: T | null): { current: T | null };
  export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T): T;
  export interface Context<T> { Provider: any; __t?: T }
  export function createContext<T>(v: T): Context<T>;
  export function useContext<T>(c: Context<T>): T;
  export const StrictMode: any;
  export default any;
}
declare module 'react/jsx-runtime' {
  export const jsx: any; export const jsxs: any; export const Fragment: any;
  export namespace JSX { interface IntrinsicElements { [k: string]: { [a: string]: any; onChange?: (e: any) => void; onClick?: (e: any) => void; onSubmit?: (e: any) => void; onKeyDown?: (e: any) => void } } interface IntrinsicAttributes { key?: any } interface Element {} interface ElementChildrenAttribute { children: {} } }
}
declare module 'react-dom/client' { export function createRoot(el: any): { render(n: any): void }; }
declare module '*.css' {}
