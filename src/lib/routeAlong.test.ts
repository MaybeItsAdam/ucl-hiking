import { describe, expect, it } from "vitest";
import { elevationProfile } from "./eventRoutes";
import { haversineM } from "./gpx";
import { pointAlong, routeLengthKm } from "./routeAlong";

// A degree of latitude is ~111.2 km on the haversine sphere; work in its terms.
const DEG_KM = haversineM([0, 0], [1, 0]) / 1000;

describe("routeLengthKm", () => {
  it("is zero for an empty route and a lone point", () => {
    expect(routeLengthKm([])).toBe(0);
    expect(routeLengthKm([[]])).toBe(0);
    expect(routeLengthKm([[[51.5, -0.1]]])).toBe(0);
  });

  it("sums the legs of a line", () => {
    expect(routeLengthKm([[[0, 0], [0.01, 0], [0.03, 0]]])).toBeCloseTo(0.03 * DEG_KM, 9);
  });

  it("doesn't count the gap between two segments", () => {
    const route: [number, number][][] = [
      [[0, 0], [0.01, 0]],
      [[0.5, 0], [0.52, 0]],
    ];
    expect(routeLengthKm(route)).toBeCloseTo(0.03 * DEG_KM, 9);
  });

  it("agrees with elevationProfile's total on one segment", () => {
    const track: [number, number, number][] = Array.from({ length: 40 }, (_, i) => [51.5 + i * 0.001, -0.1 + Math.sin(i) * 0.002, 100 + i]);
    const profile = elevationProfile([track]);
    const flat = [track.map((p) => [p[0], p[1]] as [number, number])];
    expect(profile.length).toBeGreaterThan(1);
    // The profile rounds its km to 10 m.
    expect(Math.abs(profile[profile.length - 1][0] - routeLengthKm(flat))).toBeLessThan(0.006);
  });
});

describe("pointAlong", () => {
  const line: [number, number][][] = [[[0, 0], [0.01, 0], [0.03, 0]]];

  it("is null for an empty route", () => {
    expect(pointAlong([], 1)).toBeNull();
    expect(pointAlong([[]], 1)).toBeNull();
  });

  it("returns the only point of a single-point route, whatever the km", () => {
    expect(pointAlong([[[51.5, -0.1]]], 0)).toEqual([51.5, -0.1]);
    expect(pointAlong([[[51.5, -0.1]]], 3)).toEqual([51.5, -0.1]);
  });

  it("clamps below zero to the start and past the end to the finish", () => {
    expect(pointAlong(line, -2)).toEqual([0, 0]);
    expect(pointAlong(line, 0)).toEqual([0, 0]);
    expect(pointAlong(line, 1000)).toEqual([0.03, 0]);
    expect(pointAlong(line, routeLengthKm(line))).toEqual([0.03, 0]);
  });

  it("treats a non-finite km as the start", () => {
    expect(pointAlong(line, Number.NaN)).toEqual([0, 0]);
  });

  it("interpolates within an edge", () => {
    const [lat, lng] = pointAlong(line, 0.02 * DEG_KM)!;
    expect(lat).toBeCloseTo(0.02, 9);
    expect(lng).toBe(0);
    const [lat2] = pointAlong(line, 0.005 * DEG_KM)!;
    expect(lat2).toBeCloseTo(0.005, 9);
  });

  it("jumps the gap between segments without spending distance on it", () => {
    const route: [number, number][][] = [
      [[0, 0], [0.01, 0]],
      [[0.5, 0], [0.52, 0]],
    ];
    // 0.015° in: the first segment's 0.01° plus half of the second's.
    const [lat] = pointAlong(route, 0.02 * DEG_KM)!;
    expect(lat).toBeCloseTo(0.51, 9);
    // Exactly at the join it is still on the first segment's end.
    expect(pointAlong(route, 0.01 * DEG_KM)![0]).toBeCloseTo(0.01, 9);
  });

  it("puts a profile km on the matching stretch of the line", () => {
    const track: [number, number, number][] = Array.from({ length: 21 }, (_, i) => [i * 0.001, 0, i * 10]);
    const profile = elevationProfile([track]);
    const flat = [track.map((p) => [p[0], p[1]] as [number, number])];
    const [km, m] = profile[80];
    // Height rises 10 m per 0.001°, so the point's latitude reads back the height.
    expect(pointAlong(flat, km)![0] * 10_000).toBeCloseTo(m, 0);
  });
});
