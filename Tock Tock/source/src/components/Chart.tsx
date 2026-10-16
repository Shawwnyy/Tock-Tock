import type { DayPoint } from '../../supabase/functions/_shared/stats.ts';

interface Props {
  points: { label: string; value: number | null }[];
  height?: number;
  title: string;
}

/** Courbe SVG : les valeurs absentes (null) créent des TROUS dans la courbe, jamais des zéros. */
export function LineChart({ points, height = 180, title }: Props) {
  const W = 640, H = height, L = 30, R = 8, T = 10, B = 22;
  const n = Math.max(points.length, 1);
  const x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (1 - v / 10) * (H - T - B);
  const segments: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else cur.push({ x: x(i), y: y(p.value) });
  });
  if (cur.length) segments.push(cur);
  const hasData = points.some((p) => p.value !== null);
  const summary = hasData
    ? `${points.filter((p) => p.value !== null).length} jour(s) avec données sur ${points.length}.`
    : 'Aucune donnée sur cette période.';
  const step = Math.ceil(points.length / 6);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${summary}`} preserveAspectRatio="none">
        {[0, 5, 10].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className="grid" />
            <text x={L - 6} y={y(g) + 4} textAnchor="end" className="axis">{g}</text>
          </g>
        ))}
        {segments.map((s, i) =>
          s.length === 1 ? (
            <circle key={i} cx={s[0].x} cy={s[0].y} r={3.5} className="dot" />
          ) : (
            <polyline key={i} points={s.map((p) => `${p.x},${p.y}`).join(' ')} className="line" fill="none" />
          ),
        )}
        {points.map((p, i) => (p.value !== null ? <circle key={i} cx={x(i)} cy={y(p.value)} r={2.5} className="dot" /> : null))}
        {points.map((p, i) => (i % step === 0 ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="axis">{p.label}</text> : null))}
      </svg>
      <figcaption className="muted">{summary} Les jours sans bilan sont des vides, pas des zéros.</figcaption>
    </figure>
  );
}

export const seriesToPoints = (series: DayPoint[], pick: (p: DayPoint) => number | null) =>
  series.map((p) => ({ label: p.date.slice(5).replace('-', '/'), value: pick(p) }));
