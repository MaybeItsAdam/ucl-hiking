import { describe, expect, it } from "vitest";
import { matchRoutes, nameTokens, scoreRoute, type CandidateRoute, type MatchableHike } from "@/lib/routeMatch";

const WYE: [number, number] = [51.1853, 0.9295];
const CANTERBURY_WEST: [number, number] = [51.2843, 1.0754];
const HASLEMERE: [number, number] = [51.0886, -0.7194];

const wyeHike: MatchableHike = {
  id: "wye",
  name: "Wye to Canterbury",
  date: "2026-09-06T00:00:00Z",
  distanceKm: 20,
  startName: "Wye",
  finishName: "Canterbury West",
  start: WYE,
  finish: CANTERBURY_WEST,
};

const haslemereHike: MatchableHike = {
  id: "haslemere",
  name: "Haslemere (Temple of the Winds)",
  date: "2026-09-27T00:00:00Z",
  distanceKm: 14,
  startName: "Haslemere",
  finishName: "Haslemere",
  start: HASLEMERE,
  finish: HASLEMERE,
};

const route = (over: Partial<CandidateRoute>): CandidateRoute => ({
  id: "r",
  name: "",
  distanceM: null,
  start: null,
  finish: null,
  date: null,
  ...over,
});

describe("nameTokens", () => {
  it("drops filler words, numbers and punctuation", () => {
    expect([...nameTokens("🥾 Hike: Wye to Canterbury (20km)")]).toEqual(["wye", "canterbury"]);
  });
});

describe("scoreRoute", () => {
  it("rewards a route whose ends sit at the stations, either way round", () => {
    const forward = scoreRoute(route({ start: [51.186, 0.931], finish: [51.28, 1.07] }), wyeHike);
    const backward = scoreRoute(route({ start: [51.28, 1.07], finish: [51.186, 0.931] }), wyeHike);
    expect(forward.score).toBe(6);
    expect(backward.score).toBe(6);
  });

  it("counts a circular's two ends against the one station", () => {
    expect(scoreRoute(route({ start: [51.089, -0.72], finish: [51.088, -0.719] }), haslemereHike).score).toBe(6);
  });
});

describe("matchRoutes", () => {
  const routes = [
    route({ id: "wye-route", name: "Wye - Canterbury NDW", distanceM: 19_600, start: [51.186, 0.931], finish: [51.28, 1.07] }),
    route({ id: "has-route", name: "Temple of the Winds from Haslemere", distanceM: 14_300, start: [51.089, -0.72], finish: [51.089, -0.72] }),
    route({ id: "other", name: "Seven Sisters", distanceM: 21_000, start: [50.77, 0.1], finish: [50.79, 0.28] }),
  ];

  it("pairs each walk with its route", () => {
    const got = matchRoutes(routes, [wyeHike, haslemereHike]);
    expect(got.map((m) => [m.hikeId, m.routeId])).toEqual([
      ["wye", "wye-route"],
      ["haslemere", "has-route"],
    ]);
  });

  it("leaves a walk alone when nothing fits", () => {
    expect(matchRoutes([routes[2]], [wyeHike])).toEqual([]);
  });

  it("refuses to guess between two equally good routes", () => {
    const twin = { ...routes[0], id: "wye-copy" };
    expect(matchRoutes([routes[0], twin], [wyeHike])).toEqual([]);
  });

  it("matches on the name alone only with more to go on", () => {
    // Name only (3) is below the bar; name plus distance plus date is enough.
    expect(matchRoutes([route({ id: "n", name: "Wye to Canterbury" })], [{ ...wyeHike, start: null, finish: null }])).toEqual([]);
    const dated = route({ id: "d", name: "Wye to Canterbury", distanceM: 20_000, date: "2026-09-06" });
    expect(matchRoutes([dated], [{ ...wyeHike, start: null, finish: null }])[0]?.routeId).toBe("d");
  });
});
