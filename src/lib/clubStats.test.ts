import { describe, expect, it } from "vitest";
import { clubStats, parseAudience, type StatsAttendee } from "./clubStats";
import type { SUEvent } from "./types";

const event = (id: string, startsAt: string, over: Partial<SUEvent> = {}): SUEvent => ({
  id: `uuid-${id}`,
  suu_event_id: id,
  title: "Chilterns walk, 18 km",
  starts_at: startsAt,
  ends_at: null,
  location: null,
  status: "upcoming",
  capacity: 20,
  tickets_sold: 10,
  price_pence: 0,
  source_reference: null,
  synced_at: startsAt,
  description: "Distance: 18 km",
  ...over,
});

const on = (event_suu_id: string, who: string, checked = true, member = true): StatsAttendee => ({
  event_suu_id,
  member_id: member ? who : null,
  name: who,
  removed: false,
  checked_in_at: checked ? "2026-10-01T09:00:00Z" : null,
});

const now = new Date("2026-11-20T12:00:00Z");

describe("clubStats", () => {
  const events = [
    event("a", "2026-10-04T08:00:00Z"),
    event("b", "2026-11-08T08:00:00Z", { tickets_sold: 20 }),
    event("c", "2026-12-06T08:00:00Z"),
    event("x", "2026-10-18T08:00:00Z", { status: "cancelled" }),
  ];
  const attendees = [on("a", "ann"), on("a", "bob"), on("a", "cat", false), on("b", "ann"), on("b", "Guest Dan", true, false)];

  const stats = clubStats(events, attendees, [{ event_suu_id: "a", leader_member_id: "lee", leader_name: "Lee" }], [], now);

  it("counts walks run and to come, ignoring cancelled ones", () => {
    expect(stats.walksRun).toBe(2);
    expect(stats.walksUpcoming).toBe(1);
  });

  it("counts people once and knows who came back", () => {
    expect(stats.uniqueWalkers).toBe(4);
    expect(stats.repeatRate).toBe(0.25);
  });

  it("works out how full walks were and the no-show rate", () => {
    expect(stats.averageFill).toBe(0.75);
    expect(stats.noShowRate).toBeCloseTo(1 / 5);
  });

  it("buckets walkers by month from September", () => {
    expect(stats.byMonth[1]).toEqual({ label: "Oct", walks: 1, walkers: 3 });
    expect(stats.byMonth[2]).toEqual({ label: "Nov", walks: 1, walkers: 2 });
  });

  it("ranks leaders by walks led", () => {
    expect(stats.topLeaders).toEqual([{ memberId: "lee", name: "Lee", walks: 1 }]);
  });

  it("measures tasters who joined properly", () => {
    const s = clubStats([], [], [], [
      { member_id: "t1", from_tier: null, to_tier: "taster", changed_at: "" },
      { member_id: "t2", from_tier: null, to_tier: "taster", changed_at: "" },
      { member_id: "t1", from_tier: "taster", to_tier: "standard", changed_at: "" },
    ], now);
    expect([s.tastersConverted, s.tasters]).toEqual([1, 2]);
  });
});

describe("parseAudience", () => {
  it("accepts the four audiences and nothing else", () => {
    expect(parseAudience({ type: "all" })).toEqual({ type: "all" });
    expect(parseAudience({ type: "tier", tier: "explorer" })).toEqual({ type: "tier", tier: "explorer" });
    expect(parseAudience({ type: "event", eventSuuId: "su-1" })).toEqual({ type: "event", eventSuuId: "su-1" });
    expect(parseAudience({ type: "tier", tier: "admin" })).toBeNull();
    expect(parseAudience({ type: "everyone" })).toBeNull();
  });
});
