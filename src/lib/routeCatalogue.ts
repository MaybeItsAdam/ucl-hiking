import { can, type AccessProfile } from "@/lib/access";
import { simplifySegments, toGpx, type TrackPoint, type Waypoint } from "@/lib/gpx";
import { routeFileName } from "@/lib/eventRoutes";
import { CLUB_ROUTE_TAG, isClubRoute, routeDisplayName } from "@/lib/clubRoutes";

/**
 * The route catalogue: the club's own routes from its OS Maps library, for
 * the committee. Everything here is pure, so the list, the route page and the GPX
 * endpoint share one set of rules and the tests can hold them to it.
 */

/** A library route as the catalogue list needs it: no geometry. */
export interface CatalogueEntry {
  id: string;
  name: string;
  distance_m: number;
  ascent_m: number | null;
  private: boolean;
  /** Walks in the app that used it, the viewer's visible ones only. */
  walks: number;
  /** The most recent of those that has started, as an ISO date-time. */
  lastWalked: string | null;
  /** The soonest one still to come. */
  nextWalk: string | null;
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * The Routes tab is the committee's. The OS Maps library holds every route
 * anyone in the club ever saved, most of them unnamed drafts and many shared
 * publicly, so only the ones the committee has marked as the club's own, by
 * ending the name with [CLUB] in OS Maps, are listed at all.
 */
export { CLUB_ROUTE_TAG, isClubRoute, routeDisplayName };

/** Committee, principals and admins: who sees the Routes tab at all. */
export function canSeeRoutes(profile: AccessProfile): boolean {
  return can(profile, "manage_walks");
}

/** Still in OS Maps, tagged [CLUB], and the viewer is committee. */
export function canSeeLibraryRoute(row: { present: boolean; name?: string | null }, profile: AccessProfile): boolean {
  return Boolean(row.present) && canSeeRoutes(profile) && isClubRoute(row.name);
}

// ---------------------------------------------------------------------------
// Search, filter, sort, pages
// ---------------------------------------------------------------------------

export const DISTANCE_BANDS = [
  { key: "short", label: "Under 12 km", min: 0, max: 12_000 },
  { key: "medium", label: "12–16 km", min: 12_000, max: 16_000 },
  { key: "long", label: "16–20 km", min: 16_000, max: 20_000 },
  { key: "epic", label: "20 km +", min: 20_000, max: Infinity },
] as const;

export type DistanceBand = (typeof DISTANCE_BANDS)[number]["key"];

export function bandOf(distanceM: number): DistanceBand {
  return (DISTANCE_BANDS.find((b) => distanceM >= b.min && distanceM < b.max) ?? DISTANCE_BANDS[0]).key;
}

export const CATALOGUE_SORTS = [
  { key: "name", label: "Name A–Z" },
  { key: "walked", label: "Last walked" },
  { key: "short", label: "Shortest" },
  { key: "long", label: "Longest" },
  { key: "climb", label: "Most climb" },
] as const;

export type CatalogueSort = (typeof CATALOGUE_SORTS)[number]["key"];

export const CATALOGUE_PAGE_SIZE = 25;

export interface CatalogueQuery {
  q: string;
  band: DistanceBand | null;
  sort: CatalogueSort;
  page: number;
}

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The list's state from its URL; anything unknown falls back to the default. */
export function parseCatalogueQuery(params: SearchParams): CatalogueQuery {
  const band = first(params.band);
  const sort = first(params.sort);
  const page = Number.parseInt(first(params.page), 10);
  return {
    q: first(params.q).trim().slice(0, 100),
    band: DISTANCE_BANDS.some((b) => b.key === band) ? (band as DistanceBand) : null,
    sort: CATALOGUE_SORTS.some((s) => s.key === sort) ? (sort as CatalogueSort) : "name",
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** A link to the list with some of its state changed; defaults are left out of the URL. */
export function catalogueHref(query: CatalogueQuery, change: Partial<CatalogueQuery> = {}): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.band) params.set("band", next.band);
  if (next.sort !== "name") params.set("sort", next.sort);
  if (next.page > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return `/portal/events/routes${qs ? `?${qs}` : ""}`;
}

/** Lower case, accents off, punctuation to spaces: "Côte-d'Or" finds "cote dor". */
export function searchKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const byName = (a: CatalogueEntry, b: CatalogueEntry) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base", numeric: true });

const SORTERS: Record<CatalogueSort, (a: CatalogueEntry, b: CatalogueEntry) => number> = {
  name: byName,
  short: (a, b) => a.distance_m - b.distance_m || byName(a, b),
  long: (a, b) => b.distance_m - a.distance_m || byName(a, b),
  // Unknown climb sorts last, not as flat.
  climb: (a, b) => (b.ascent_m ?? -1) - (a.ascent_m ?? -1) || byName(a, b),
  // Walked most recently first; never walked after, by name.
  walked: (a, b) => {
    if (a.lastWalked && b.lastWalked) return b.lastWalked.localeCompare(a.lastWalked) || byName(a, b);
    if (a.lastWalked || b.lastWalked) return a.lastWalked ? -1 : 1;
    return byName(a, b);
  },
};

/** Every word of the search somewhere in the name, inside the distance band, in the chosen order. */
export function filterCatalogue(entries: CatalogueEntry[], query: Pick<CatalogueQuery, "q" | "band" | "sort">): CatalogueEntry[] {
  const words = searchKey(query.q).split(" ").filter(Boolean);
  const out = entries.filter((e) => {
    if (query.band && bandOf(e.distance_m) !== query.band) return false;
    if (!words.length) return true;
    const name = searchKey(e.name);
    return words.every((w) => name.includes(w));
  });
  return out.sort(SORTERS[query.sort]);
}

export interface CataloguePage<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

/** One page of the list; a page past the end shows the last one. */
export function pageOf<T>(items: T[], page: number, size = CATALOGUE_PAGE_SIZE): CataloguePage<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: items.slice((p - 1) * size, p * size), page: p, pages, total: items.length };
}

