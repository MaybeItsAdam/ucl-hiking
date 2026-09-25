import { describe, expect, it } from "vitest";
import { clubYear, clubYearLabel, mapHikes, onMap, yearStats } from "./hikeMap";
import type { LatLng } from "./places";
import type { SUEvent } from "./types";

function event(overrides: Partial<SUEvent>): SUEvent {
  return {
    id: "e", suu_event_id: "e", title: "Walk", starts_at: null, ends_at: null, location: null,
    status: "upcoming", capacity: 0, tickets_sold: 0, price_pence: 0, source_reference: null,
    synced_at: "2026-09-01T00:00:00Z", ...overrides,
  };
}

const places = new Map<string, LatLng>([
  ["Hastings", [50.857, 0.577]],
  ["Rye", [50.952, 0.731]],
]);

describe("mapHikes", () => {
  const events = [
    event({ id: "sub", title: "Hike: Hastings to Rye", starts_at: "2026-03-21T00:00:00Z" }),
    event({ id: "full", title: "🥾 Hike: Hastings to Rye (20km)", description: "⚖️ DIFFICULTY:\nChallenging 🔴", starts_at: "2026-03-21T00:00:00Z" }),
    event({ id: "bare", title: "Hastings and Rye hike", starts_at: "2026-03-21T00:00:00Z" }),
    event({ id: "social", title: "🎉 Social: Pub Night", starts_at: "2026-03-22T18:00:00Z" }),
    event({ id: "later", title: "👣 Walk: Hampstead Heath (10km)", starts_at: "2026-11-01T00:00:00Z" }),
    event({ id: "off", title: "🥾 Hike: Hastings to Rye (20km)", status: "cancelled", starts_at: "2026-04-01T00:00:00Z" }),
  ];
  const hikes = mapHikes(events, places, new Date("2026-06-01T00:00:00Z"));

  it("keeps the fullest of several copies of one walk and skips socials and cancellations", () => {
    expect(hikes.map((h) => [h.id, h.n])).toEqual([["full", 1], ["later", 2]]);
    expect(hikes[0]).toMatchObject({ start: [50.857, 0.577], finish: [50.952, 0.731], difficulty: "challenging", upcoming: false });
  });

  it("keeps walks it has no pins for, off the map", () => {
    expect(hikes[1]).toMatchObject({ start: null, upcoming: true });
    expect(hikes.filter(onMap).map((h) => h.id)).toEqual(["full"]);
  });

  it("totals only walks already done", () => {
    expect(yearStats(hikes)).toMatchObject({ done: 1, upcoming: 1, km: 20, places: 2 });
  });
});

describe("clubYear", () => {
  it("turns over on 1 September, London time", () => {
    expect(clubYear(new Date("2026-08-31T22:59:00Z"))).toBe(2025);
    expect(clubYear(new Date("2026-08-31T23:00:00Z"))).toBe(2026);
    expect(clubYear(new Date("2027-01-10T12:00:00Z"))).toBe(2026);
  });

  it("names the year by both halves", () => {
    expect(clubYearLabel(2025)).toBe("2025–26");
    expect(clubYearLabel(2099)).toBe("2099–00");
  });
});
