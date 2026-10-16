import type { ReactNode } from 'react';

// Rendu Markdown MINIMAL et sûr : titres (#, ##, ###), listes (- ), paragraphes et **gras**.
// Tout passe par React (échappement automatique) : aucun HTML brut, aucun lien généré depuis le texte.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

export function MdLite({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(<ul key={`u${out.length}`}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
      list = [];
    }
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (/^\s*[-*]\s+/.test(line)) list.push(line.replace(/^\s*[-*]\s+/, ''));
    else {
      flush();
      if (h) out.push(h[1].length === 1 ? <h3 key={out.length}>{inline(h[2])}</h3> : <h4 key={out.length}>{inline(h[2])}</h4>);
      else if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <>{out}</>;
}
