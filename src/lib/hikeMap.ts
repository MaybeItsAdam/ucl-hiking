import { eventDetails, type Difficulty, type EventKind } from "@/lib/eventDetails";
import { placeKey, type LatLng } from "@/lib/places";
import type { SUEvent } from "@/lib/types";

const ZONE = "Europe/London";

/** One walk on a map: where it started and, if elsewhere, where it finished. */
export interface MapHike {
  id: string;
  /** Its number in the year, in date order, as drawn on the pin. */
  n: number;
  name: string;
  kind: EventKind;
  date: string;
  dateLabel: string;
  difficulty: Difficulty | null;
  distanceKm: number | null;
  ascentM: number | null;
  startName: string | null;
  finishName: string | null;
  start: LatLng | null;
  finish: LatLng | null;
  upcoming: boolean;
  /** The SU's id for the walk, which its stored route is keyed by. */
  suuId?: string | null;
  /** Its route, thinned for a map of many walks (see withTracks). */
  track?: [number, number][][] | null;
}

export interface YearStats {
  done: number;
  upcoming: number;
  km: number;
  ascentM: number;
  places: number;
  longest: MapHike | null;
  steepest: MapHike | null;
}

const WALKING: EventKind[] = ["hike", "walk", "trip"];

/** Every place a set of events names, for loading or looking up their pins. */
export function eventPlaces(events: Pick<SUEvent, "title" | "description" | "location">[]): string[] {
  const names = new Set<string>();
  for (const event of events) {
    const { kind, start, finish } = eventDetails(event);
    if (!WALKING.includes(kind)) continue;
    if (start) names.add(placeKey(start));
    if (finish) names.add(placeKey(finish));
  }
  return [...names];
}

function londonDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

/**
 * The year's walks, in date order and numbered. Those with neither pin known
 * (no stations in the post, or not looked up yet) still count toward the stats.
 *
 * The same walk often exists twice — once from the SU's listing, once from the
 * committee's Toolbox post — so walks on one day from one place count once,
 * keeping whichever copy says the most.
 */
export function mapHikes(events: SUEvent[], places: Map<string, LatLng>, now = new Date()): MapHike[] {
  const byKey = new Map<string, { hike: MapHike; score: number }>();
  for (const event of events) {
    if (!event.starts_at || event.status === "cancelled" || event.status === "draft") continue;
    const d = eventDetails(event);
    if (!WALKING.includes(d.kind)) continue;
    const start = d.start ? places.get(placeKey(d.start)) ?? null : null;
    const finish = d.finish ? places.get(placeKey(d.finish)) ?? null : null;

    const hike: MapHike = {
      id: event.id,
      n: 0,
      name: d.name,
      kind: d.kind,
      date: event.starts_at,
      dateLabel: new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, weekday: "short", day: "numeric", month: "short" }).format(
        new Date(event.starts_at),
      ),
      difficulty: d.difficulty,
      distanceKm: d.distanceKm,
      ascentM: d.ascentM,
      startName: d.start,
      finishName: d.finish,
      start,
      finish,
      upcoming: new Date(event.starts_at) > now,
      suuId: event.suu_event_id ?? null,
    };
    const key = `${londonDay(event.starts_at)}|${(d.start ?? d.finish ?? "").toLowerCase()}`;
    const score = (d.distanceKm ? 4 : 0) + (d.difficulty ? 2 : 0) + (event.description?.length ?? 0) / 1e6;
    const seen = byKey.get(key);
    if (!seen || score > seen.score) byKey.set(key, { hike, score });
  }
  // A copy that names no station ("Surrey Three Peaks hike") is the same day's
  // walk as one that does, so it only stands on a day that has nothing better.
  const placedDays = new Set([...byKey.keys()].filter((key) => !key.endsWith("|")).map((key) => key.split("|")[0]));
  const hikes = [...byKey.entries()]
    .filter(([key]) => !key.endsWith("|") || !placedDays.has(key.split("|")[0]))
    .map(([, { hike }]) => hike)
    .sort((a, b) => a.date.localeCompare(b.date));
  hikes.forEach((hike, i) => {
    hike.n = i + 1;
  });
  return hikes;
}

/** The club year a date falls in, named by the year its September is in. */
export function clubYear(now = new Date()): number {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  return month >= 9 ? year : year - 1;
}

/** "2025–26". */
export function clubYearLabel(year: number): string {
  return `${year}–${String(year + 1).slice(-2)}`;
}

export const onMap = (hike: MapHike) => Boolean(hike.start || hike.finish);

/**
 * Each walk with its route, where it has one, so the map draws the way it
 * went rather than a dotted line from station to station. A walk whose
 * stations aren't known goes on the map at its route's ends.
 */
export function withTracks(hikes: MapHike[], lines: Map<string, [number, number][][]>): MapHike[] {
  return hikes.map((hike) => {
    const track = hike.suuId ? lines.get(hike.suuId) : undefined;
    if (!track?.length) return hike;
    if (hike.start || hike.finish) return { ...hike, track };
    const last = track[track.length - 1];
    return { ...hike, track, start: track[0][0], finish: last[last.length - 1] };
  });
}

export function yearStats(hikes: MapHike[]): YearStats {
  const done = hikes.filter((h) => !h.upcoming);
  const places = new Set(done.flatMap((h) => [h.startName, h.finishName]).filter(Boolean).map((p) => p!.toLowerCase()));
  const most = (value: (h: MapHike) => number | null) =>
    done.reduce<MapHike | null>((best, h) => ((value(h) ?? -1) > (best ? value(best) ?? -1 : -1) ? h : best), null);
  return {
    done: done.length,
    upcoming: hikes.length - done.length,
    km: done.reduce((sum, h) => sum + (h.distanceKm ?? 0), 0),
    ascentM: done.reduce((sum, h) => sum + (h.ascentM ?? 0), 0),
    places: places.size,
    longest: most((h) => h.distanceKm),
    steepest: most((h) => h.ascentM),
  };
}
