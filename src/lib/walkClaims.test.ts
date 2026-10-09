import { describe, expect, it } from "vitest";
import type { BoardWalk } from "./leaderboard";
import type { RosterEntry } from "./walkSheet";
import { calendarWalksLed, claimedWalks, identityOf, isClaimRow, isTheirs, type ClaimRow, type LedWalk } from "./walkClaims";

const roster: RosterEntry[] = [
  { row: 2, name: "Val", email: "v.walker.24@ucl.ac.uk", aliases: ["Valentino"], firstAid: true, firstAidUntil: null, active: true },
  { row: 3, name: "Gigi", email: "g.hill.23@ucl.ac.uk", aliases: [], firstAid: false, firstAidUntil: null, active: true },
];
const val = identityOf({ email: "V.Walker.24@ucl.ac.uk", full_name: "Valentino Walker", wl_name: null }, roster);

const claim = (date: string, over: Partial<ClaimRow> = {}): ClaimRow => ({ date, name: "", preferred: "", emails: [], ...over });
const walk = (key: string, date: string, endDate: string | null = null): LedWalk => ({ key, date, endDate, title: key, eventId: null });

describe("identityOf", () => {
  it("finds them on the roster by email and takes its names and aliases", () => {
    expect([...val.leaderNames]).toEqual(["val", "valentino"]);
    expect(val.emails.has("v.walker.24@ucl.ac.uk")).toBe(true);
    expect(val.names.has("valentino walker")).toBe(true);
  });

  it("falls back to their first name, unless the roster gives it to someone else", () => {
    expect([...identityOf({ email: "z@ucl.ac.uk", full_name: "Zahra Khan", wl_name: null }, roster).leaderNames]).toEqual(["zahra"]);
    expect([...identityOf({ email: "z@ucl.ac.uk", full_name: "Gigi Other", wl_name: null }, roster).leaderNames]).toEqual([]);
  });
});

describe("isTheirs", () => {
  it("matches any email on the row, whatever the case", () => {
    expect(isTheirs(claim("2026-10-04", { emails: ["v.walker.24@ucl.ac.uk"] }), val)).toBe(true);
  });
  it("matches the calendar name or the full name, ignoring accents and punctuation", () => {
    expect(isTheirs(claim("2026-10-04", { preferred: " Válentino " }), val)).toBe(true);
    expect(isTheirs(claim("2026-10-04", { name: "VALENTINO WALKER" }), val)).toBe(true);
    expect(isTheirs(claim("2026-10-04", { name: "Gigi Hill", emails: ["g.hill.23@ucl.ac.uk"] }), val)).toBe(false);
  });
});

describe("claimedWalks", () => {
  it("pairs each claim with one walk, exact dates first, then a day either side", () => {
    const walks = [walk("a", "2026-10-04"), walk("b", "2026-10-05"), walk("c", "2026-09-20")];
    const claims = [claim("2026-10-05", { preferred: "Val" }), claim("2026-10-04", { preferred: "Val" }), claim("2026-09-21", { preferred: "Val" })];
    expect([...claimedWalks(walks, claims, val)].sort()).toEqual(["a", "b", "c"]);
  });

  it("doesn't let one claim cover two walks", () => {
    const walks = [walk("sat", "2026-10-03"), walk("sun", "2026-10-04")];
    expect([...claimedWalks(walks, [claim("2026-10-04", { preferred: "Val" })], val)]).toEqual(["sun"]);
  });

  it("counts a claim dated on any day of a trip", () => {
    expect([...claimedWalks([walk("trip", "2026-10-10", "2026-10-12")], [claim("2026-10-11", { preferred: "Val" })], val)]).toEqual(["trip"]);
  });

  it("ignores other leaders' claims", () => {
    expect(claimedWalks([walk("a", "2026-10-04")], [claim("2026-10-04", { preferred: "Gigi" })], val).size).toBe(0);
  });
});

describe("calendarWalksLed", () => {
  const row = (over: Partial<BoardWalk> & { starts_on: string }): BoardWalk & { row_key: string; event_suu_id: string | null } => ({
    row_key: `k-${over.starts_on}`,
    event_suu_id: null,
    title: "Box Hill",
    sheet_values: {},
    shown: {},
    ...over,
  });

  it("finds past, uncancelled walks they're named on, by any of their names", () => {
    const walks = [
      row({ starts_on: "2026-10-04", sheet_values: { leader1: "Valentino (+)", leader2: "Gigi" } }),
      row({ starts_on: "2026-10-05", sheet_values: { leader1: "Gigi" } }),
      row({ starts_on: "2026-09-27", shown: { firstAider: "Val", status: "CANCELLED" } }),
      row({ starts_on: "2026-10-11", sheet_values: { leader1: "Val" } }),
      row({ starts_on: "2026-09-20", sheet_values: { leader1: "Val?" } }),
      row({ starts_on: "2026-09-13", sheet_values: { leader1: "Gigi", shadowing: "Val" } }),
    ];
    expect(calendarWalksLed(walks, val, "2026-10-09", "2026-07-01").map((w) => w.date)).toEqual(["2026-10-04"]);
  });
});

describe("isClaimRow", () => {
  it("takes the script's rows and nothing malformed", () => {
    expect(isClaimRow({ date: "2026-10-04", name: "A", preferred: "", emails: ["a@ucl.ac.uk"] })).toBe(true);
    expect(isClaimRow({ date: "04/10/2026", name: "A", preferred: "", emails: [] })).toBe(false);
    expect(isClaimRow({ date: "2026-10-04", name: "A", emails: [] })).toBe(false);
  });
});
