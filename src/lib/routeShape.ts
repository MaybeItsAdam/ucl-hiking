import { haversineM, type TrackPoint } from "@/lib/gpx";

/**
 * Does a route follow the paths, or is it only the clicks its planner made?
 *
 * OS Maps keeps a route the way it was drawn. Drawn with "Snap to path" it
 * follows every bend, a point every 20–50 m; drawn freehand ("plotted") it is
 * the clicks alone, joined by straight lines hundreds of metres or kilometres
 * long, and there's no fuller version of it to fetch: the route's JSON, its
 * TRK and its RTE export all carry the same points. Drawn on a map, a plotted
 * route reads as "as the crow flies".
 *
 * Measured over the club's own library (813 routes, October 2026), a route
 * that follows paths spends a median 12% of its length in legs over 300 m and
 * the 90th percentile 47%: towpaths, Roman roads, a beach. Half or more is a
 * route that was plotted, or has stretches that were.
 */

/** A leg longer than this, in one straight line, is a planner's click rather than a path's bend. */
export const LONG_LEG_M = 300;
/** At least this share of the length in long legs: drawn point to point. */
export const PLOTTED_SHARE = 0.5;
/** Or fewer points than this per km over a walk of any length. */
export const MIN_POINTS_PER_KM = 3;
/** Shorter than this, a handful of points can be a whole walk round a park. */
const MIN_KM = 1;

export interface RouteShape {
  points: number;
  km: number;
  pointsPerKm: number;
  /** Share of the length, 0–1, in straight legs longer than LONG_LEG_M. */
  straightShare: number;
  longestLegM: number;
  /** Only the planner's clicks: it will draw as straight lines. */
  plotted: boolean;
}

export function routeShape(segments: TrackPoint[][] | null | undefined): RouteShape {
  let points = 0;
  let total = 0;
  let straight = 0;
  let longest = 0;
  for (const seg of segments ?? []) {
    points += seg.length;
    for (let i = 1; i < seg.length; i++) {
      const d = haversineM(seg[i - 1], seg[i]);
      total += d;
      if (d > LONG_LEG_M) straight += d;
      if (d > longest) longest = d;
    }
  }
  const km = total / 1000;
  const pointsPerKm = km > 0 ? points / km : 0;
  const straightShare = total > 0 ? straight / total : 0;
  const plotted = km >= MIN_KM && (straightShare >= PLOTTED_SHARE || pointsPerKm < MIN_POINTS_PER_KM);
  return {
    points,
    km: Math.round(km * 10) / 10,
    pointsPerKm: Math.round(pointsPerKm * 10) / 10,
    straightShare: Math.round(straightShare * 100) / 100,
    longestLegM: Math.round(longest),
    plotted,
  };
}

export const isPlotted = (segments: TrackPoint[][] | null | undefined) => routeShape(segments).plotted;

/** What a leader sees when the route they linked will draw as straight lines. */
export const PLOTTED_WARNING =
  "OS Maps only has this route as straight lines between the points it was plotted with, so that's how it draws. " +
  "To follow the paths, open it in OS Maps, redraw it with “Snap to path” on and save: the walk picks up the change the next morning.";
