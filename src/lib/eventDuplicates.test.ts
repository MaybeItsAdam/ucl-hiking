import { describe, expect, it } from "vitest";
import { dedupeEvents, findDuplicates, sameEvent, type DedupeEvent } from "./eventDuplicates";

const WRITE_UP = "x".repeat(4800);

function ev(suu_event_id: string, title: string, starts_at: string, extra: Partial<DedupeEvent> = {}): DedupeEvent {
  return { suu_event_id, title, starts_at, location: null, description: null, status: "upcoming", ...extra };
}

// Shapes taken from production rows (March 2026).
const listing = ev("cmm5k4fw8", "🥾 Hike: Surrey Three Peaks (28km)", "2026-03-07T08:00:00Z", {
  location: "London Victoria Train Station",
  description: WRITE_UP,
});
const relisting = ev("cmmb9vn90", "🥾 Hike: Surrey Three Peaks (28km)", "2026-03-07T08:00:00Z", {
  location: "London Victoria Train Station",
  description: WRITE_UP,
});
const terseCopy = ev("cmmseqtuh", "Surrey Three Peaks hike", "2026-03-07T00:00:00Z", { description: "Meet at Victoria 8am" });

describe("sameEvent", () => {
  it("matches a word-for-word relisting and a terse copy on the same London day", () => {
    expect(sameEvent(listing, relisting)).toBe(true);
    expect(sameEvent(listing, terseCopy)).toBe(true);
  });

  it("uses the London day, not the UTC one", () => {
    // 23:30 UTC on 6 March is 7 March in London summer time only; in March it is still the 6th.
    expect(sameEvent(listing, ev("x", "Surrey Three Peaks", "2026-03-06T23:30:00Z"))).toBe(false);
    expect(sameEvent(ev("a", "Box Hill", "2026-06-06T23:30:00Z"), ev("b", "Box Hill", "2026-06-07T09:00:00Z"))).toBe(true);
  });

  it("keeps different walks apart", () => {
    expect(sameEvent(ev("a", "Hike: Box Hill (16km)", "2026-03-07T08:00:00Z"), ev("b", "Hike: Leith Hill (16km)", "2026-03-07T08:00:00Z"))).toBe(false);
    // Different distances or different parts of a series are different events.
    expect(sameEvent(ev("a", "Hike: Box Hill (16km)", "2026-03-07T08:00:00Z"), ev("b", "Hike: Box Hill (24km)", "2026-03-07T08:00:00Z"))).toBe(false);
    expect(
      sameEvent(ev("a", "Taster Hike (1 of 3): Epping", "2026-01-25T09:00:00Z"), ev("b", "Taster Hike (2 of 3): Epping", "2026-01-25T09:00:00Z")),
    ).toBe(false);
    expect(sameEvent(listing, ev("x", "Surrey Three Peaks", "2026-03-08T08:00:00Z"))).toBe(false);
  });

  it("never matches a row without a start", () => {
    expect(sameEvent(listing, ev("x", listing.title, null as unknown as string))).toBe(false);
  });
});

