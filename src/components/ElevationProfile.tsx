import { formatKm } from "@/lib/eventDetails";

/**
 * The walk's height along its length: a filled line on a hairline grid, the
 * way a printed route card draws it. Pure SVG, so it prints and costs nothing.
 */
export function ElevationProfile({ profile }: { profile: [number, number][] }) {
  if (profile.length < 2) return null;
  const W = 600;
  const H = 96;
  const total = profile[profile.length - 1][0];
  const heights = profile.map((p) => p[1]);
  const lo = Math.min(...heights);
  const hi = Math.max(...heights);
  // At least 60 m of range, so a flat walk looks flat rather than jagged.
  const span = Math.max(hi - lo, 60);
  const floor = lo - (span - (hi - lo)) / 2;
  const x = (km: number) => (km / total) * W;
  const y = (m: number) => H - 6 - ((m - floor) / span) * (H - 14);
  const line = profile.map(([km, m], i) => `${i ? "L" : "M"}${x(km).toFixed(1)},${y(m).toFixed(1)}`).join("");
  const highest = profile.reduce((a, b) => (b[1] > a[1] ? b : a));

  return (
    <figure className="elevation">
      <figcaption className="elevation-labels">
        <span>Elevation</span>
        <span>
          {lo} – {hi} m · high point {formatKm(highest[0])} in
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Height along the walk, from ${lo} to ${hi} metres`}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} className="elevation-grid" x1={W * f} x2={W * f} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
        ))}
        <path className="elevation-fill" d={`${line}L${W},${H}L0,${H}Z`} />
        <path className="elevation-line" d={line} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="elevation-axis" aria-hidden="true">
        <span>0</span>
        <span>{formatKm(total)}</span>
      </div>
    </figure>
  );
}
