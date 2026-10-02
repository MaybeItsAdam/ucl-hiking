import { nameKey, parseNumber, rosterIndex, walkLeaders, type RosterEntry, type Values } from "@/lib/walkSheet";

/**
 * Walks led and distance walked, per walk leader, from the committee
 * calendar. A walk counts once it has happened and wasn't cancelled; every
 * named leader gets it (shadowing is counted apart). Names are joined up
 * through the roster's "also written as", so "Val" and "Valentino" are one.
 */

export interface BoardWalk {
  starts_on: string | null;
  title: string;
  sheet_values: Values;
  shown: Values;
}

export interface BoardRow {
  key: string;
  name: string;
  walks: number;
  km: number;
  shadowed: number;
  lastWalk: string | null;
}

/** A walk that counts: in the past, not cancelled, and with a distance. */
export function countsForBoard(walk: BoardWalk, today: string): number | null {
  if (!walk.starts_on || walk.starts_on >= today) return null;
  if (/cancel/i.test(walk.shown.status ?? "") || /cancel/i.test(walk.title)) return null;
  return parseNumber(walk.sheet_values.distanceKm ?? "") ?? parseNumber(walk.shown.distanceShown ?? "");
}

export function leaderboard(walks: BoardWalk[], roster: RosterEntry[], today: string): BoardRow[] {
  const index = rosterIndex(roster);
  const rows = new Map<string, BoardRow>();
  const row = (name: string) => {
    const entry = index.get(nameKey(name));
    const key = entry ? `r:${entry.row}` : `n:${nameKey(name)}`;
    let r = rows.get(key);
    if (!r) {
      r = { key, name: entry?.name ?? name, walks: 0, km: 0, shadowed: 0, lastWalk: null };
      rows.set(key, r);
    }
    return r;
  };
  for (const walk of walks) {
    const km = countsForBoard(walk, today);
    if (km === null) continue;
    const { leaders, shadows } = walkLeaders(walk.sheet_values, walk.shown);
    const credited = new Set<string>();
    for (const m of leaders) {
      const r = row(m.name);
      if (credited.has(r.key)) continue;
      credited.add(r.key);
      r.walks += 1;
      r.km += km;
      if (!r.lastWalk || walk.starts_on! > r.lastWalk) r.lastWalk = walk.starts_on;
    }
    for (const m of shadows) {
      const r = row(m.name);
      if (credited.has(r.key)) continue;
      credited.add(r.key);
      r.shadowed += 1;
    }
  }
  return [...rows.values()]
    .filter((r) => r.walks > 0 || r.shadowed > 0)
    .sort((a, b) => b.walks - a.walks || b.km - a.km || a.name.localeCompare(b.name));
}
