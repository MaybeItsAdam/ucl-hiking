import { countsForBoard, type BoardWalk } from "@/lib/leaderboard";
import { nameKey, rosterIndex, walkLeaders, type RosterEntry } from "@/lib/walkSheet";

/**
 * Which walks a walk leader has led but not yet claimed for. The claims are
 * the reimbursement spreadsheet's walk-leader rows, from the Google Form and
 * from the app alike (the Apps Script reads both); the walks are the
 * committee calendar's, plus any the app's own plans name them on.
 */

/** One walk-leader claim, as the Apps Script reports it. */
export interface ClaimRow {
  /** The walk's date, "2026-10-18". */
  date: string;
  /** "Full Name (as on UCL ID)". */
  name: string;
  /** The name they lead under on the WL calendar. */
  preferred: string;
  /** Every email on the row, lower case: their UCL email and, from the app, the one they sign in with. */
  emails: string[];
}

export interface LedWalk {
  key: string;
  date: string;
  /** Last day of a trip that runs over several days. */
  endDate: string | null;
  title: string;
  /** The app's event page, when the walk is linked to one. */
  eventId: string | null;
}

/** Who a claim or a calendar cell might be naming, as lookup keys. */
export interface Identity {
  emails: Set<string>;
  /** Full names as on their UCL ID and calendar names, through nameKey. */
  names: Set<string>;
  /** The names they lead under on the calendar, through nameKey. */
  leaderNames: Set<string>;
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

export function isClaimRow(value: unknown): value is ClaimRow {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.date === "string" &&
    isoDay.test(r.date) &&
    typeof r.name === "string" &&
    typeof r.preferred === "string" &&
    Array.isArray(r.emails) &&
    r.emails.every((e) => typeof e === "string")
  );
}

/**
 * Their keys: sign-in email and full name, and the roster's say on the names
 * they lead under (found by email, else by the name the app has for them).
 * With no roster entry and no calendar name, their first name stands in,
 * unless the roster gives that name to someone else.
 */
export function identityOf(
  member: { email: string; full_name: string | null; wl_name: string | null },
  roster: RosterEntry[],
): Identity {
  const email = member.email.trim().toLowerCase();
  const index = rosterIndex(roster);
  const entry =
    roster.find((r) => r.email === email) ?? (member.wl_name ? index.get(nameKey(member.wl_name)) : undefined);

  const leaderNames = new Set<string>();
  const add = (n: string | null | undefined) => {
    const k = n ? nameKey(n) : "";
    if (k) leaderNames.add(k);
  };
  if (entry) [entry.name, ...entry.aliases].forEach(add);
  add(member.wl_name);
  if (!leaderNames.size && member.full_name) {
    const first = nameKey(member.full_name.trim().split(/\s+/)[0] ?? "");
    const other = index.get(first);
    if (first.length > 1 && (!other || (other.email && other.email === email))) leaderNames.add(first);
  }

  const names = new Set(leaderNames);
  if (member.full_name && nameKey(member.full_name)) names.add(nameKey(member.full_name));
  const emails = new Set([email]);
  if (entry?.email) emails.add(entry.email);
  return { emails, names, leaderNames };
}

/** A claim is theirs if it carries one of their emails, or their full or calendar name. */
export function isTheirs(row: ClaimRow, who: Identity): boolean {
  if (row.emails.some((e) => who.emails.has(e.trim().toLowerCase()))) return true;
  return [row.preferred, row.name].some((n) => {
    const k = nameKey(n);
    return k.length > 1 && who.names.has(k);
  });
}

/** The calendar walks they led that have happened and weren't cancelled, from `since`. */
export function calendarWalksLed(
  walks: (BoardWalk & { row_key: string; event_suu_id: string | null })[],
  who: Identity,
  today: string,
  since: string,
): (LedWalk & { eventSuuId: string | null })[] {
  const out: (LedWalk & { eventSuuId: string | null })[] = [];
  for (const walk of walks) {
    if (!walk.starts_on || walk.starts_on < since || countsForBoard(walk, today) === null) continue;
    // Every named leader, as the leaderboard counts them; shadows and anyone marked TBC aren't.
    if (!walkLeaders(walk.sheet_values, walk.shown).leaders.some((m) => who.leaderNames.has(nameKey(m.name)))) continue;
    out.push({
      key: `sheet:${walk.row_key}`,
      date: walk.starts_on,
      endDate: null,
      title: walk.title,
      eventId: null,
      eventSuuId: walk.event_suu_id,
    });
  }
  return out;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pairs each of their claims with at most one walk: first a claim dated
 * within the walk (its day, or any day of a trip), then one a day either side,
 * which absorbs time-zone slips and a trip claimed by its travel day.
 * Returns the keys of the walks with a claim.
 */
export function claimedWalks(walks: LedWalk[], claims: ClaimRow[], who: Identity): Set<string> {
  const theirs = claims.filter((c) => isTheirs(c, who)).map((c) => c.date);
  const used = new Set<number>();
  const claimed = new Set<string>();
  const pass = (slack: number) => {
    for (const walk of walks) {
      if (claimed.has(walk.key)) continue;
      const from = addDays(walk.date, -slack);
      const to = addDays(walk.endDate && walk.endDate > walk.date ? walk.endDate : walk.date, slack);
      const i = theirs.findIndex((d, j) => !used.has(j) && d >= from && d <= to);
      if (i === -1) continue;
      used.add(i);
      claimed.add(walk.key);
    }
  };
  pass(0);
  pass(1);
  return claimed;
}
