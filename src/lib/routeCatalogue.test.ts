import { describe, expect, it } from "vitest";
import type { AccessProfile } from "@/lib/access";
import { parseGpx, type TrackPoint } from "@/lib/gpx";
import {
  bandOf,
  canSeeLibraryRoute,
  canSeeRoutes,
  catalogueHref,
  filterCatalogue,
  isClubEntry,
  isClubRoute,
  libraryGpx,
  pageOf,
  parseCatalogueQuery,
  routeDisplayName,
  searchKey,
  thumbnailPath,
  THUMB_MAX_POINTS,
  walkedLabel,
  walkStats,
  type CatalogueEntry,
} from "@/lib/routeCatalogue";

const member: AccessProfile = { membershipTier: "standard", governanceRole: null, isWalkLeader: false };
const leader: AccessProfile = { ...member, isWalkLeader: true };
const committee: AccessProfile = { ...member, governanceRole: "committee" };

function entry(id: string, name: string, km: number, extra: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return { id, name, distance_m: km * 1000, ascent_m: null, private: false, club: true, taggedInName: false, walks: 0, lastWalked: null, nextWalk: null, ...extra };
}

describe("access", () => {
  const route = { present: true, name: "Ramsgate to Margate" };

  it("keeps Routes to committee: not members, not walk leaders", () => {
    expect(canSeeRoutes(member)).toBe(false);
    expect(canSeeRoutes(leader)).toBe(false);
    expect(canSeeRoutes(committee)).toBe(true);
    expect(canSeeRoutes({ ...member, governanceRole: "principal" })).toBe(true);
    expect(canSeeLibraryRoute(route, member)).toBe(false);
    expect(canSeeLibraryRoute(route, leader)).toBe(false);
    expect(canSeeLibraryRoute(route, committee)).toBe(true);
  });

  it("hides a route gone from OS Maps from everyone", () => {
    expect(canSeeLibraryRoute({ ...route, present: false }, committee)).toBe(false);
  });
});

describe("club routes", () => {
  it("counts a route marked in the app, or named … [CLUB] in OS Maps", () => {
    expect(isClubEntry({ name: "Ramsgate to Margate", club: true })).toBe(true);
    expect(isClubEntry({ name: "Ramsgate to Margate [CLUB]", club: false })).toBe(true);
    expect(isClubEntry({ name: "Ramsgate to Margate", club: false })).toBe(false);
    expect(isClubEntry({ name: "Ramsgate to Margate", club: null })).toBe(false);
    expect(isClubEntry({ name: "[CLUB] Ramsgate to Margate" })).toBe(false);
  });

  it("forgives the tag's case and stray spaces", () => {
    expect(isClubRoute("Box Hill [club]")).toBe(true);
    expect(isClubRoute("Box Hill[CLUB]  ")).toBe(true);
    expect(isClubRoute("Box Hill CLUB")).toBe(false);
  });

  it("lists club routes unless asked for all, and keeps that in the URL", () => {
    const list = [entry("1", "Box Hill", 14), entry("2", "Chess Valley", 15, { club: false })];
    expect(filterCatalogue(list, { q: "", band: null, sort: "name" }).map((e) => e.id)).toEqual(["1"]);
    expect(filterCatalogue(list, { q: "", band: null, sort: "name", all: true }).map((e) => e.id)).toEqual(["1", "2"]);
    const q = parseCatalogueQuery({ show: "all" });
    expect(q.all).toBe(true);
    expect(catalogueHref(q)).toBe("/portal/events/routes?show=all");
    expect(catalogueHref(q, { all: false })).toBe("/portal/events/routes");
  });

  it("drops the tag from the name it shows", () => {
    expect(routeDisplayName("Ramsgate to Margate [CLUB]")).toBe("Ramsgate to Margate");
    expect(routeDisplayName("Chess Valley")).toBe("Chess Valley");
    expect(libraryGpx({ name: "Box Hill [CLUB]", segments: [] }).filename).not.toMatch(/club/i);
  });
});

