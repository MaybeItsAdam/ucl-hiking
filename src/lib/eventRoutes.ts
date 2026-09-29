import {
  DISPLAY_MAX_POINTS,
  DISPLAY_TOLERANCE_M,
  haversineM,
  simplifySegments,
  type StoredRoute,
  type TrackPoint,
  type Waypoint,
} from "@/lib/gpx";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * A walk's GPX route, kept apart from the plan so the plan's reads stay small
 * and a leader's "Save plan" never touches it. Keyed by the SU id like plans.
 */
export interface EventRoute {
  event_suu_id: string;
  name: string | null;
  /** Where it came from: an uploaded file's name, or the link it was fetched from. */
  source_file: string | null;
  source_url: string | null;
  distance_m: number;
  ascent_m: number | null;
  descent_m: number | null;
  segments: TrackPoint[][];
  waypoints: Waypoint[];
  /** upload / url / osmaps_pick were chosen by a person; osmaps_auto by the daily match. */
  source?: "upload" | "url" | "osmaps_auto" | "osmaps_pick";
  osmaps_route_id?: string | null;
  match_reasons?: string[] | null;
  updated_at?: string;
}

/** What the event page's map needs: the line, thinned, and its two ends. */
export interface MapRoute {
  segments: [number, number][][];
  start: [number, number];
  finish: [number, number];
  waypoints: { at: [number, number]; name: string | null }[];
  /** [km along, metres up] for the elevation strip; empty when the GPX has no heights. */
  profile: [number, number][];
}

const MAP_WAYPOINTS = 50;
const PROFILE_POINTS = 160;

/** Height against distance along the whole walk, thinned to an even spacing. */
export function elevationProfile(segments: TrackPoint[][]): [number, number][] {
  const raw: [number, number][] = [];
  let along = 0;
  let prev: TrackPoint | null = null;
  for (const seg of segments) {
    for (const p of seg) {
      if (prev) along += haversineM(prev, p);
      prev = p;
      if (p.length === 3) raw.push([along / 1000, p[2]]);
    }
  }
  if (raw.length < 2 || raw.length < segments.reduce((n, s) => n + s.length, 0) / 2) return [];
  const total = raw[raw.length - 1][0];
  if (total <= 0) return [];
  const out: [number, number][] = [];
  let j = 0;
  for (let i = 0; i < PROFILE_POINTS; i++) {
    const km = (total * i) / (PROFILE_POINTS - 1);
    while (j < raw.length - 2 && raw[j + 1][0] < km) j++;
    const [k0, e0] = raw[j];
    const [k1, e1] = raw[j + 1];
    const t = k1 > k0 ? Math.min(1, Math.max(0, (km - k0) / (k1 - k0))) : 0;
    out.push([Math.round(km * 100) / 100, Math.round(e0 + (e1 - e0) * t)]);
  }
  return out;
}

export function mapRouteOf(route: Pick<EventRoute, "segments" | "waypoints">): MapRoute | null {
  const segments = simplifySegments(route.segments, DISPLAY_TOLERANCE_M, DISPLAY_MAX_POINTS)
    .map((s) => s.map((p) => [p[0], p[1]] as [number, number]))
    .filter((s) => s.length >= 2);
  if (!segments.length) return null;
  const last = segments[segments.length - 1];
  return {
    segments,
    start: segments[0][0],
    finish: last[last.length - 1],
    waypoints: (route.waypoints ?? []).slice(0, MAP_WAYPOINTS).map((w) => ({ at: [w.lat, w.lng], name: w.name })),
    profile: elevationProfile(route.segments),
  };
}

/** The route for an event, or null. A missing table reads as no route, as with plans. */
export async function getEventRoute(eventSuuId: string | null): Promise<EventRoute | null> {
  if (!eventSuuId || !isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseAdmin().from("event_routes").select("*").eq("event_suu_id", eventSuuId).maybeSingle();
  if (error) return null;
  return (data as EventRoute | null) ?? null;
}

export type RouteSummaryRow = Pick<
  EventRoute,
  "event_suu_id" | "name" | "source_file" | "source_url" | "distance_m" | "ascent_m" | "descent_m" | "source" | "osmaps_route_id"
>;

const SUMMARY_SELECT = "event_suu_id, name, source_file, source_url, distance_m, ascent_m, descent_m, source, osmaps_route_id";

/** Just the facts of a route, without its points, for the plan editor. */
export async function getEventRouteSummary(eventSuuId: string | null): Promise<RouteSummaryRow | null> {
  if (!eventSuuId || !isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseAdmin().from("event_routes").select(SUMMARY_SELECT).eq("event_suu_id", eventSuuId).maybeSingle();
  if (error) return null;
  return (data as RouteSummaryRow | null) ?? null;
}

export async function saveEventRoute(
  eventSuuId: string,
  route: StoredRoute,
  source: { file?: string | null; url?: string | null },
  editorId: string,
) {
  return getSupabaseAdmin()
    .from("event_routes")
    .upsert(
      {
        event_suu_id: eventSuuId,
        name: route.name,
        source_file: source.file ?? null,
        source_url: source.url ?? null,
        source: source.url ? "url" : "upload",
        osmaps_route_id: null,
        match_reasons: null,
        distance_m: route.summary.distanceM,
        ascent_m: route.summary.ascentM,
        descent_m: route.summary.descentM,
        segments: route.segments,
        waypoints: route.waypoints,
        updated_by: editorId,
      },
      { onConflict: "event_suu_id" },
    )
    .select(SUMMARY_SELECT)
    .single<RouteSummaryRow>();
}

export async function deleteEventRoute(eventSuuId: string) {
  return getSupabaseAdmin().from("event_routes").delete().eq("event_suu_id", eventSuuId);
}

/** A filename-safe slug for downloads. */
export function routeFileName(title: string): string {
  return (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "route") + ".gpx";
}
