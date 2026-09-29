import {
  DISPLAY_MAX_POINTS,
  DISPLAY_TOLERANCE_M,
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
  updated_at?: string;
}

/** What the event page's map needs: the line, thinned, and its two ends. */
export interface MapRoute {
  segments: [number, number][][];
  start: [number, number];
  finish: [number, number];
  waypoints: { at: [number, number]; name: string | null }[];
}

const MAP_WAYPOINTS = 50;

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
  "event_suu_id" | "name" | "source_file" | "source_url" | "distance_m" | "ascent_m" | "descent_m"
>;

const SUMMARY_SELECT = "event_suu_id, name, source_file, source_url, distance_m, ascent_m, descent_m";

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
