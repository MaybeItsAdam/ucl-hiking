import type { LatLng } from "@/lib/places";

/**
 * Which of the club's OS Maps routes is which walk.
 *
 * The committee plans every walk in one OS Maps account, but nothing links a
 * route there to the SU event. The route's own shape does: a walk from Wye to
 * Canterbury starts by Wye station and ends by Canterbury's, and its name
 * usually says so. Geometry carries most of the weight; names, distance and
 * date break ties. A walk only gets a route when one clearly wins, so a wrong
 * route is rarer than a missing one; a leader can still pick one by hand.
 */

export interface CandidateRoute {
  id: string;
  name: string;
  distanceM: number | null;
  start: LatLng | null;
  finish: LatLng | null;
  /** When it was planned for or last edited, if OS Maps says. */
  date: string | null;
}

export interface MatchableHike {
  id: string;
  name: string;
  date: string;
  distanceKm: number | null;
  startName: string | null;
  finishName: string | null;
  start: LatLng | null;
  finish: LatLng | null;
}

export interface RouteMatch {
  hikeId: string;
  routeId: string;
  score: number;
  reasons: string[];
}

/** Walking ends within this of the station count as "at" it. */
const NEAR_M = 3000;
/** A match needs this much evidence, e.g. one end at its station and a shared place name. */
export const MIN_SCORE = 4;
/** And must beat the runner-up by this much, or it's a guess. */
const MARGIN = 1.5;

const STOP_WORDS = new Set([
  "a", "an", "and", "the", "of", "to", "via", "from", "in", "on", "at", "by", "with",
  "hike", "hikes", "walk", "walks", "walking", "taster", "trail", "route", "circular", "loop",
  "day", "trip", "club", "ucl", "km", "miles", "mile", "station", "st", "part", "leg", "copy",
]);

export function nameTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t) && !/^\d+(km)?$/.test(t)),
  );
}

export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const near = (a: LatLng | null, b: LatLng | null) => Boolean(a && b && distanceM(a, b) <= NEAR_M);

export function scoreRoute(route: CandidateRoute, hike: MatchableHike): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Geometry: either direction, since a route can be drawn back to front.
  const forward = Number(near(route.start, hike.start)) + Number(near(route.finish, hike.finish ?? hike.start));
  const backward = Number(near(route.finish, hike.start)) + Number(near(route.start, hike.finish ?? hike.start));
  const ends = Math.max(forward, backward);
  if (ends) {
    score += ends * 3;
    reasons.push(ends === 2 ? "both ends at the stations" : "one end at a station");
  }

  const routeWords = nameTokens(route.name);
  const hikeWords = nameTokens([hike.name, hike.startName, hike.finishName].filter(Boolean).join(" "));
  const shared = [...routeWords].filter((w) => hikeWords.has(w));
  if (shared.length) {
    score += Math.min(shared.length, 2) * 1.5;
    reasons.push(`name shares ${shared.join(", ")}`);
  }

  if (route.distanceM && hike.distanceKm) {
    const ratio = route.distanceM / 1000 / hike.distanceKm;
    if (ratio > 0.85 && ratio < 1.15) {
      score += 1;
      reasons.push("distance agrees");
    } else if (ratio < 0.6 || ratio > 1.6) {
      score -= 1;
    }
  }

  if (route.date) {
    const days = Math.abs(Date.parse(route.date) - Date.parse(hike.date)) / 86_400_000;
    if (days <= 3) {
      score += 2;
      reasons.push("same date");
    } else if (days <= 60) {
      score += 0.5;
    }
  }

  return { score, reasons };
}

/** The clear best route for each hike, if there is one. A route may serve several hikes (a walk run twice). */
export function matchRoutes(routes: CandidateRoute[], hikes: MatchableHike[]): RouteMatch[] {
  const matches: RouteMatch[] = [];
  for (const hike of hikes) {
    const scored = routes
      .map((route) => ({ route, ...scoreRoute(route, hike) }))
      .sort((a, b) => b.score - a.score);
    const [best, next] = scored;
    if (!best || best.score < MIN_SCORE) continue;
    if (next && best.score - next.score < MARGIN) continue;
    matches.push({ hikeId: hike.id, routeId: best.route.id, score: best.score, reasons: best.reasons });
  }
  return matches;
}
