import { describe, expect, it } from "vitest";
import { haversineM, parseGpx, prepareRoute, simplify, summarise, toGpx, type TrackPoint } from "./gpx";

// A short walk out of Tring the way OS Maps exports it: metadata, one waypoint,
// a track in two segments (a gap where the watch lost signal).
const OS_MAPS = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OS Maps" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name><![CDATA[Tring & Ivinghoe Beacon]]></name></metadata>
  <wpt lat="51.8007" lon="-0.6450"><name>Tea &amp; cake</name></wpt>
  <trk>
    <name>Track</name>
    <trkseg>
      <trkpt lat="51.8000" lon="-0.6500"><ele>120</ele></trkpt>
      <trkpt lat='51.8010' lon='-0.6500'><ele>122</ele></trkpt>
      <trkpt lon="-0.6500" lat="51.8020"><ele>140.5</ele></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="51.8030" lon="-0.6500"><ele>150</ele></trkpt>
      <trkpt lat="51.8040" lon="-0.6500"><ele>130</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe("parseGpx", () => {
  it("reads the name, waypoints and each track segment", () => {
    const gpx = parseGpx(OS_MAPS);
    expect(gpx.name).toBe("Tring & Ivinghoe Beacon");
    expect(gpx.waypoints).toEqual([{ lat: 51.8007, lng: -0.645, name: "Tea & cake" }]);
    expect(gpx.segments).toHaveLength(2);
    expect(gpx.segments[0]).toEqual([
      [51.8, -0.65, 120],
      [51.801, -0.65, 122],
      [51.802, -0.65, 140.5],
    ]);
  });

  it("falls back to a planned route's points when there is no track", () => {
    const gpx = parseGpx(`<gpx><rte><name>Plan</name>
      <rtept lat="51.5" lon="-0.1"/><rtept lat="51.6" lon="-0.1"></rtept></rte></gpx>`);
    expect(gpx.name).toBe("Plan");
    expect(gpx.segments).toEqual([
      [
        [51.5, -0.1],
        [51.6, -0.1],
      ],
    ]);
  });

  it("copes with namespace prefixes and skips points with bad coordinates", () => {
    const gpx = parseGpx(`<gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1"><gpx:trk><gpx:trkseg>
      <gpx:trkpt lat="51.5" lon="-0.1"><gpx:ele>10</gpx:ele></gpx:trkpt>
      <gpx:trkpt lat="abc" lon="-0.1"><gpx:ele>99</gpx:ele></gpx:trkpt>
      <gpx:trkpt lat="95" lon="-0.1"/>
      <gpx:trkpt lat="51.6" lon="-0.1"/>
    </gpx:trkseg></gpx:trk></gpx:gpx>`);
    expect(gpx.segments[0]).toEqual([
      [51.5, -0.1, 10],
      [51.6, -0.1],
    ]);
  });

  it("refuses what isn't GPX, or GPX with nothing to draw", () => {
    expect(() => parseGpx("<!doctype html><html><body>OS Maps</body></html>")).toThrow(/isn't a GPX/);
    expect(() => parseGpx('<gpx><wpt lat="1" lon="1"/></gpx>')).toThrow(/no track or route/);
  });

  it("never expands entities from a DOCTYPE", () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]>
      <gpx><metadata><name>&b;</name></metadata><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.1" lon="1"/></trkseg></trk></gpx>`;
    expect(parseGpx(evil).name).toBe("&b;");
  });
});

describe("summarise", () => {
  it("measures distance across segments but not the gap between them", () => {
    const { distanceM } = summarise(parseGpx(OS_MAPS).segments);
    // Three 0.001° steps of latitude, about 111 m each.
    expect(distanceM).toBeGreaterThan(330);
    expect(distanceM).toBeLessThan(336);
  });

  it("counts climbs over the noise band only", () => {
    const { ascentM, descentM } = summarise(parseGpx(OS_MAPS).segments);
    // 120 → 140.5 (the +2 wobble folds in), then 150 → 130 in the second segment.
    expect(ascentM).toBe(21);
    expect(descentM).toBe(20);
  });

  it("says nothing about climb when there are no elevations", () => {
    expect(summarise([[[0, 0], [0, 0.01]]]).ascentM).toBeNull();
  });
});

describe("simplify", () => {
  it("drops points that sit on a straight line and keeps the corners", () => {
    const line: TrackPoint[] = Array.from({ length: 50 }, (_, i) => [51.5 + i * 0.0001, -0.1]);
    line.push([51.505, -0.09]);
    const out = simplify(line, 5);
    expect(out).toEqual([line[0], line[49], line[50]]);
  });

  it("keeps a wiggle bigger than the tolerance", () => {
    const pts: TrackPoint[] = [
      [51.5, -0.1],
      [51.5005, -0.0995],
      [51.501, -0.1],
    ];
    expect(simplify(pts, 5)).toHaveLength(3);
    expect(simplify(pts, 100)).toHaveLength(2);
  });
});

describe("prepareRoute and toGpx", () => {
  it("round-trips through the GPX it writes", () => {
    const route = prepareRoute(OS_MAPS);
    const again = parseGpx(toGpx(route, "Fallback"));
    expect(again.name).toBe("Tring & Ivinghoe Beacon");
    expect(again.segments).toEqual(route.segments);
    expect(again.waypoints).toEqual(route.waypoints);
  });

  it("thins a long, dense track to the cap", () => {
    const seg: TrackPoint[] = Array.from({ length: 20000 }, (_, i) => [51.5 + i * 0.00002, -0.1 + Math.sin(i / 5) * 0.0003, 100]);
    const text = `<gpx><trk><trkseg>${seg.map((p) => `<trkpt lat="${p[0]}" lon="${p[1]}"><ele>${p[2]}</ele></trkpt>`).join("")}</trkseg></trk></gpx>`;
    const route = prepareRoute(text);
    expect(route.segments[0].length).toBeLessThanOrEqual(5000);
    // Measured on the full track, not the thinned one.
    expect(route.summary.distanceM).toBeGreaterThan(haversineM(seg[0], seg[seg.length - 1]));
  });
});
