import { cumulative, pointAlong } from "@/lib/geo";
import type { LonLat, Route, Stop } from "@/lib/types";

const W = 1000;
const PAD = 44;

/**
 * A quiet schematic of the drive: the route, the ideal stop points, and the places each path
 * picked (filled for direct, ringed for the agent). Drawn from the route geometry alone, so it
 * works without map tiles or a browser key.
 */
/** Keep end labels inside the frame. */
const anchor = (x: number) => (x > W * 0.85 ? "end" : x < W * 0.15 ? "start" : "middle");

export function RouteMap({ route, direct, agent }: { route: Route; direct: Stop[]; agent: Stop[] }) {
  const lats = route.line.map((p) => p[1]);
  const mid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const k = Math.cos((mid * Math.PI) / 180);
  const xs = route.line.map((p) => p[0] * k);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...lats), Math.max(...lats)];
  // Height follows the route's shape, within limits, so a long east-west drive is not lost in white space.
  const H = Math.round(Math.min(440, Math.max(220, ((y1 - y0) / (x1 - x0 || 1)) * (W - PAD * 2) + PAD * 2 + 40)));
  const scale = Math.min((W - PAD * 2) / (x1 - x0 || 1), (H - PAD * 2) / (y1 - y0 || 1));
  const ox = (W - (x1 - x0) * scale) / 2;
  const oy = (H - (y1 - y0) * scale) / 2;
  const xy = ([lon, lat]: LonLat) => [ox + (lon * k - x0) * scale, H - (oy + (lat - y0) * scale)] as const;
  const d = route.line.map((p, i) => `${i ? "L" : "M"}${xy(p)[0].toFixed(1)},${xy(p)[1].toFixed(1)}`).join("");

  const cum = cumulative(route.line);
  const total = cum[cum.length - 1];
  const stops = (direct.length ? direct : agent).map((s) => ({ n: s.n, at: xy(pointAlong(route.line, cum, (s.targetMinutes * 60 * total) / route.durationS)) }));
  const [a, b] = [xy(route.line[0]), xy(route.line[route.line.length - 1])];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Route from ${route.from.label} to ${route.to.label} with ${stops.length} planned stops`}>
      <path d={d} fill="none" stroke="var(--line)" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="var(--road)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      {agent.flatMap((s) => s.picks).map((p) => {
        const [x, y] = xy(p.place.at);
        return <circle key={`a-${p.place.id}`} cx={x} cy={y} r={7} fill="none" stroke="var(--agent)" strokeWidth={2} />;
      })}
      {direct.flatMap((s) => s.picks).map((p) => {
        const [x, y] = xy(p.place.at);
        return <circle key={`d-${p.place.id}`} cx={x} cy={y} r={3.5} fill="var(--direct)" />;
      })}
      {stops.map((s) => (
        <g key={s.n} transform={`translate(${s.at[0]},${s.at[1] - 26})`}>
          <circle r={11} fill="var(--ink)" />
          <text textAnchor="middle" dy="0.35em" fontSize={12} fontWeight={600} fill="var(--paper)">{s.n}</text>
        </g>
      ))}
      <circle cx={a[0]} cy={a[1]} r={6} fill="var(--paper)" stroke="var(--ink)" strokeWidth={2.5} />
      <circle cx={b[0]} cy={b[1]} r={6} fill="var(--ink)" />
      <text x={a[0]} y={a[1] + 26} textAnchor={anchor(a[0])} fontSize={13} fill="var(--mute)">{route.from.label}</text>
      <text x={b[0]} y={b[1] + 26} textAnchor={anchor(b[0])} fontSize={13} fill="var(--mute)">{route.to.label}</text>
    </svg>
  );
}