// ---------------------------------------------------------------------------
// Walks a route was used on
// ---------------------------------------------------------------------------

export interface WalkStats {
  walks: number;
  lastWalked: string | null;
  nextWalk: string | null;
}

/**
 * Per library route, how many of these walks used it, when it was last walked
 * and when it's next out. `events` should already be the ones the viewer may
 * see; a link to a walk that isn't among them doesn't count.
 */
export function walkStats(
  links: { event_suu_id: string; osmaps_route_id: string | null }[],
  events: { suu_event_id: string | null; starts_at: string | null }[],
  now = new Date(),
): Map<string, WalkStats> {
  const startOf = new Map(events.flatMap((e) => (e.suu_event_id ? [[e.suu_event_id, e.starts_at] as const] : [])));
  const nowIso = now.toISOString();
  const stats = new Map<string, WalkStats>();
  for (const link of links) {
    if (!link.osmaps_route_id || !startOf.has(link.event_suu_id)) continue;
    const at = startOf.get(link.event_suu_id) ?? null;
    const s = stats.get(link.osmaps_route_id) ?? { walks: 0, lastWalked: null, nextWalk: null };
    s.walks++;
    if (at && at <= nowIso && (!s.lastWalked || at > s.lastWalked)) s.lastWalked = at;
    if (at && at > nowIso && (!s.nextWalk || at < s.nextWalk)) s.nextWalk = at;
    stats.set(link.osmaps_route_id, s);
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

/** A row's thumbnail is a few dozen pixels across: a few dozen points draw it. */
export const THUMB_TOLERANCE_M = 60;
export const THUMB_MAX_POINTS = 80;

/**
 * The route as an SVG path filling a w×h box (less `pad`), north up, keeping
 * its shape: longitude is squeezed by the cosine of the latitude so a walk
 * doesn't look twice as wide as it is. Thinned first, so the path stays a few
 * hundred bytes however dense the GPX. Null when there's nothing to draw.
 */
export function thumbnailPath(segments: TrackPoint[][] | null | undefined, w: number, h: number, pad = 4): string | null {
  const thin = simplifySegments(segments ?? [], THUMB_TOLERANCE_M, THUMB_MAX_POINTS).filter((s) => s.length >= 2);
  if (!thin.length) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const s of thin)
    for (const [lat, lng] of s) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = (maxLng - minLng) * kx;
  const spanY = maxLat - minLat;
  const span = Math.max(spanX, spanY);
  if (!(span > 0)) return null;
  const scale = Math.min((w - 2 * pad) / (spanX || span), (h - 2 * pad) / (spanY || span));
  // Centre the shape in the box.
  const ox = (w - spanX * scale) / 2;
  const oy = (h - spanY * scale) / 2;
  const r = (n: number) => Math.round(n * 10) / 10;
  return thin
    .map((s) =>
      s
        .map(([lat, lng], i) => `${i ? "L" : "M"}${r(ox + (lng - minLng) * kx * scale)} ${r(oy + (maxLat - lat) * scale)}`)
        .join(""),
    )
    .join("");
}

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

/** A library route as a .gpx file and the name to save it under. */
export function libraryGpx(route: { name: string; segments: TrackPoint[][]; waypoints?: Waypoint[] | null }): { body: string; filename: string } {
  const name = routeDisplayName(route.name.trim()) || "OS Maps route";
  return {
    body: toGpx({ name, segments: route.segments ?? [], waypoints: route.waypoints ?? [] }, "OS Maps route"),
    filename: routeFileName(name),
  };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });

/** "3 walks · last 12 Oct 2026 · next 14 Nov 2026", or null for a route no walk in the app has used. */
export function walkedLabel(e: Pick<CatalogueEntry, "walks" | "lastWalked" | "nextWalk">): string | null {
  if (!e.walks) return null;
  const parts = [e.walks === 1 ? "1 walk" : `${e.walks} walks`];
  if (e.lastWalked) parts.push(`last ${DAY_MONTH_YEAR.format(new Date(e.lastWalked))}`);
  if (e.nextWalk) parts.push(`next ${DAY_MONTH_YEAR.format(new Date(e.nextWalk))}`);
  return parts.join(" · ");
}
