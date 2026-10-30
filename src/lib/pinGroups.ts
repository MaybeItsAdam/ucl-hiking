import type { Difficulty } from "@/lib/eventDetails";
import type { MapHike } from "@/lib/hikeMap";
import type { LatLng } from "@/lib/places";

/*
 * Kept apart from hikeMap.ts, and importing only types, because the map
 * component runs in the browser: hikeMap.ts pulls in places.ts and with it the
 * Supabase client, which has no business in a page's JavaScript.
 */

/** Walks whose pins land within this of each other share one pin. */
const SAME_PIN_M = 150;

/** One pin on the year map: every walk that set off from (about) the same spot. */
export interface PinGroup {
  at: LatLng;
  hikes: MapHike[];
  /** "5" for one walk, "5·9" for a start walked twice. */
  label: string;
  /** Their shared grade, or null when they differ. */
  difficulty: Difficulty | null;
  /** Only when every walk on it is still to come. */
  upcoming: boolean;
}

export function metresApart([aLat, aLng]: LatLng, [bLat, bLng]: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad * Math.cos(((aLat + bLat) / 2) * rad);
  return Math.hypot(dLat, dLng) * 6_371_000;
}

/**
 * The year map's pins. A start walked twice (Seven Sisters from Seaford, in
 * the autumn and again in spring) would put one pin exactly over the other and
 * hide it, so walks setting off within a stone's throw of each other share a
 * pin that carries every number. Each walk keeps its own finish and line.
 */
export function pinGroups(hikes: MapHike[], withinM = SAME_PIN_M): PinGroup[] {
  const groups: { at: LatLng; hikes: MapHike[] }[] = [];
  for (const hike of [...hikes].sort((a, b) => a.n - b.n)) {
    const at = hike.start ?? hike.finish;
    if (!at) continue;
    const group = groups.find((g) => metresApart(g.at, at) <= withinM);
    if (group) group.hikes.push(hike);
    else groups.push({ at, hikes: [hike] });
  }
  return groups.map(({ at, hikes: walks }) => ({
    at,
    hikes: walks,
    label: walks.map((h) => h.n).join("·"),
    difficulty: walks.every((h) => h.difficulty === walks[0].difficulty) ? walks[0].difficulty : null,
    upcoming: walks.every((h) => h.upcoming),
  }));
}
