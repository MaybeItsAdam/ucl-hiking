import { describe, expect, it } from "vitest";
import type { MapHike } from "./hikeMap";
import type { LatLng } from "./places";
import { metresApart, pinGroups } from "./pinGroups";

function hike(n: number, start: LatLng | null, overrides: Partial<MapHike> = {}): MapHike {
  return {
    id: `e${n}`, n, name: `Walk ${n}`, kind: "hike", date: "2026-01-01T00:00:00Z", dateLabel: "Thu 1 Jan",
    difficulty: "moderate", distanceKm: null, ascentM: null, startName: null, finishName: null,
    start, finish: null, upcoming: false, ...overrides,
  };
}

const SEAFORD: LatLng = [50.7727, 0.1007];
const RYE: LatLng = [50.952, 0.731];

describe("metresApart", () => {
  it("measures short hops on the ground", () => {
    expect(metresApart(SEAFORD, SEAFORD)).toBe(0);
    // 0.001° of latitude is about 111 m anywhere.
    expect(metresApart([51, 0], [51.001, 0])).toBeCloseTo(111, 0);
    // A degree of longitude shrinks with latitude: about 70 km at London's.
    expect(metresApart([51.5, 0], [51.5, 1]) / 1000).toBeCloseTo(69.3, 0);
  });
});

describe("pinGroups", () => {
  it("gives a start walked twice one pin carrying both numbers", () => {
    const groups = pinGroups([hike(5, SEAFORD), hike(7, RYE), hike(9, SEAFORD)]);
    expect(groups.map((g) => [g.label, g.hikes.map((h) => h.id)])).toEqual([
      ["5·9", ["e5", "e9"]],
      ["7", ["e7"]],
    ]);
    expect(groups[0].at).toEqual(SEAFORD);
  });

  it("joins starts a few metres apart, but not the next village", () => {
    const nearby: LatLng = [SEAFORD[0] + 0.0005, SEAFORD[1] + 0.0005]; // ~65 m
    const village: LatLng = [SEAFORD[0] + 0.01, SEAFORD[1]]; // ~1.1 km
    expect(pinGroups([hike(1, SEAFORD), hike(2, nearby), hike(3, village)]).map((g) => g.label)).toEqual(["1·2", "3"]);
  });

  it("numbers a shared pin in walk order whatever order the walks come in", () => {
    expect(pinGroups([hike(12, SEAFORD), hike(3, SEAFORD)]).map((g) => g.label)).toEqual(["3·12"]);
  });

  it("pins a walk with only a finish there, and leaves out walks with neither", () => {
    const groups = pinGroups([hike(1, null, { finish: RYE }), hike(2, null), hike(3, RYE)]);
    expect(groups.map((g) => g.label)).toEqual(["1·3"]);
  });

  it("colours a shared pin by grade only when the walks agree, and as coming up only when all are", () => {
    const [mixed] = pinGroups([hike(1, SEAFORD), hike(2, SEAFORD, { difficulty: "challenging", upcoming: true })]);
    expect(mixed).toMatchObject({ difficulty: null, upcoming: false });
    const [same] = pinGroups([hike(1, SEAFORD, { upcoming: true }), hike(2, SEAFORD, { upcoming: true })]);
    expect(same).toMatchObject({ difficulty: "moderate", upcoming: true });
  });
});