describe("findDuplicates", () => {
  it("keeps the SU listing over a terse copy, whatever the order", () => {
    const epping = ev("cmkeny9n2", "🌳Taster Hike (2 of 3): Epping Forest (16km)", "2026-01-25T09:00:00Z", {
      location: "Woodford Underground Station",
      description: WRITE_UP,
    });
    const copy = ev("cmkun76ps", "Epping Forest", "2026-01-25T00:00:00Z", { description: "From the term card" });
    for (const rows of [
      [epping, copy],
      [copy, epping],
    ]) {
      const losers = findDuplicates(rows);
      expect(losers.size).toBe(1);
      expect(losers.get(copy)).toBe(epping);
    }
  });

  it("prefers the full write-up over a copy that only has a room", () => {
    const su = ev("cml9ntk26", "Social: 🎉: Lunar New Year Social 🐎🧧", "2026-02-11T18:00:00Z", { description: "y".repeat(1300) });
    const copy = ev("cml0ybgr5", "Lunar New Year Social", "2026-02-11T18:00:00Z", { location: "Room LG01", description: "£3 per ticket" });
    expect(findDuplicates([copy, su]).get(copy)).toBe(su);
  });

  it("breaks an exact tie by the older SU id, so the survivor is stable", () => {
    expect(findDuplicates([relisting, listing]).get(relisting)).toBe(listing);
    expect(findDuplicates([listing, relisting]).get(relisting)).toBe(listing);
  });

  it("folds three copies into one", () => {
    const losers = findDuplicates([terseCopy, relisting, listing]);
    expect([...losers.keys()].sort((a, b) => a.suu_event_id!.localeCompare(b.suu_event_id!))).toEqual([relisting, terseCopy]);
    expect(new Set(losers.values())).toEqual(new Set([listing]));
  });

  it("lets a preferred id win, e.g. the copy a member booked", () => {
    expect(findDuplicates([listing, terseCopy], ["cmmseqtuh"]).get(listing)).toBe(terseCopy);
  });

  it("puts a cancelled copy behind a live one", () => {
    const cancelled = { ...listing, status: "cancelled" };
    expect(findDuplicates([cancelled, terseCopy]).get(cancelled)).toBe(terseCopy);
  });
});

describe("findDuplicates across a day", () => {
  // Production: the copy is dated 7 March, the SU listing 8 March.
  const colne = ev("cmm9colne", "👣 Walk: Colne Valley Walk (14km)", "2026-03-08T09:30:00Z", {
    location: "Uxbridge Station",
    description: WRITE_UP,
  });
  const strayCopy = ev("cmmacolne", "Colne Valley Walk", "2026-03-07T00:00:00Z", { description: "From the term card" });

  it("folds a stray copy dated a day off into the full listing", () => {
    for (const rows of [
      [colne, strayCopy],
      [strayCopy, colne],
    ]) {
      const losers = findDuplicates(rows);
      expect(losers.size).toBe(1);
      expect(losers.get(strayCopy)).toBe(colne);
    }
  });

  it("keeps two listed walks of one name on consecutive days apart", () => {
    const sunday = ev("cmm9colnf", "👣 Walk: Colne Valley Walk (14km)", "2026-03-09T09:30:00Z", {
      location: "Uxbridge Station",
      description: WRITE_UP,
    });
    expect(findDuplicates([colne, sunday]).size).toBe(0);
  });

  it("leaves a copy two days off, or with a meeting point, alone", () => {
    const early = ev("cmmbcolne", "Colne Valley Walk", "2026-03-06T00:00:00Z");
    const located = ev("cmmccolne", "Colne Valley Walk", "2026-03-07T00:00:00Z", { location: "Uxbridge" });
    expect(findDuplicates([colne, early]).size).toBe(0);
    expect(findDuplicates([colne, located]).size).toBe(0);
  });

  it("keeps a stray copy a member booked", () => {
    expect(findDuplicates([colne, strayCopy], ["cmmacolne"]).size).toBe(0);
  });

  it("does not fold a copy into a different distance", () => {
    const short = ev("cmmdcolne", "Colne Valley Walk (8km)", "2026-03-07T00:00:00Z");
    expect(findDuplicates([colne, short]).size).toBe(0);
  });
});

describe("dedupeEvents", () => {
  it("drops duplicates and keeps the original order", () => {
    const other = ev("zzz", "Walk: Ouse Valley Viaduct Loop (12km)", "2026-03-01T09:00:00Z");
    expect(dedupeEvents([other, terseCopy, listing, relisting])).toEqual([other, listing]);
  });

  it("returns the same array when nothing repeats", () => {
    const rows = [listing, ev("b", "Hike: Leith Hill", "2026-03-08T08:00:00Z")];
    expect(dedupeEvents(rows)).toBe(rows);
  });
});
