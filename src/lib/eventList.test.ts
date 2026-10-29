import { describe, expect, it } from "vitest";
import { countdown, eventWhen, groupEventsByMonth, joinMultiDayEvents } from "./eventList";
import type { SUEvent } from "./types";

function event(overrides: Partial<SUEvent>): SUEvent {
  return {
    id: "e", suu_event_id: "e", title: "Walk", starts_at: null, ends_at: null, location: null,
    status: "upcoming", capacity: 0, tickets_sold: 0, price_pence: 0, source_reference: null,
    synced_at: "2026-09-01T00:00:00Z", ...overrides,
  };
}

describe("eventWhen", () => {
  it("shows London times, not the server's", () => {
    // 08:00 UTC is 09:00 BST.
    expect(eventWhen(event({ starts_at: "2026-10-03T08:00:00Z", ends_at: "2026-10-03T16:30:00Z" }))).toBe("09:00–17:30");
  });

  it("spans days for a weekend away", () => {
    expect(
      eventWhen(event({ starts_at: "2026-10-03T07:00:00Z", ends_at: "2026-10-04T18:00:00Z" })),
    ).toBe("Sat 3 Oct, 08:00 – Sun 4 Oct, 19:00");
  });

  it("says all day without a time", () => {
    expect(eventWhen(event({ starts_at: "2026-10-03T00:00:00Z", is_all_day: true }))).toBe("All day");
  });
});

describe("groupEventsByMonth", () => {
  it("groups consecutive events under their London month", () => {
    const months = groupEventsByMonth([
      event({ id: "a", starts_at: "2026-09-30T22:30:00Z" }), // 23:30 BST on 30 Sep
      event({ id: "b", starts_at: "2026-10-01T09:00:00Z" }),
      event({ id: "c", starts_at: "2026-10-10T09:00:00Z" }),
    ]);
    expect(months.map((m) => [m.label, m.items.map((i) => i.event.id)])).toEqual([
      ["September 2026", ["a"]],
      ["October 2026", ["b", "c"]],
    ]);
    expect(months[0].items[0]).toMatchObject({ weekday: "Wed", day: "30" });
  });
});

describe("countdown", () => {
  const now = new Date("2026-10-03T21:00:00Z"); // 22:00 BST, Saturday 3 Oct

  it("counts London calendar days, not 24-hour periods", () => {
    // 23:30 UTC on the 3rd is 00:30 BST on the 4th: tomorrow, though under 3 hours away.
    expect(countdown(event({ starts_at: "2026-10-03T23:30:00Z" }), now)).toEqual({ label: "Tomorrow", past: false });
    expect(countdown(event({ starts_at: "2026-10-03T08:00:00Z" }), now)).toEqual({ label: "Today", past: false });
    expect(countdown(event({ starts_at: "2026-10-08T08:00:00Z" }), now)?.label).toBe("In 5 days");
    expect(countdown(event({ starts_at: "2026-09-26T08:00:00Z" }), now)).toEqual({ label: "7 days ago", past: true });
  });

  it("says a weekend away is on while it runs", () => {
    expect(
      countdown(event({ starts_at: "2026-10-02T08:00:00Z", ends_at: "2026-10-04T18:00:00Z" }), now)?.label,
    ).toBe("Happening now");
  });
});

describe("joinMultiDayEvents", () => {
  const trip = "🧭 Club Trip #1: Lake District ⛰️🗺️";
  const day = (id: string, date: string) =>
    event({ id, suu_event_id: id, title: trip, starts_at: `${date}T07:00:00+00:00`, ends_at: `${date}T18:00:00+00:00` });

  it("shows Toolbox's per-day rows of a trip as one event", () => {
    const joined = joinMultiDayEvents([day("a", "2026-11-08"), day("b", "2026-11-09"), day("c", "2026-11-10"), day("d", "2026-11-11")]);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ id: "a", starts_at: "2026-11-08T07:00:00+00:00", ends_at: "2026-11-11T18:00:00+00:00" });
    expect(eventWhen(joined[0])).toBe("Sun 8 Nov, 07:00 – Wed 11 Nov, 18:00");
  });

  it("joins across another event on one of the days", () => {
    const social = event({ id: "s", title: "Pub social", starts_at: "2026-11-09T19:00:00Z" });
    expect(joinMultiDayEvents([day("a", "2026-11-08"), day("b", "2026-11-09"), social]).map((e) => e.id)).toEqual(["a", "s"]);
  });

  it("keeps a repeat of the same title a week later apart", () => {
    expect(joinMultiDayEvents([day("a", "2026-11-08"), day("b", "2026-11-15")])).toHaveLength(2);
  });

  it("leaves the rows it was given alone", () => {
    const first = day("a", "2026-11-08");
    joinMultiDayEvents([first, day("b", "2026-11-09")]);
    expect(first.ends_at).toBe("2026-11-08T18:00:00+00:00");
  });
});
