import { prepareRoute, type StoredRoute, type TrackPoint, type Waypoint } from "@/lib/gpx";
import { eventDetails } from "@/lib/eventDetails";
import { getEventsInClubYear } from "@/lib/events";
import { osmapsDetails, osmapsGpx, osmapsRouteId, OsmapsError, stampOf, type OsmapsDetails } from "@/lib/osmaps";
import { loadPlaces, placeKey, type LatLng } from "@/lib/places";
import { matchRoutes, type CandidateRoute, type MatchableHike } from "@/lib/routeMatch";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { SUEvent } from "@/lib/types";

/**
 * Keeps each walk's route in step with the club's OS Maps account.
 *
 * Leaders link a walk to its OS Maps route once (the plan's route link), and it
 * is fetched there and then. Each morning this also:
 * 1. Refreshes every OS Maps route we know of (linked from a plan, or already
 *    stored), downloading the GPX again only when the route was edited.
 * 2. Puts a linked route on its walk, and passes edits on to walks using it.
 * 3. Gives walks with no route the clear best match from the library of
 *    routes so far (lib/routeMatch), so a walk run again gets last time's.
 *
 * A route a person attached (a link, an upload, or picked from the list) is
 * never replaced by a match; only earlier matches are. See lib/osmaps for why
 * this reads shared routes by id rather than signing in to the account.
 */

export interface OsmapsFetchers {
  details: (id: string) => Promise<OsmapsDetails>;
  gpx: (id: string) => Promise<string>;
}

const LIVE: OsmapsFetchers = { details: osmapsDetails, gpx: osmapsGpx };

export interface OsmapsRouteRow {
  id: string;
  name: string;
  remote_updated_at: string | null;
  planned_for: string | null;
  distance_m: number;
  ascent_m: number | null;
  descent_m: number | null;
  start_lat: number | null;
  start_lng: number | null;
  finish_lat: number | null;
  finish_lng: number | null;
  segments: TrackPoint[][];
  waypoints: Waypoint[];
  present: boolean;
}

export interface SyncResult {
  routesSeen: number;
  routesDownloaded: number;
  walksLinked: number;
  walksMatched: number;
  failures: { id: string; error: string }[];
}

const WALKING = new Set(["hike", "walk"]);
const ROUTE_SUMMARY = "event_suu_id, name, source_file, source_url, distance_m, ascent_m, descent_m, source, osmaps_route_id";

export function routeRow(details: OsmapsDetails, route: StoredRoute): Omit<OsmapsRouteRow, "present"> {
  const first = route.segments[0]?.[0];
  const lastSeg = route.segments[route.segments.length - 1];
  const last = lastSeg?.[lastSeg.length - 1];
  return {
    id: details.id,
    name: details.name || route.name || "Untitled route",
    remote_updated_at: stampOf(details),
    planned_for: null,
    // OS Maps' own figures are what the leader saw when planning; ours are the fallback.
    distance_m: details.distanceM ?? route.summary.distanceM,
    ascent_m: details.ascentM ?? route.summary.ascentM,
    descent_m: details.descentM ?? route.summary.descentM,
    start_lat: first?.[0] ?? null,
    start_lng: first?.[1] ?? null,
    finish_lat: last?.[0] ?? null,
    finish_lng: last?.[1] ?? null,
    segments: route.segments,
    // OS Maps exports every plotted click as an unnamed waypoint; only named ones are worth a dot.
    waypoints: route.waypoints.filter((w) => w.name?.trim()),
  };
}

export function candidateOf(row: OsmapsRouteRow): CandidateRoute {
  const at = (lat: number | null, lng: number | null): LatLng | null => (lat == null || lng == null ? null : [lat, lng]);
  return {
    id: row.id,
    name: row.name,
    distanceM: row.distance_m || null,
    start: at(row.start_lat, row.start_lng),
    finish: at(row.finish_lat, row.finish_lng),
    date: row.planned_for,
  };
}

