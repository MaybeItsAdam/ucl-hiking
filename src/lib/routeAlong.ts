import { haversineM } from "@/lib/gpx";

/**
 * Distance along a drawn route, measured the way `elevationProfile` measures
 * it (great-circle metres between consecutive points, via `haversineM`), so a
 * km on the elevation strip lands on the same stretch of the line.
 *
 * Segments are walked end to end: the jump from one segment's last point to
 * the next one's first counts for nothing.
 */

/** Cumulative km at each point, per segment; memoised per segments array. */
interface Measured {
  /** km along at each point of each segment. */
  at: number[][];
  total: number;
}

const measured = new WeakMap<[number, number][][], Measured>();

function measure(segments: [number, number][][]): Measured {
  const cached = measured.get(segments);
  if (cached) return cached;
  let along = 0;
  const at = segments.map((seg) =>
    seg.map((p, i) => {
      if (i) along += haversineM(seg[i - 1], p) / 1000;
      return along;
    }),
  );
  const result = { at, total: along };
  measured.set(segments, result);
  return result;
}

/** Total length in km of the route, segments joined end to end (no distance counted between segments). */
export function routeLengthKm(segments: [number, number][][]): number {
  return measure(segments).total;
}

/** The [lat, lng] point `km` along the route (clamped to 0..length), linearly interpolated; null for an empty route. */
export function pointAlong(segments: [number, number][][], km: number): [number, number] | null {
  const { at, total } = measure(segments);
  const target = Number.isFinite(km) ? Math.min(Math.max(km, 0), total) : 0;
  let last: [number, number] | null = null;
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    const kms = at[s];
    for (let i = 0; i < seg.length; i++) {
      if (kms[i] >= target) {
        if (i === 0) return [seg[0][0], seg[0][1]];
        const k0 = kms[i - 1];
        const t = kms[i] > k0 ? (target - k0) / (kms[i] - k0) : 0;
        const a = seg[i - 1];
        const b = seg[i];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      last = seg[i];
    }
  }
  return last ? [last[0], last[1]] : null;
}
