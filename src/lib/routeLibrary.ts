import { profileOf } from "@/lib/access";
import { dedupeEvents } from "@/lib/eventDuplicates";
import { getEventsBySuuIds } from "@/lib/events";
import type { TrackPoint, Waypoint } from "@/lib/gpx";
import { canSeeLibraryRoute, thumbnailPath, walkStats, type CatalogueEntry } from "@/lib/routeCatalogue";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { Member, SUEvent } from "@/lib/types";
import { viewerOf, visibleEvents } from "@/lib/walkVisibility";

/**
 * Reads the club's OS Maps library (osmaps_routes) for the route catalogue.
 * Every read here is the server's, with the service key: who may see a row is
 * decided by lib/routeCatalogue before anything leaves the server.
 *
 * With no database (local dev, never production) it reads the dev store's
 * demo library instead.
 */

export interface LibraryRoute {
  id: string;
  name: string;
  distance_m: number;
  ascent_m: number | null;
  descent_m?: number | null;
  segments: TrackPoint[][];
  waypoints: Waypoint[];
  private: boolean;
  present: boolean;
  remote_updated_at?: string | null;
}

export type LibraryIndexRow = Pick<LibraryRoute, "id" | "name" | "distance_m" | "ascent_m" | "private" | "present">;

/** OS Maps ids are digits; anything else never reaches the query. */
const ROUTE_ID = /^[\w-]{1,40}$/;

/** PostgREST answers at most this many rows at a time. */
const PAGE = 1000;

async function devStore() {
  if (process.env.NODE_ENV === "production") return null;
  return import("@/lib/dev-store");
}

/** Every route still in OS Maps, without its geometry: a few dozen KB for the whole library. */
export async function getLibraryIndex(): Promise<LibraryIndexRow[]> {
  if (!isSupabaseConfigured()) {
    const dev = await devStore();
    return (dev?.getDevLibrary() ?? [])
      .filter((r) => r.present)
      .map(({ id, name, distance_m, ascent_m, private: priv, present }) => ({ id, name, distance_m, ascent_m, private: priv, present }));
  }
  const rows: LibraryIndexRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await getSupabaseAdmin()
      .from("osmaps_routes")
      .select("id, name, distance_m, ascent_m, private, present")
      .eq("present", true)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return rows;
    rows.push(...((data ?? []) as LibraryIndexRow[]));
    if (!data || data.length < PAGE) return rows;
  }
}

/** One route with its geometry, or null. Present or not: the caller decides who sees it. */
export async function getLibraryRoute(id: string): Promise<LibraryRoute | null> {
  if (!ROUTE_ID.test(id)) return null;
  if (!isSupabaseConfigured()) {
    const dev = await devStore();
    return dev?.getDevLibrary().find((r) => r.id === id) ?? null;
  }
  const { data, error } = await getSupabaseAdmin().from("osmaps_routes").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return { ...(data as LibraryRoute), private: Boolean((data as LibraryRoute).private) };
}

/** Just whether a route is private and still there, for the event page's link to it. */
export async function getLibraryRouteFlags(id: string): Promise<Pick<LibraryRoute, "private" | "present"> | null> {
  if (!ROUTE_ID.test(id)) return null;
  if (!isSupabaseConfigured()) {
    const dev = await devStore();
    const row = dev?.getDevLibrary().find((r) => r.id === id);
    return row ? { private: row.private, present: row.present } : null;
  }
  const { data, error } = await getSupabaseAdmin().from("osmaps_routes").select("private, present").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return { private: Boolean(data.private), present: Boolean(data.present) };
}

/**
 * Thumbnails for one page of the list. Only these rows' geometry is read, and
 * it is thinned to a short SVG path here, so the page sends a few hundred
 * bytes per route rather than its whole track.
 */
export async function getLibraryThumbnails(ids: string[], w: number, h: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  let rows: Pick<LibraryRoute, "id" | "segments">[];
  if (!isSupabaseConfigured()) {
    const dev = await devStore();
    rows = (dev?.getDevLibrary() ?? []).filter((r) => ids.includes(r.id));
  } else {
    const { data, error } = await getSupabaseAdmin().from("osmaps_routes").select("id, segments").in("id", ids);
    if (error) return out;
    rows = (data ?? []) as Pick<LibraryRoute, "id" | "segments">[];
  }
  for (const row of rows) {
    const path = thumbnailPath(row.segments, w, h);
    if (path) out.set(row.id, path);
  }
  return out;
}

export interface LibraryLink {
  event_suu_id: string;
  osmaps_route_id: string | null;
}

/** Walks (by SU id) carrying a library route: all of them, or one route's. */
export async function getLibraryLinks(routeId?: string): Promise<LibraryLink[]> {
  if (!isSupabaseConfigured()) {
    const dev = await devStore();
    return (dev?.getDevRoutes() ?? [])
      .filter((r) => r.osmaps_route_id && (!routeId || r.osmaps_route_id === routeId))
      .map((r) => ({ event_suu_id: r.event_suu_id, osmaps_route_id: r.osmaps_route_id ?? null }));
  }
  const rows: LibraryLink[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = getSupabaseAdmin().from("event_routes").select("event_suu_id, osmaps_route_id").not("osmaps_route_id", "is", null);
    if (routeId) query = query.eq("osmaps_route_id", routeId);
    const { data, error } = await query.order("event_suu_id").range(from, from + PAGE - 1);
    if (error) return rows;
    rows.push(...((data ?? []) as LibraryLink[]));
    if (!data || data.length < PAGE) return rows;
  }
}

/**
 * The walks behind these links that this member may see, oldest first. One walk
 * listed twice by Toolbox often has the route on both rows (it is matched to
 * each), so the copies go here or the route reads "walked twice".
 */
export async function walksFor(links: LibraryLink[], member: Member): Promise<SUEvent[]> {
  const ids = [...new Set(links.map((l) => l.event_suu_id))];
  const events: SUEvent[] = [];
  // In slices, so the id list stays well inside a URL.
  for (let i = 0; i < ids.length; i += 200) events.push(...(await getEventsBySuuIds(ids.slice(i, i + 200))));
  return visibleEvents(dedupeEvents(events), viewerOf(member));
}

/** The catalogue as this member may see it: every visible route with its walk count and dates. */
export async function getCatalogue(member: Member, now = new Date()): Promise<CatalogueEntry[]> {
  const profile = profileOf(member);
  const [index, links] = await Promise.all([getLibraryIndex(), getLibraryLinks()]);
  const visible = index.filter((r) => canSeeLibraryRoute(r, profile));
  const stats = walkStats(links, await walksFor(links, member), now);
  return visible.map((r) => {
    const s = stats.get(r.id);
    return {
      id: r.id,
      name: r.name,
      distance_m: r.distance_m,
      ascent_m: r.ascent_m,
      private: Boolean(r.private),
      walks: s?.walks ?? 0,
      lastWalked: s?.lastWalked ?? null,
      nextWalk: s?.nextWalk ?? null,
    };
  });
}
