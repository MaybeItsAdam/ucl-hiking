import { describe, expect, it } from "vitest";
import type { BoardWalk } from "./leaderboard";
import type { RosterEntry } from "./walkSheet";
import {
  calendarWalksLed,
  claimedWalks,
  claimStatuses,
  identityOf,
  isClaimRow,
  isTheirs,
  leadsWalk,
  outstandingClaims,
  plannedWalksLed,
  type ClaimRow,
  type LedWalk,
  type PlannedEvent,
} from "./walkClaims";

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

  it("is linked by roster email or by the app's calendar name, and not otherwise", () => {
    expect(val.linked).toBe(true);
    expect(val.calendarName).toBe("Val");
    const byName = identityOf({ email: "other@gmail.com", full_name: "V W", wl_name: "Valentino" }, roster);
    expect(byName.linked).toBe(true);
    expect([...byName.leaderNames]).toEqual(["val", "valentino"]);
    expect(identityOf({ email: "z@ucl.ac.uk", full_name: "Zahra Khan", wl_name: null }, roster).linked).toBe(false);
  });

  // The roster sync adds every calendar name it sees with no email. A leader
  // whose calendar name is their first name, and whose sign-in email isn't on
  // the roster, used to get no names at all (the unlinked row counted as
  // someone else's), so none of their walks were found and My walks showed
  // nothing for them.
  describe("leaders whose roster row has no email yet", () => {
    const unlinked: RosterEntry[] = [
      ...roster,
      { row: 4, name: "Slava", email: null, aliases: ["Slav"], firstAid: false, firstAidUntil: null, active: true },
      { row: 5, name: "Kelvin Okafor", email: null, aliases: [], firstAid: false, firstAidUntil: null, active: true },
    ];

    it("takes the row under their first name, with its aliases", () => {
      const slava = identityOf({ email: "s.petrova.23@ucl.ac.uk", full_name: "Slava Petrova", wl_name: null }, unlinked);
      expect([...slava.leaderNames]).toEqual(["slava", "slav"]);
      expect(slava.linked).toBe(false);
      expect(slava.calendarName).toBe("Slava");
      expect(leadsWalk({ sheet_values: { leader1: "Slava (+)" }, shown: {} }, slava)).toBe(true);
    });

    it("takes the row under their full name", () => {
      const kelvin = identityOf({ email: "k@ucl.ac.uk", full_name: "Kelvin Okafor", wl_name: null }, unlinked);
      expect([...kelvin.leaderNames]).toEqual(["kelvin okafor"]);
    });

    it("never takes a row that carries someone else's email", () => {
      // Signs in with a different address from the one on the roster: the row isn't theirs to take.
      const imposter = identityOf({ email: "val.personal@gmail.com", full_name: "Val Walker", wl_name: null }, unlinked);
      expect([...imposter.leaderNames]).toEqual([]);
      expect(imposter.linked).toBe(false);
    });

    it("leaves a nickname to them to pick: not linked, so My walks asks", () => {
      const who = identityOf({ email: "v.ivanov.24@ucl.ac.uk", full_name: "Vyacheslav Ivanov", wl_name: null }, unlinked);
      expect(leadsWalk({ sheet_values: { leader1: "Slava" }, shown: {} }, who)).toBe(false);
      expect(who.linked).toBe(false);
    });
  });
});

describe("claimStatuses and outstandingClaims", () => {
  const walks = [walk("a", "2026-10-04"), walk("b", "2026-10-11"), walk("c", "2026-09-20")];

  it("marks each walk, newest first, and lists the unclaimed oldest first", () => {
    const statuses = claimStatuses(walks, [claim("2026-10-11", { preferred: "Val" })], val);
    expect(statuses.map((w) => [w.key, w.claimed])).toEqual([
      ["b", true],
      ["a", false],
      ["c", false],
    ]);
    expect(outstandingClaims(statuses).map((w) => w.key)).toEqual(["c", "a"]);
  });

  it("keeps the walks with an unknown status when the spreadsheet didn't answer", () => {
    const statuses = claimStatuses(walks, null, val);
    expect(statuses).toHaveLength(3);
    expect(statuses.every((w) => w.claimed === null)).toBe(true);
    expect(outstandingClaims(statuses)).toEqual([]);
  });
});

describe("plannedWalksLed", () => {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const event = (id: string, starts: string, over: Partial<PlannedEvent> = {}): PlannedEvent => ({
    id,
    suu_event_id: `su-${id}`,
    title: id,
    starts_at: `${starts}T09:00:00Z`,
    ends_at: null,
    status: "completed",
    ...over,
  });

  it("adds past planned walks the calendar doesn't already credit", () => {
    const planned = [
      event("e1", "2026-10-04"),
      event("e2", "2026-10-05"), // same event as a calendar walk
      event("e3", "2026-10-11"), // same day as a calendar walk
      event("e4", "2026-10-18", { status: "cancelled" }),
      event("e5", "2026-11-30"), // not happened yet
      event("e6", "2026-06-01"), // before the window
    ];
    const already = [
      { date: "2026-10-06", eventSuuId: "su-e2" },
      { date: "2026-10-11", eventSuuId: null },
    ];
    expect(plannedWalksLed(planned, already, "2026-08-01", "2026-11-19", day).map((w) => [w.key, w.eventId])).toEqual([["event:e1", "e1"]]);
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

describe("leadsWalk", () => {
  it("counts a named leader by any of their names, from the sign-ups or the calendar", () => {
    expect(leadsWalk({ sheet_values: { leader2: "Valentino (+)" }, shown: {} }, val)).toBe(true);
    expect(leadsWalk({ sheet_values: {}, shown: { firstAider: "Val" } }, val)).toBe(true);
  });
  it("doesn't count a shadow, a TBC, or someone else", () => {
    expect(leadsWalk({ sheet_values: { leader1: "Gigi", shadowing: "Val" }, shown: {} }, val)).toBe(false);
    expect(leadsWalk({ sheet_values: { leader1: "Val?" }, shown: {} }, val)).toBe(false);
    expect(leadsWalk({ sheet_values: { leader1: "Gigi" }, shown: {} }, val)).toBe(false);
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
