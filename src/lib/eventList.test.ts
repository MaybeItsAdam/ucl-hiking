import { describe, expect, it } from "vitest";
import {
  countdown,
  eventEndsAt,
  eventWhen,
  groupEventsByMonth,
  isEventCurrent,
  isOnToday,
  joinMultiDayEvents,
  startOfLondonDay,
} from "./eventList";
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

  it("says an all-day trip is on during its last day", () => {
    const trip = event({ starts_at: "2026-10-30T00:00:00Z", ends_at: "2026-11-01T00:00:00Z", is_all_day: true });
    expect(countdown(trip, new Date("2026-11-01T12:00:00Z"))).toEqual({ label: "Happening now", past: false });
    expect(countdown(trip, new Date("2026-11-02T09:00:00Z"))?.past).toBe(true);
  });

  it("keeps today's all-day walk as today all day", () => {
    const halloween = event({ starts_at: "2026-10-31T00:00:00Z", is_all_day: true });
    expect(countdown(halloween, new Date("2026-10-31T23:30:00Z"))).toEqual({ label: "Today", past: false });
  });
});

describe("isEventCurrent", () => {
  // Saturday 31 October 2026, a week after the clocks went back: London is on GMT.
  const at = (iso: string) => new Date(iso);

  describe("an all-day event", () => {
    // How the Halloween walk is stored: London midnight, no end.
    const halloween = event({ title: "Halloween on the Cuckmere Pilgrim Path", starts_at: "2026-10-31T00:00:00Z", is_all_day: true });

    it("stays current for the whole of its London day", () => {
      expect(isEventCurrent(halloween, at("2026-10-31T00:00:00Z"))).toBe(true);
      expect(isEventCurrent(halloween, at("2026-10-31T10:00:00Z"))).toBe(true);
      expect(isEventCurrent(halloween, at("2026-10-31T23:59:59Z"))).toBe(true);
      expect(isEventCurrent(halloween, at("2026-11-01T00:00:00Z"))).toBe(false);
      expect(eventEndsAt(halloween)?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    });

    it("reads an end on the same day as that day, whatever its time", () => {
      for (const ends_at of ["2026-10-31T00:00:00Z", "2026-10-31T23:59:00Z", "2026-10-31T09:00:00Z"]) {
        const e = event({ starts_at: "2026-10-31T00:00:00Z", ends_at, is_all_day: true });
        expect(isEventCurrent(e, at("2026-10-31T21:00:00Z"))).toBe(true);
        expect(isEventCurrent(e, at("2026-11-01T00:00:00Z"))).toBe(false);
      }
    });

    it("is upcoming the day before and gone the day after", () => {
      expect(isEventCurrent(halloween, at("2026-10-30T12:00:00Z"))).toBe(true);
      expect(isEventCurrent(halloween, at("2026-11-01T12:00:00Z"))).toBe(false);
    });
  });

  describe("an event with no end time", () => {
    const walk = event({ starts_at: "2026-10-31T09:00:00Z" });

    it("stays current until the end of its London day, not its start", () => {
      expect(isEventCurrent(walk, at("2026-10-31T08:00:00Z"))).toBe(true);
      expect(isEventCurrent(walk, at("2026-10-31T15:00:00Z"))).toBe(true);
      expect(isEventCurrent(walk, at("2026-11-01T00:00:00Z"))).toBe(false);
    });

    it("treats an end before its start as no end", () => {
      const odd = event({ starts_at: "2026-10-31T09:00:00Z", ends_at: "2026-10-31T08:00:00Z" });
      expect(isEventCurrent(odd, at("2026-10-31T20:00:00Z"))).toBe(true);
    });
  });

  describe("an event with an end time", () => {
    const walk = event({ starts_at: "2026-10-31T09:00:00Z", ends_at: "2026-10-31T17:00:00Z" });

    it("is current until it ends, and before it starts", () => {
      expect(isEventCurrent(walk, at("2026-10-31T07:00:00Z"))).toBe(true);
      expect(isEventCurrent(walk, at("2026-10-31T12:00:00Z"))).toBe(true);
      expect(isEventCurrent(walk, at("2026-10-31T16:59:59Z"))).toBe(true);
      expect(isEventCurrent(walk, at("2026-10-31T17:00:00Z"))).toBe(false);
    });
  });

  describe("a multi-day trip", () => {
    it("runs to its end time when it has one", () => {
      const trip = event({ starts_at: "2026-10-30T08:00:00Z", ends_at: "2026-11-01T18:00:00Z" });
      expect(isEventCurrent(trip, at("2026-10-31T12:00:00Z"))).toBe(true);
      expect(isEventCurrent(trip, at("2026-11-01T17:00:00Z"))).toBe(true);
      expect(isEventCurrent(trip, at("2026-11-01T18:30:00Z"))).toBe(false);
    });

    it("runs to the end of its last day when all day", () => {
      const trip = event({ starts_at: "2026-10-30T00:00:00Z", ends_at: "2026-11-01T00:00:00Z", is_all_day: true });
      expect(isEventCurrent(trip, at("2026-11-01T23:00:00Z"))).toBe(true);
      expect(isEventCurrent(trip, at("2026-11-02T00:00:00Z"))).toBe(false);
    });
  });

  describe("around the clock changes", () => {
    it("ends a BST day at 23:00 UTC", () => {
      // Saturday 24 October, BST: London midnight is 23:00 UTC the day before.
      const sat = event({ starts_at: "2026-10-23T23:00:00Z", is_all_day: true });
      expect(eventEndsAt(sat)?.toISOString()).toBe("2026-10-24T23:00:00.000Z");
      expect(isEventCurrent(sat, at("2026-10-24T22:59:00Z"))).toBe(true);
      expect(isEventCurrent(sat, at("2026-10-24T23:00:00Z"))).toBe(false);
    });

    it("gives the day the clocks go back its 25 hours", () => {
      // Sunday 25 October starts at 23:00 UTC on the 24th (BST) and ends at midnight UTC (GMT).
      const sun = event({ starts_at: "2026-10-24T23:00:00Z", is_all_day: true });
      expect(eventEndsAt(sun)?.toISOString()).toBe("2026-10-26T00:00:00.000Z");
      expect(isEventCurrent(sun, at("2026-10-25T23:30:00Z"))).toBe(true);
    });

    it("gives the day the clocks go forward its 23 hours", () => {
      // Sunday 29 March starts at midnight GMT and ends at 23:00 UTC (midnight BST).
      const sun = event({ starts_at: "2026-03-29T00:00:00Z", is_all_day: true });
      expect(eventEndsAt(sun)?.toISOString()).toBe("2026-03-29T23:00:00.000Z");
      const sat = event({ starts_at: "2026-03-28T10:00:00Z" });
      expect(eventEndsAt(sat)?.toISOString()).toBe("2026-03-29T00:00:00.000Z");
    });

    it("keeps a late-evening BST walk on its own London day", () => {
      // 23:30 UTC on Fri 23 Oct is 00:30 BST on Sat 24: it runs to the end of the Saturday.
      const walk = event({ starts_at: "2026-10-23T23:30:00Z" });
      expect(eventEndsAt(walk)?.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    });
  });

  it("has nothing to say about an event with no date", () => {
    expect(isEventCurrent(event({}), at("2026-10-31T10:00:00Z"))).toBe(false);
  });
});

describe("startOfLondonDay", () => {
  it("is London midnight in UTC, either side of the clock change", () => {
    expect(startOfLondonDay(new Date("2026-10-31T10:00:00Z")).toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(startOfLondonDay(new Date("2026-10-24T23:30:00Z")).toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(startOfLondonDay(new Date("2026-10-25T12:00:00Z")).toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(startOfLondonDay(new Date("2026-03-29T12:00:00Z")).toISOString()).toBe("2026-03-29T00:00:00.000Z");
  });
});

describe("isOnToday", () => {
  const now = new Date("2026-10-31T10:00:00Z");

  it("is today's walk, all-day or timed, finished or not", () => {
    expect(isOnToday(event({ starts_at: "2026-10-31T00:00:00Z", is_all_day: true }), now)).toBe(true);
    expect(isOnToday(event({ starts_at: "2026-10-31T07:00:00Z", ends_at: "2026-10-31T09:00:00Z" }), now)).toBe(true);
    expect(isOnToday(event({ starts_at: "2026-10-31T18:00:00Z" }), now)).toBe(true);
  });

  it("takes in a trip still running from an earlier day", () => {
    expect(isOnToday(event({ starts_at: "2026-10-30T08:00:00Z", ends_at: "2026-11-01T18:00:00Z" }), now)).toBe(true);
  });

  it("leaves out yesterday's and tomorrow's", () => {
    expect(isOnToday(event({ starts_at: "2026-10-30T09:00:00Z" }), now)).toBe(false);
    expect(isOnToday(event({ starts_at: "2026-11-01T00:00:00Z", is_all_day: true }), now)).toBe(false);
    expect(isOnToday(event({}), now)).toBe(false);
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
