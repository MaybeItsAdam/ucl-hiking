import { describe, expect, it } from "vitest";
import { describeEventChange } from "./eventChanges";
import { newlyAssigned } from "./eventPlans";
import { isTomorrow, reminderMessage } from "./reminders";
import type { SUEvent } from "./types";

const before = {
  title: "Box Hill Circular",
  starts_at: "2026-10-18T08:00:00Z",
  ends_at: "2026-10-18T17:00:00Z",
  location: "Dorking",
  status: "upcoming" as const,
  is_all_day: false,
};

describe("describeEventChange", () => {
  it("announces a cancellation, and a walk coming back", () => {
    expect(describeEventChange(before, { status: "cancelled" })?.title).toBe("Cancelled: Box Hill Circular");
    expect(describeEventChange({ ...before, status: "cancelled" }, { status: "upcoming" })?.title).toBe("Back on: Box Hill Circular");
  });

  it("announces a real move or a new place, but not a 5-minute tweak or a wording change", () => {
    expect(describeEventChange(before, { starts_at: "2026-10-18T09:00:00Z" })?.title).toBe("New time: Box Hill Circular");
    expect(describeEventChange(before, { location: "Leatherhead" })?.body).toBe("Now at Leatherhead.");
    expect(describeEventChange(before, { starts_at: "2026-10-18T08:05:00Z" })).toBeNull();
    expect(describeEventChange(before, { title: "Box Hill Circular (updated)" })).toBeNull();
  });
});

describe("newlyAssigned", () => {
  it("tells new leaders and backmarkers, but not whoever assigned themselves", () => {
    expect(newlyAssigned(null, { leader_member_id: "L", backmarker_member_id: "B" }, "C")).toEqual([
      { memberId: "L", role: "leader" },
      { memberId: "B", role: "backmarker" },
    ]);
    expect(newlyAssigned({ leader_member_id: "L", backmarker_member_id: null }, { leader_member_id: "L", backmarker_member_id: "C" }, "C")).toEqual([]);
  });
});

describe("reminders", () => {
  const event = { id: "e", suu_event_id: "s", title: "Seven Sisters", starts_at: "2026-10-18T07:30:00Z", ends_at: null, location: null, status: "upcoming", capacity: 0, tickets_sold: 0, price_pence: 0, source_reference: null, synced_at: "" } as SUEvent;

  it("knows which walks are tomorrow in London", () => {
    expect(isTomorrow(event, new Date("2026-10-17T17:00:00Z"))).toBe(true);
    expect(isTomorrow(event, new Date("2026-10-18T06:00:00Z"))).toBe(false);
  });

  it("puts meet, kit and weather in one line", () => {
    const plan = { meet_at: "2026-10-18T07:40:00Z", meet_point: "Victoria", kit_list: ["Waterproof", "Lunch", "Water", "Map"] } as Parameters<typeof reminderMessage>[1];
    const forecast = { date: "2026-10-18", summary: "Showers", tempMin: 9, tempMax: 13, rainChance: 60, windMaxKmh: 20, gustMaxKmh: 30, sunrise: null, sunset: null };
    expect(reminderMessage(event, plan, forecast)).toEqual({
      title: "Tomorrow: Seven Sisters",
      body: "Meet 08:40 at Victoria · bring waterproof, lunch, water… · Showers, 9–13°C, 60% rain",
    });
  });
});
