import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Routage minimal par « # » : fonctionne tel quel sur GitHub Pages (aucune redirection serveur nécessaire).
function current(): string {
  const raw = typeof window === 'undefined' ? '/' : window.location.hash.replace(/^#/, '');
  return raw.startsWith('/') ? raw.split('?')[0] : '/';
}

const Ctx = createContext<string>('/');

export function RouterProvider({ children, initial }: { children: ReactNode; initial?: string }) {
  const [path, setPath] = useState(initial ?? current());
  useEffect(() => {
    const on = () => setPath(current());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return <Ctx.Provider value={path}>{children}</Ctx.Provider>;
}

export const usePath = () => useContext(Ctx);

export function navigate(to: string) {
  window.location.hash = to;
}

export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string; 'aria-current'?: 'page' | undefined }) {
  return (
    <a href={`#${to}`} className={className} {...rest}>
      {children}
    </a>
  );
}
