import { londonDay } from "@/lib/weather";
import { titleSimilarity } from "@/lib/walkSheet";

/**
 * One walk, two `events` rows. `suu_event_id` is unique, but Toolbox lists some
 * events twice under different ids and marks neither as superseded:
 *
 * - the SU relisting a walk word for word ("🥾 Hike: Surrey Three Peaks (28km)"
 *   twice on 7 March 2026), and
 * - a terse copy read off an Instagram post or the term card beside the SU's
 *   own listing ("Epping Forest" next to "🌳Taster Hike (2 of 3): Epping Forest
 *   (16km)").
 *
 * Both halves reached the Events tab, the year map and its totals, and the route
 * catalogue's walk counts. They also stopped the committee calendar linking
 * either one: `matchSuEvent` refuses a tie. So the walk lost its published and
 * visibility rules and showed to everyone.
 *
 * Same London day and a clearly matching title (one title's words inside the
 * other's) make two rows one event. The fuller row survives (see `rank`), so
 * every writer and reader picks the same survivor.
 */

export interface DedupeEvent {
  suu_event_id: string | null;
  title: string;
  starts_at: string | null;
  location?: string | null;
  description?: string | null;
  status?: string | null;
}

/** Shared words over the shorter title's: 1 when one title's words are all in the other. */
const SAME_TITLE = 0.8;

/** Characters. SU listings run from about 300 to 6,000; copies stop well short ("£3 per ticket, festive…", 80). */
const FULL_WRITE_UP = 300;

/** "(14km)", "14 km" */
function distanceKm(title: string): string | null {
  return /(\d+(?:\.\d+)?)\s*km\b/i.exec(title)?.[1] ?? null;
}

/** "(1 of 3)", "#2": the part of a series a title names. */
function seriesNumber(title: string): string | null {
  return /\((\d+)\s+of\s+\d+\)|#\s*(\d+)/i.exec(title)?.slice(1).find(Boolean) ?? null;
}

/** Whether two rows are one event: same London day, matching titles, no number that tells them apart. */
export function sameEvent(a: DedupeEvent, b: DedupeEvent): boolean {
  if (!a.starts_at || !b.starts_at) return false;
  if (a.suu_event_id && a.suu_event_id === b.suu_event_id) return true;
  if (londonDay(a.starts_at) !== londonDay(b.starts_at)) return false;
  return sameTitle(a, b);
}

/** Matching titles with no distance or series number that tells them apart. */
function sameTitle(a: DedupeEvent, b: DedupeEvent): boolean {
  const [ka, kb] = [distanceKm(a.title), distanceKm(b.title)];
  if (ka && kb && ka !== kb) return false;
  const [sa, sb] = [seriesNumber(a.title), seriesNumber(b.title)];
  if (sa && sb && sa !== sb) return false;
  return titleSimilarity(a.title, b.title) >= SAME_TITLE;
}

/**
 * The SU's own listing carries a full write-up, a meeting point and the
 * distance; a copy rarely does more than one of those. The write-up counts most:
 * a copy sometimes has a room ("Lunar New Year Social", "Room LG01") but never
 * the post: an SU write-up runs to hundreds of words, a copy to a line or two.
 */
function rank(e: DedupeEvent, prefer: Set<string>): number {
  let score = 0;
  if (e.suu_event_id && prefer.has(e.suu_event_id)) score += 16;
  if (e.status !== "cancelled") score += 8;
  if ((e.description?.trim().length ?? 0) >= FULL_WRITE_UP) score += 4;
  if (e.location?.trim()) score += 2;
  if (distanceKm(e.title)) score += 1;
  return score;
}

/** A full SU listing: the write-up and a meeting point. */
const isListing = (e: DedupeEvent) => (e.description?.trim().length ?? 0) >= FULL_WRITE_UP && !!e.location?.trim();

/** A stray copy: no write-up and no meeting point. */
const isStrayCopy = (e: DedupeEvent) => (e.description?.trim().length ?? 0) < FULL_WRITE_UP && !e.location?.trim();

/** The London day `days` after `day` ("2026-03-07", 1 -> "2026-03-08"). */
function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Each duplicate row mapped to the row that stands for it. Ties go to the
 * older SU id (cuids sort by creation), so the result never flips between runs.
 * `prefer` names rows that win regardless, e.g. the one a member booked.
 */
export function findDuplicates<T extends DedupeEvent>(events: T[], prefer: Iterable<string> = []): Map<T, T> {
  const preferred = new Set(prefer);
  const byDay = new Map<string, T[]>();
  for (const e of events) {
    if (!e.starts_at) continue;
    const day = londonDay(e.starts_at);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  const losers = new Map<T, T>();
  for (const group of byDay.values()) {
    if (group.length < 2) continue;
    const ranked = group
      .map((e) => ({ e, score: rank(e, preferred) }))
      .sort((x, y) => y.score - x.score || (x.e.suu_event_id ?? "").localeCompare(y.e.suu_event_id ?? ""));
    const kept: T[] = [];
    for (const { e } of ranked) {
      const winner = kept.find((k) => sameEvent(k, e));
      if (winner) losers.set(e, winner);
      else kept.push(e);
    }
  }
  // A stray copy dated a day off its walk ("Colne Valley Walk" on 7 March for
  // the SU's 8 March listing): it folds into a full listing with a matching
  // title on the day either side. Two real walks of one name on consecutive
  // days both carry a listing, so they stay apart.
  const survivors = new Map<string, T[]>();
  for (const [day, group] of byDay) survivors.set(day, group.filter((e) => !losers.has(e)));
  for (const [day, group] of survivors) {
    for (const e of group) {
      if (!isStrayCopy(e) || (e.suu_event_id && preferred.has(e.suu_event_id))) continue;
      const winner = [...(survivors.get(shiftDay(day, -1)) ?? []), ...(survivors.get(shiftDay(day, 1)) ?? [])].find(
        (k) => isListing(k) && !losers.has(k) && sameTitle(k, e),
      );
      if (winner) losers.set(e, winner);
    }
  }
  return losers;
}

/** The events with each duplicate dropped, in their original order. */
export function dedupeEvents<T extends DedupeEvent>(events: T[], prefer: Iterable<string> = []): T[] {
  const losers = findDuplicates(events, prefer);
  return losers.size ? events.filter((e) => !losers.has(e)) : events;
}
