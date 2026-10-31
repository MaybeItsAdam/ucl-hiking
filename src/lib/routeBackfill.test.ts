import { describe, expect, it } from "vitest";
import type { TrackPoint } from "./gpx";
import { describePlan, planBackfill, type LibraryRouteRow, type WalkRouteRow } from "./routeBackfill";

/** `n` points due north over `km`: few points is a plotted route, many a path. */
function north(km: number, n: number): TrackPoint[][] {
  return [Array.from({ length: n }, (_, i) => [51.8 + ((km / 111.2) * i) / (n - 1), -0.65] as TrackPoint)];
}
const CLICKS = north(15, 6);
const PATH = north(15, 400);

const lib = (id: string, segments: TrackPoint[][], isPrivate = false): LibraryRouteRow => ({
  id,
  name: `Route ${id}`,
  private: isPrivate,
  present: true,
  segments,
});
const walk = (id: string, segments: TrackPoint[][], source: string, osmapsRouteId: string | null): WalkRouteRow => ({
  event_suu_id: id,
  name: `Walk ${id}`,
  source,
  osmaps_route_id: osmapsRouteId,
  segments,
});

describe("planBackfill", () => {
  const library = [lib("full", PATH), lib("shared-clicks", CLICKS), lib("private-clicks", CLICKS, true)];
  const walks = [
    walk("fine", PATH, "osmaps_auto", "full"),
    walk("stale", CLICKS, "osmaps_pick", "full"),
    walk("matched", CLICKS, "osmaps_auto", "shared-clicks"),
    walk("linked", CLICKS, "osmaps_pick", "private-clicks"),
    walk("upload", CLICKS, "upload", null),
  ];
  const plan = planBackfill(library, walks);

  it("fetches shared plotted routes again and leaves private ones to an export", () => {
    expect(plan.refetch.map((r) => r.id)).toEqual(["shared-clicks"]);
    expect(plan.needsExport.map((r) => r.id)).toEqual(["private-clicks"]);
    expect(plan.refetch[0].shape).toMatchObject({ points: 6, plotted: true });
  });

  it("copies a walk's straight-line copy again when its library route follows the paths", () => {
    expect(plan.recopy).toEqual([{ eventSuuId: "stale", osmapsRouteId: "full" }]);
  });

  it("lists matched and chosen plotted walks apart, and passes good ones", () => {
    expect(plan.matchedPlotted.map((w) => w.id)).toEqual(["matched"]);
    expect(plan.chosenPlotted.map((w) => w.id)).toEqual(["linked", "upload"]);
  });

  it("finds nothing to do in a healthy library", () => {
    const clean = planBackfill([lib("full", PATH)], [walk("fine", PATH, "osmaps_auto", "full")]);
    expect(clean).toMatchObject({ refetch: [], needsExport: [], recopy: [], matchedPlotted: [], chosenPlotted: [] });
  });

  it("prints counts and each route", () => {
    const text = describePlan(plan);
    expect(text).toContain("Checked 3 library routes and 5 walk routes.");
    expect(text).toContain("shared, to fetch from OS Maps again: 1");
    expect(text).toContain("walk stale from route full");
    expect(text).toMatch(/shared-clicks .*15 km, 6 points, 100% straight legs/);
  });
});