export function hikesOf(events: SUEvent[], places: Map<string, LatLng>): MatchableHike[] {
  const hikes: MatchableHike[] = [];
  for (const event of events) {
    if (!event.suu_event_id || !event.starts_at) continue;
    const d = eventDetails(event);
    if (!WALKING.has(d.kind)) continue;
    const start = d.start ? places.get(placeKey(d.start)) ?? null : null;
    const finish = d.finish ? places.get(placeKey(d.finish)) ?? null : start;
    hikes.push({
      id: event.suu_event_id,
      name: d.name,
      date: event.starts_at,
      distanceKm: d.distanceKm,
      startName: d.start,
      finishName: d.finish,
      start,
      finish,
    });
  }
  return hikes;
}

export function eventRouteFrom(
  eventSuuId: string,
  row: OsmapsRouteRow,
  source: "osmaps_auto" | "osmaps_pick",
  editorId: string | null,
  reasons: string[] | null,
) {
  return {
    event_suu_id: eventSuuId,
    name: row.name,
    source_file: null,
    source_url: null,
    distance_m: row.distance_m,
    ascent_m: row.ascent_m,
    descent_m: row.descent_m,
    segments: row.segments,
    waypoints: row.waypoints,
    source,
    osmaps_route_id: row.id,
    match_reasons: reasons,
    updated_by: editorId,
  };
}

function clubYear(now: Date): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/**
 * Fetch one route into the library, unless it hasn't changed since `stamp`.
 * Returns the stored row, or null when it was already up to date.
 */
export async function importOsmapsRoute(
  id: string,
  stamp: string | null = null,
  fetchers: OsmapsFetchers = LIVE,
  now = new Date(),
): Promise<OsmapsRouteRow | null> {
  const details = await fetchers.details(id);
  if (stamp && stampOf(details) === stamp) return null;
  let route: StoredRoute;
  try {
    route = prepareRoute(await fetchers.gpx(id));
  } catch (err) {
    if (err instanceof OsmapsError) throw err;
    throw new OsmapsError("OS Maps sent a route with no track to draw.");
  }
  const row: OsmapsRouteRow = { ...routeRow(details, route), present: true };
  const { error } = await getSupabaseAdmin()
    .from("osmaps_routes")
    .upsert({ ...row, fetched_at: now.toISOString() });
  if (error) throw new Error(error.message);
  return row;
}

