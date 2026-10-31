import { describe, expect, it } from "vitest";
import { OVERVIEW_MAX_POINTS, overviewLine } from "./eventRoutes";
import type { TrackPoint } from "./gpx";

describe("overviewLine", () => {
  it("thins a long route to a few hundred points, without heights", () => {
    // 20 km of 10 m zigzags with heights: 2,000 points.
    const seg: TrackPoint[] = Array.from({ length: 2000 }, (_, i) => [51.5 + i * 0.00009, -0.1 + (i % 2) * 0.0004, 100 + i]);
    const line = overviewLine([seg]);
    expect(line.flat().length).toBeLessThanOrEqual(OVERVIEW_MAX_POINTS);
    expect(line[0][0]).toEqual([51.5, -0.1]);
    expect(line[0].every((p) => p.length === 2)).toBe(true);
  });

  it("drops what can't be drawn", () => {
    expect(overviewLine([[[51.5, -0.1]]])).toEqual([]);
    expect(overviewLine(null)).toEqual([]);
  });
});
