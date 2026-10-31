import type { TrackPoint } from "@/lib/gpx";
import { routeShape, type RouteShape } from "@/lib/routeShape";

/**
 * What scripts/backfill-route-geometry.ts would do: which stored routes are
 * only their planner's clicks (lib/routeShape), and which of those can be put
 * right from here.
 *
 * - A library route that's shared can be fetched from OS Maps again, in case
 *   it has been redrawn along the paths since it was stored.
 * - A private one only comes in with a new export of the library
 *   (scripts/import-osmaps-export.ts), so it is listed, not fetched.
 * - A walk's copy that is straight lines while its library route now follows
 *   the paths is copied again from the library.
 * - A walk matched to a plotted route is listed: the next match passes
 *   plotted routes over, so a full one can take its place.
 * - A route a person uploaded, linked or picked is theirs: listed only.
 */

export interface LibraryRouteRow {
  id: string;
  name: string;
  private: boolean | null;
  present: boolean | null;
  segments: TrackPoint[][];
}

export interface WalkRouteRow {
  event_suu_id: string;
  name: string | null;
  source: string | null;
  osmaps_route_id: string | null;
  segments: TrackPoint[][];
}

export interface Flagged {
  id: string;
  name: string | null;
  shape: RouteShape;
}

export interface BackfillPlan {
  libraryChecked: number;
  walksChecked: number;
  /** Shared library routes stored as clicks only: fetch from OS Maps again. */
  refetch: Flagged[];
  /** Private library routes stored as clicks only: need a new export. */
  needsExport: Flagged[];
  /** Walks whose copy is clicks only but whose library route follows the paths: copy it again. */
  recopy: { eventSuuId: string; osmapsRouteId: string }[];
  /** Walks the daily match gave a plotted route. */
  matchedPlotted: Flagged[];
  /** Walks with a plotted route a person chose. */
  chosenPlotted: Flagged[];
}

export function planBackfill(library: LibraryRouteRow[], walks: WalkRouteRow[]): BackfillPlan {
  const shapes = new Map(library.map((r) => [r.id, routeShape(r.segments)]));
  const plan: BackfillPlan = {
    libraryChecked: library.length,
    walksChecked: walks.length,
    refetch: [],
    needsExport: [],
    recopy: [],
    matchedPlotted: [],
    chosenPlotted: [],
  };
  for (const r of library) {
    const shape = shapes.get(r.id)!;
    if (!shape.plotted) continue;
    (r.private ? plan.needsExport : plan.refetch).push({ id: r.id, name: r.name, shape });
  }
  for (const w of walks) {
    const shape = routeShape(w.segments);
    if (!shape.plotted) continue;
    const libraryShape = w.osmaps_route_id ? shapes.get(w.osmaps_route_id) : undefined;
    if (w.osmaps_route_id && libraryShape && !libraryShape.plotted) {
      plan.recopy.push({ eventSuuId: w.event_suu_id, osmapsRouteId: w.osmaps_route_id });
      continue;
    }
    (w.source === "osmaps_auto" ? plan.matchedPlotted : plan.chosenPlotted).push({ id: w.event_suu_id, name: w.name, shape });
  }
  return plan;
}

const line = (f: Flagged) =>
  `  ${f.id}  ${(f.name ?? "").slice(0, 50)}  ${f.shape.km} km, ${f.shape.points} points, ${Math.round(f.shape.straightShare * 100)}% straight legs, longest ${f.shape.longestLegM} m`;

/** The plan as the script prints it. */
export function describePlan(plan: BackfillPlan): string {
  const out = [
    `Checked ${plan.libraryChecked} library routes and ${plan.walksChecked} walk routes.`,
    `Library routes that are only their clicks: ${plan.refetch.length + plan.needsExport.length}`,
    `  shared, to fetch from OS Maps again: ${plan.refetch.length}`,
    `  private, need a new export from OS Maps: ${plan.needsExport.length}`,
    `Walks to copy again from a library route that follows the paths: ${plan.recopy.length}`,
    `Walks matched to a route that is only its clicks: ${plan.matchedPlotted.length}`,
    `Walks with such a route a person chose (left alone): ${plan.chosenPlotted.length}`,
  ];
  const section = (title: string, rows: Flagged[]) => (rows.length ? [``, title, ...rows.map(line)] : []);
  out.push(...section("Shared, to fetch again:", plan.refetch));
  out.push(...section("Private, redraw in OS Maps and export again:", plan.needsExport));
  if (plan.recopy.length) out.push(``, "To copy again:", ...plan.recopy.map((r) => `  walk ${r.eventSuuId} from route ${r.osmapsRouteId}`));
  out.push(...section("Matched to a plotted route:", plan.matchedPlotted));
  out.push(...section("Chosen by a person:", plan.chosenPlotted));
  return out.join("\n");
}