/** A leader linked a walk to an OS Maps route: fetch it now and put it on the walk. */
export async function attachOsmapsLink(eventSuuId: string, link: string, editorId: string | null, fetchers: OsmapsFetchers = LIVE) {
  const id = osmapsRouteId(link);
  if (!id) throw new OsmapsError("That isn't an OS Maps route link.");
  const row = (await importOsmapsRoute(id, null, fetchers))!;
  const { data, error } = await getSupabaseAdmin()
    .from("event_routes")
    .upsert(eventRouteFrom(eventSuuId, row, "osmaps_pick", editorId, null), { onConflict: "event_suu_id" })
    .select(ROUTE_SUMMARY)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function syncOsmapsRoutes(fetchers: OsmapsFetchers = LIVE, now = new Date()): Promise<SyncResult> {
  const supabase = getSupabaseAdmin();

  const [{ data: plans }, { data: known }] = await Promise.all([
    supabase.from("event_plans").select("event_suu_id, route_url").not("route_url", "is", null),
    supabase.from("osmaps_routes").select("id, remote_updated_at, present"),
  ]);
  const linked = new Map<string, string>(); // walk → OS Maps route id
  for (const p of plans ?? []) {
    const id = osmapsRouteId(p.route_url as string);
    if (id) linked.set(p.event_suu_id as string, id);
  }
  const stamps = new Map((known ?? []).map((r) => [r.id as string, r as { remote_updated_at: string | null; present: boolean }]));
  const ids = new Set([...stamps.keys(), ...linked.values()]);

  const failures: SyncResult["failures"] = [];
  const refreshed = new Map<string, OsmapsRouteRow>();
  for (const id of ids) {
    const have = stamps.get(id);
    try {
      const row = await importOsmapsRoute(id, have?.present ? have.remote_updated_at : null, fetchers, now);
      if (row) refreshed.set(id, row);
    } catch (err) {
      failures.push({ id, error: err instanceof Error ? err.message : String(err) });
      // No longer shared, or deleted: stop offering it. Walks keep the copy they have.
      if (err instanceof OsmapsError && have?.present && /won't show/.test(err.message)) {
        await supabase.from("osmaps_routes").update({ present: false }).eq("id", id);
      }
    }
  }

  // An edited route: pass the new line on to every walk already using it.
  for (const [id, row] of refreshed) {
    const { data: users } = await supabase.from("event_routes").select("event_suu_id, source, updated_by, match_reasons").eq("osmaps_route_id", id);
    for (const u of users ?? []) {
      const next = eventRouteFrom(
        u.event_suu_id as string,
        row,
        u.source as "osmaps_auto" | "osmaps_pick",
        u.updated_by as string | null,
        u.match_reasons as string[] | null,
      );
      await supabase.from("event_routes").update(next).eq("event_suu_id", u.event_suu_id);
    }
  }

  // A plan's link beats a match, but not an upload or a route picked since.
  let walksLinked = 0;
  if (linked.size) {
    const [{ data: current }, { data: rows }] = await Promise.all([
      supabase.from("event_routes").select("event_suu_id, source, osmaps_route_id").in("event_suu_id", [...linked.keys()]),
      supabase.from("osmaps_routes").select("*").in("id", [...new Set(linked.values())]),
    ]);
    const byWalk = new Map((current ?? []).map((r) => [r.event_suu_id as string, r]));
    const routeById = new Map(((rows ?? []) as OsmapsRouteRow[]).map((r) => [r.id, r]));
    for (const [walk, id] of linked) {
      const have = byWalk.get(walk);
      const row = routeById.get(id);
      if (!row || have?.osmaps_route_id === id) continue;
      if (have && have.source !== "osmaps_auto") continue;
      const { error } = await supabase
        .from("event_routes")
        .upsert(eventRouteFrom(walk, row, "osmaps_pick", null, null), { onConflict: "event_suu_id" });
      if (!error) walksLinked++;
    }
  }

  const walksMatched = await matchAndAttach(now);
  return { routesSeen: ids.size, routesDownloaded: refreshed.size, walksLinked, walksMatched, failures };
}

/** Attach each walk's clear best route, leaving any a person chose alone. */
export async function matchAndAttach(now = new Date()): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data: rows } = await supabase.from("osmaps_routes").select("*").eq("present", true);
  const routes = (rows ?? []) as OsmapsRouteRow[];
  if (!routes.length) return 0;

  const year = clubYear(now);
  const events = [...(await getEventsInClubYear(year - 1)), ...(await getEventsInClubYear(year))];
  const names = new Set<string>();
  for (const e of events) {
    const d = eventDetails(e);
    if (d.start) names.add(placeKey(d.start));
    if (d.finish) names.add(placeKey(d.finish));
  }
  const hikes = hikesOf(events, await loadPlaces(names));
  if (!hikes.length) return 0;

  const [{ data: existing }, { data: dismissedRows }] = await Promise.all([
    supabase.from("event_routes").select("event_suu_id, source, osmaps_route_id").in("event_suu_id", hikes.map((h) => h.id)),
    supabase.from("event_route_dismissals").select("event_suu_id, osmaps_route_id"),
  ]);
  const chosenByPerson = new Set((existing ?? []).filter((r) => r.source !== "osmaps_auto").map((r) => r.event_suu_id as string));
  const current = new Map((existing ?? []).map((r) => [r.event_suu_id as string, r.osmaps_route_id as string | null]));
  const dismissed = new Set((dismissedRows ?? []).map((d) => `${d.event_suu_id}|${d.osmaps_route_id}`));

  const byId = new Map(routes.map((r) => [r.id, r]));
  const candidates = routes.map(candidateOf);
  let attached = 0;
  for (const hike of hikes) {
    if (chosenByPerson.has(hike.id)) continue;
    const [m] = matchRoutes(
      candidates.filter((c) => !dismissed.has(`${hike.id}|${c.id}`)),
      [hike],
    );
    if (!m) continue;
    const row = byId.get(m.routeId)!;
    if (current.get(m.hikeId) === row.id) continue;
    const { error } = await supabase
      .from("event_routes")
      .upsert(eventRouteFrom(m.hikeId, row, "osmaps_auto", null, m.reasons), { onConflict: "event_suu_id" });
    if (!error) attached++;
  }
  return attached;
}
