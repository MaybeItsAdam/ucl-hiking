import { haversineM, summarise, type StoredRoute, type TrackPoint } from "@/lib/gpx";

/**
 * Heights for a route whose file has none. OS Maps exports bare lat/lng, so
 * without this no club route gets an elevation strip or a climb figure.
 *
 * Open-Meteo's elevation API: free, no key, Copernicus 90 m terrain, up to 100
 * points a request. Sampled every 50 m (finer adds nothing at 90 m) and filled
 * in between, so a day's walk costs a handful of requests at attach time.
 */

const ENDPOINT = "https://api.open-meteo.com/v1/elevation";
const BATCH = 100;
const MAX_LOOKUPS = 1000;
const SPACING_M = 50;
const TIMEOUT_MS = 8_000;

/** Heights in metres for each [lat, lng], in order. */
export type HeightLookup = (points: [number, number][]) => Promise<number[]>;

export async function openMeteoHeights(points: [number, number][]): Promise<number[]> {
  const batches: [number, number][][] = [];
  for (let i = 0; i < points.length; i += BATCH) batches.push(points.slice(i, i + BATCH));
  const results = await Promise.all(
    batches.map(async (batch) => {
      const url = `${ENDPOINT}?latitude=${batch.map((p) => p[0]).join(",")}&longitude=${batch.map((p) => p[1]).join(",")}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Open-Meteo elevation: HTTP ${res.status}`);
      const body = (await res.json()) as { elevation?: unknown };
      const heights = body.elevation;
      if (!Array.isArray(heights) || heights.length !== batch.length || !heights.every((h) => typeof h === "number" && Number.isFinite(h))) {
        throw new Error("Open-Meteo elevation: unexpected reply");
      }
      return heights as number[];
    }),
  );
  return results.flat();
}

/** Does the route already carry heights from its file? */
function hasHeights(route: StoredRoute): boolean {
  return route.summary.ascentM !== null;
}

/**
 * The route with a height on every point, looked up when the file had none.
 * Never throws: if the lookup fails the route is kept as it came, without heights.
 */
export async function withHeights(route: StoredRoute, lookup: HeightLookup = openMeteoHeights): Promise<StoredRoute> {
  if (hasHeights(route)) return route;
  const flat = route.segments.flat();
  if (flat.length < 2) return route;

  // Distance along the walk at each point; the gap between segments counts,
  // which only matters for where samples fall.
  const along = [0];
  for (let i = 1; i < flat.length; i++) along.push(along[i - 1] + haversineM(flat[i - 1], flat[i]));
  const total = along[along.length - 1];
  const spacing = Math.max(SPACING_M, total / (MAX_LOOKUPS - 1));

  const picks = [0];
  for (let i = 1; i < flat.length - 1; i++) {
    if (along[i] - along[picks[picks.length - 1]] >= spacing) picks.push(i);
  }
  picks.push(flat.length - 1);

  let sampled: number[];
  try {
    sampled = await lookup(picks.map((i) => [flat[i][0], flat[i][1]]));
    if (sampled.length !== picks.length) throw new Error("height count mismatch");
  } catch (err) {
    console.warn("Route heights unavailable:", err instanceof Error ? err.message : err);
    return route;
  }

  // Each point between two samples takes the height in proportion to its distance.
  const heights = new Array<number>(flat.length);
  for (let k = 0; k < picks.length - 1; k++) {
    const a = picks[k];
    const b = picks[k + 1];
    const span = along[b] - along[a];
    for (let i = a; i <= b; i++) {
      const t = span > 0 ? (along[i] - along[a]) / span : 0;
      heights[i] = Math.round((sampled[k] + (sampled[k + 1] - sampled[k]) * t) * 10) / 10;
    }
  }

  let n = 0;
  const segments: TrackPoint[][] = route.segments.map((seg) => seg.map((p) => [p[0], p[1], heights[n++]] as TrackPoint));
  const { ascentM, descentM } = summarise(segments);
  return { ...route, segments, summary: { ...route.summary, ascentM, descentM } };
}
