import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Pins for the places walk posts name, looked up once in OpenStreetMap's
 * Nominatim and kept in `place_geocodes`.
 *
 * Nominatim's usage policy is at most one request a second, a User-Agent that
 * says who is asking, and caching what comes back, which is why lookups happen
 * in the daily reconcile rather than while a member waits for a page.
 */

export type LatLng = [number, number];

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
/** Charing Cross: every day walk starts with a train out of London. */
const LONDON: LatLng = [51.5074, -0.1278];
/** A place that found nothing is tried again after this long. */
const RETRY_MISSES_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function placeKey(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function distanceSq([lat, lng]: LatLng): number {
  const dLat = lat - LONDON[0];
  const dLng = (lng - LONDON[1]) * Math.cos((lat * Math.PI) / 180);
  return dLat * dLat + dLng * dLng;
}

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
}

async function search(params: Record<string, string>): Promise<NominatimResult[]> {
  const url = new URL(NOMINATIM);
  for (const [key, value] of Object.entries({ countrycodes: "gb", format: "jsonv2", ...params })) {
    url.searchParams.set(key, value);
  }
  const site = process.env.NEXT_PUBLIC_APP_URL || "https://uclhiking.org";
  const res = await fetch(url, {
    headers: { "User-Agent": `UCLHikingClub/1.0 (+${site})`, "Accept-Language": "en-GB" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
  return (await res.json()) as NominatimResult[];
}

/** Of several same-named places, the nearest to London is the one a day walk went to. */
function nearestToLondon(results: NominatimResult[]): { at: LatLng; label: string } | null {
  let best: { at: LatLng; label: string } | null = null;
  for (const r of results) {
    const at: LatLng = [Number(r.lat), Number(r.lon)];
    if (!Number.isFinite(at[0]) || !Number.isFinite(at[1])) continue;
    if (!best || distanceSq(at) < distanceSq(best.at)) best = { at, label: r.display_name || r.name || "" };
  }
  return best;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The station if OpenStreetMap has one by that name — posts name the station
 * the group arrives at or leaves from — otherwise the town. Two requests at
 * most, a second apart.
 */
export async function geocodePlace(name: string): Promise<{ at: LatLng; label: string } | null> {
  // Posts spell it "Boxhill"; the station and the hill are "Box Hill".
  const query = name.replace(/\bBoxhill\b/gi, "Box Hill");
  const stations = (await search({ q: `${query} station`, limit: "10" })).filter(
    (r) => (r.category === "railway" && (r.type === "station" || r.type === "halt")) ||
      (r.category === "public_transport" && r.type === "station"),
  );
  const station = nearestToLondon(stations);
  if (station) return station;
  await pause(1100);
  return nearestToLondon(await search({ q: query, featureType: "settlement", limit: "5" }));
}

/** Pins already known for these places. Empty, not an error, before the table exists. */
export async function loadPlaces(names: Iterable<string>): Promise<Map<string, LatLng>> {
  const keys = [...new Set([...names].map(placeKey))].filter(Boolean);
  const found = new Map<string, LatLng>();
  if (!keys.length || !isSupabaseConfigured()) return found;
  const { data, error } = await getSupabaseAdmin()
    .from("place_geocodes")
    .select("place, latitude, longitude")
    .in("place", keys)
    .not("latitude", "is", null);
  if (error || !data) return found;
  for (const row of data) found.set(row.place as string, [row.latitude as number, row.longitude as number]);
  return found;
}

/**
 * Look up every named place that has no pin yet, one a second, until the list
 * or the time budget runs out; the next run carries on where this one stopped.
 */
export async function fillPlaceGeocodes(
  names: Iterable<string>,
  { budgetMs = 60_000 }: { budgetMs?: number } = {},
): Promise<{ looked_up: number; found: number; remaining: number }> {
  const keys = [...new Set([...names].map(placeKey))].filter(Boolean);
  if (!keys.length || !isSupabaseConfigured()) return { looked_up: 0, found: 0, remaining: 0 };

  const supabase = getSupabaseAdmin();
  const { data: known, error } = await supabase
    .from("place_geocodes")
    .select("place, latitude, source, looked_up_at")
    .in("place", keys);
  if (error) throw new Error(`place_geocodes: ${error.message}`);

  const retryBefore = Date.now() - RETRY_MISSES_AFTER_MS;
  const settled = new Set(
    (known ?? [])
      .filter((row) => row.latitude !== null || row.source === "manual" || Date.parse(row.looked_up_at) > retryBefore)
      .map((row) => row.place as string),
  );
  const todo = keys.filter((key) => !settled.has(key));

  const deadline = Date.now() + budgetMs;
  let lookedUp = 0;
  let found = 0;
  for (const place of todo) {
    if (Date.now() > deadline) break;
    if (lookedUp > 0) await pause(1100);
    let hit: Awaited<ReturnType<typeof geocodePlace>>;
    try {
      hit = await geocodePlace(place);
    } catch {
      // Nominatim is down or refusing us: stop, and let tomorrow's run retry.
      break;
    }
    lookedUp += 1;
    if (hit) found += 1;
    await supabase.from("place_geocodes").upsert({
      place,
      latitude: hit?.at[0] ?? null,
      longitude: hit?.at[1] ?? null,
      label: hit?.label ?? null,
      source: "nominatim",
      looked_up_at: new Date().toISOString(),
    });
  }
  return { looked_up: lookedUp, found, remaining: todo.length - lookedUp };
}