describe("search, bands and sort", () => {
  const list = [
    entry("1", "Seven Sisters: Seaford to Eastbourne", 21.9, { ascent_m: 501, lastWalked: "2026-03-01T09:00:00Z" }),
    entry("2", "Box Hill circular", 14.2, { ascent_m: 460, lastWalked: "2026-10-01T09:00:00Z" }),
    entry("3", "Chess Valley", 15.6, { ascent_m: 180 }),
    entry("4", "Côte de Lewes", 11.5),
  ];

  it("matches every word, in any order, ignoring case, accents and punctuation", () => {
    expect(filterCatalogue(list, { q: "seaford SEVEN", band: null, sort: "name" }).map((e) => e.id)).toEqual(["1"]);
    expect(filterCatalogue(list, { q: "cote", band: null, sort: "name" }).map((e) => e.id)).toEqual(["4"]);
    expect(filterCatalogue(list, { q: "sisters:", band: null, sort: "name" }).map((e) => e.id)).toEqual(["1"]);
    expect(filterCatalogue(list, { q: "box seaford", band: null, sort: "name" })).toEqual([]);
    expect(searchKey("Côte-d’Or")).toBe("cote dor");
  });

  it("puts each length in one band, edges going up", () => {
    expect(bandOf(11_999)).toBe("short");
    expect(bandOf(12_000)).toBe("medium");
    expect(bandOf(16_000)).toBe("long");
    expect(bandOf(20_000)).toBe("epic");
    expect(filterCatalogue(list, { q: "", band: "medium", sort: "name" }).map((e) => e.id)).toEqual(["2", "3"]);
  });

  it("sorts by name, length, climb and last walked", () => {
    const ids = (sort: Parameters<typeof filterCatalogue>[1]["sort"]) => filterCatalogue(list, { q: "", band: null, sort }).map((e) => e.id);
    expect(ids("name")).toEqual(["2", "3", "4", "1"]);
    expect(ids("short")).toEqual(["4", "2", "3", "1"]);
    expect(ids("long")).toEqual(["1", "3", "2", "4"]);
    // Unknown climb last.
    expect(ids("climb")).toEqual(["1", "2", "3", "4"]);
    // Walked most recently first, then the never-walked by name.
    expect(ids("walked")).toEqual(["2", "1", "3", "4"]);
  });

  it("doesn't reorder the list it was given", () => {
    const before = list.map((e) => e.id);
    filterCatalogue(list, { q: "", band: null, sort: "long" });
    expect(list.map((e) => e.id)).toEqual(before);
  });
});

describe("the list's URL", () => {
  it("reads what it knows and defaults the rest", () => {
    expect(parseCatalogueQuery({ q: "  box ", band: "long", sort: "climb", page: "3" })).toEqual({ q: "box", band: "long", sort: "climb", page: 3, all: false });
    expect(parseCatalogueQuery({ band: "huge", sort: "x", page: "-2" })).toEqual({ q: "", band: null, sort: "name", page: 1, all: false });
    expect(parseCatalogueQuery({ q: ["a", "b"] }).q).toBe("a");
  });

  it("writes only what differs from the default", () => {
    const q = parseCatalogueQuery({});
    expect(catalogueHref(q)).toBe("/portal/events/routes");
    expect(catalogueHref(q, { q: "box hill", band: "short", page: 2 })).toBe("/portal/events/routes?q=box+hill&band=short&page=2");
    expect(catalogueHref({ ...q, sort: "walked", page: 4 }, { page: 1 })).toBe("/portal/events/routes?sort=walked");
  });
});

