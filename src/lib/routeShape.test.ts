import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareRoute, type TrackPoint } from "./gpx";
import { isPlotted, routeShape } from "./routeShape";

// Real replies from OS Maps' route API, `?exportTypes=TRK&osExtensions=false`, as osmapsGpx asks.
// Box Hill was drawn following the paths; Fan Frynych was plotted click to click
// (its JSON says `paths: [{ type: "PLOTTED" }]`), and its RTE export has the same 20 points.
const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const BOX_HILL = fixture("osmaps-1189929-box-hill.trk.gpx");
const FAN_FRYNYCH = fixture("osmaps-4075000-plotted.trk.gpx");

/** A line due north from Tring, `n` evenly spaced points over `km`. */
function straightNorth(km: number, n: number): TrackPoint[] {
  return Array.from({ length: n }, (_, i) => [51.8 + ((km / 111.2) * i) / (n - 1), -0.65] as TrackPoint);
}

/** A zigzag with legs of about `legM`, like a path's bends. */
function zigzag(km: number, legM: number): TrackPoint[] {
  const n = Math.round((km * 1000) / legM) + 1;
  return Array.from({ length: n }, (_, i) => [51.8 + (legM / 111_200) * i * 0.9, -0.65 + (i % 2 ? 0.0003 : 0)] as TrackPoint);
}

describe("routeShape", () => {
  it("passes a route OS Maps drew along the paths", () => {
    const s = routeShape(prepareRoute(BOX_HILL).segments);
    expect(s.plotted).toBe(false);
    expect(s.km).toBeGreaterThan(13);
    expect(s.pointsPerKm).toBeGreaterThan(5);
    expect(s.straightShare).toBeLessThan(0.5);
  });

  it("flags a route that is only its planner's clicks", () => {
    const s = routeShape(prepareRoute(FAN_FRYNYCH).segments);
    expect(s.points).toBe(20);
    expect(s.km).toBeGreaterThan(20);
    expect(s.longestLegM).toBeGreaterThan(2000);
    expect(s.plotted).toBe(true);
  });

  it("flags start and finish joined by one line", () => {
    expect(isPlotted([straightNorth(29, 2)])).toBe(true);
  });

  it("flags a route of evenly spaced clicks", () => {
    // A click every 500 m: two points a km, every leg a straight line.
    const sparse = straightNorth(10, 21);
    expect(routeShape([sparse])).toMatchObject({ pointsPerKm: 2.1, straightShare: 1, plotted: true });
  });

  it("keeps a dense path with a long straight stretch in it", () => {
    // 8 km of bends and a 2 km straight towpath: a quarter of the length straight.
    const bends = zigzag(8, 40);
    const last = bends[bends.length - 1];
    const towpath: TrackPoint[] = [last, [last[0] + 2 / 111.2, last[1]]];
    const s = routeShape([bends, towpath]);
    expect(s.straightShare).toBeGreaterThan(0.15);
    expect(s.plotted).toBe(false);
  });

  it("leaves a short stroll alone", () => {
    expect(isPlotted([straightNorth(0.8, 2)])).toBe(false);
  });

  it("copes with nothing", () => {
    expect(routeShape([])).toMatchObject({ points: 0, km: 0, plotted: false });
    expect(routeShape(null).plotted).toBe(false);
  });
});
