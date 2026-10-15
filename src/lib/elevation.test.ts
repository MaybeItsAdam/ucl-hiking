import { describe, expect, it } from "vitest";
import { withHeights, type HeightLookup } from "./elevation";
import type { StoredRoute, TrackPoint } from "./gpx";

function route(segments: TrackPoint[][], ascentM: number | null = null): StoredRoute {
  return { name: "Test", segments, waypoints: [], summary: { distanceM: 1000, ascentM, descentM: ascentM } };
}

// A straight line north, 0.001° (~111 m) a step.
const line = (n: number): TrackPoint[] => Array.from({ length: n }, (_, i) => [51 + i * 0.001, 0] as TrackPoint);

describe("withHeights", () => {
  it("leaves a route that already has heights alone", async () => {
    const r = route([[[51, 0, 10], [51.001, 0, 20]]], 10);
    let called = false;
    const out = await withHeights(r, async () => {
      called = true;
      return [];
    });
    expect(out).toBe(r);
    expect(called).toBe(false);
  });

  it("puts a looked-up height on every point and measures the climb", async () => {
    const lookup: HeightLookup = async (pts) => pts.map((p) => Math.round((p[0] - 51) * 10_000)); // 10 m per step
    const out = await withHeights(route([line(11)]), lookup);
    expect(out.segments[0].every((p) => p.length === 3)).toBe(true);
    expect(out.segments[0][10][2]).toBe(100);
    expect(out.summary.ascentM).toBe(100);
    expect(out.summary.descentM).toBe(0);
    expect(out.summary.distanceM).toBe(1000);
  });

  it("samples a long walk sparsely and fills in between", async () => {
    let asked = 0;
    const lookup: HeightLookup = async (pts) => {
      asked = pts.length;
      return pts.map((p) => (p[0] - 51) * 1000);
    };
    // 3000 points 1.1 m apart: ~3.3 km, so about one sample in 45.
    const dense = Array.from({ length: 3000 }, (_, i) => [51 + i * 0.00001, 0] as TrackPoint);
    const out = await withHeights(route([dense]), lookup);
    expect(asked).toBeLessThan(100);
    expect(out.segments[0][1500][2]).toBeCloseTo(15, 0);
  });

  it("keeps segments apart", async () => {
    const out = await withHeights(route([line(3), line(2)]), async (pts) => pts.map(() => 5));
    expect(out.segments.map((s) => s.length)).toEqual([3, 2]);
  });

  it("keeps the route without heights when the lookup fails", async () => {
    const r = route([line(5)]);
    const out = await withHeights(r, async () => {
      throw new Error("down");
    });
    expect(out).toBe(r);
  });
});