describe("pageOf", () => {
  const items = Array.from({ length: 53 }, (_, i) => i);
  it("cuts pages and clamps out-of-range ones", () => {
    expect(pageOf(items, 1, 25)).toMatchObject({ page: 1, pages: 3, total: 53, items: items.slice(0, 25) });
    expect(pageOf(items, 3, 25).items).toEqual([50, 51, 52]);
    expect(pageOf(items, 99, 25).page).toBe(3);
    expect(pageOf([], 2, 25)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
  });
});

describe("walkStats", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  it("counts the visible walks per route, with the last one walked and the next one out", () => {
    const stats = walkStats(
      [
        { event_suu_id: "a", osmaps_route_id: "r1" },
        { event_suu_id: "b", osmaps_route_id: "r1" },
        { event_suu_id: "c", osmaps_route_id: "r1" },
        { event_suu_id: "hidden", osmaps_route_id: "r1" },
        { event_suu_id: "d", osmaps_route_id: null },
      ],
      [
        { suu_event_id: "a", starts_at: "2026-02-01T09:00:00Z" },
        { suu_event_id: "b", starts_at: "2026-09-01T09:00:00Z" },
        { suu_event_id: "c", starts_at: "2026-11-14T09:00:00Z" },
        { suu_event_id: "d", starts_at: "2026-09-01T09:00:00Z" },
      ],
      now,
    );
    expect(stats.get("r1")).toEqual({ walks: 3, lastWalked: "2026-09-01T09:00:00Z", nextWalk: "2026-11-14T09:00:00Z" });
    expect(stats.size).toBe(1);
  });

  it("labels a route by its walks", () => {
    expect(walkedLabel({ walks: 0, lastWalked: null, nextWalk: null })).toBeNull();
    expect(walkedLabel({ walks: 1, lastWalked: "2026-09-01T09:00:00Z", nextWalk: null })).toBe("1 walk · last 1 Sept 2026");
    expect(walkedLabel({ walks: 2, lastWalked: null, nextWalk: "2026-11-14T09:00:00Z" })).toBe("2 walks · next 14 Nov 2026");
  });
});

describe("thumbnailPath", () => {
  it("fits the line in the box, north up, centred", () => {
    // 1 km north-south: tall and thin.
    const path = thumbnailPath([[[51.0, -0.3], [51.009, -0.3]]], 72, 54, 4)!;
    const nums = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const [x0, y0, x1, y1] = nums;
    expect(x0).toBe(36);
    expect(x1).toBe(36);
    // The start is south, so lower on the page.
    expect(y0).toBeCloseTo(50);
    expect(y1).toBeCloseTo(4);
  });

  it("thins a dense track to a short path", () => {
    const dense: TrackPoint[] = Array.from({ length: 5000 }, (_, i) => [51 + Math.sin(i / 300) * 0.05, -0.3 + i * 0.00002]);
    const path = thumbnailPath([dense], 72, 54)!;
    expect((path.match(/[ML]/g) ?? []).length).toBeLessThanOrEqual(THUMB_MAX_POINTS);
    expect(path.length).toBeLessThan(1500);
  });

  it("draws nothing for an empty or single-point route", () => {
    expect(thumbnailPath([], 72, 54)).toBeNull();
    expect(thumbnailPath([[[51, 0]]], 72, 54)).toBeNull();
    expect(thumbnailPath([[[51, 0], [51, 0]]], 72, 54)).toBeNull();
  });
});

describe("libraryGpx", () => {
  it("writes a GPX that reads back as the same route, named for the file", () => {
    const segments: TrackPoint[][] = [
      [
        [51.25, -0.33, 60],
        [51.26, -0.32, 120],
      ],
      [
        [51.27, -0.31, 150],
        [51.28, -0.3, 90],
      ],
    ];
    const { body, filename } = libraryGpx({ name: "Box Hill & Juniper Top", segments, waypoints: [{ lat: 51.25, lng: -0.33, name: "Stepping stones" }] });
    expect(filename).toBe("box-hill-juniper-top.gpx");
    const parsed = parseGpx(body);
    expect(parsed.name).toBe("Box Hill & Juniper Top");
    expect(parsed.segments).toEqual(segments);
    expect(parsed.waypoints[0]).toMatchObject({ name: "Stepping stones" });
  });

  it("names an unnamed route", () => {
    expect(libraryGpx({ name: "  ", segments: [] }).filename).toBe("os-maps-route.gpx");
  });
});
