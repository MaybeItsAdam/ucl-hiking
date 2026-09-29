import { describe, expect, it } from "vitest";
import { detailsFrom, osmapsRouteId, stampOf } from "@/lib/osmaps";

describe("osmapsRouteId", () => {
  it("reads the id from share links", () => {
    expect(osmapsRouteId("https://explore.osmaps.com/route/10378676/wye-to-canterbury")).toBe("10378676");
    expect(osmapsRouteId("https://explore.osmaps.com/route/10378676")).toBe("10378676");
    expect(osmapsRouteId(" https://osmaps.com/route/1189929/box-hill?lat=1 ")).toBe("1189929");
  });

  it("ignores links elsewhere or without a route", () => {
    expect(osmapsRouteId("https://www.komoot.com/tour/10378676")).toBeNull();
    expect(osmapsRouteId("https://explore.osmaps.com/")).toBeNull();
    expect(osmapsRouteId("https://evil.example/explore.osmaps.com/route/123456")).toBeNull();
    expect(osmapsRouteId("not a url")).toBeNull();
    expect(osmapsRouteId(null)).toBeNull();
  });
});

describe("detailsFrom", () => {
  it("takes OS Maps' name, figures and change markers", () => {
    const d = detailsFrom("42", {
      version: 204,
      metadata: { name: " Box Hill, Surrey ", modifiedAt: "2025-01-02T03:04:05Z", visibility: "UNLISTED" },
      characteristics: { distance: 11234.6, elevationAscent: 301.2, elevationDescent: 299.9 },
    });
    expect(d).toEqual({
      id: "42",
      name: "Box Hill, Surrey",
      modifiedAt: "2025-01-02T03:04:05Z",
      version: "204",
      distanceM: 11235,
      ascentM: 301,
      descentM: 300,
      visibility: "UNLISTED",
    });
    expect(stampOf(d)).toBe("2025-01-02T03:04:05Z#204");
  });

  it("copes with a body missing everything", () => {
    const d = detailsFrom("7", null);
    expect(d.name).toBe("OS Maps route 7");
    expect(d.distanceM).toBeNull();
    expect(stampOf(d)).toBeNull();
  });
});
