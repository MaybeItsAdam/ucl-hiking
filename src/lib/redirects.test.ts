import { describe, expect, it } from "vitest";
import { legacyRedirects } from "./redirects";
import { checkCustomRoutes } from "next/dist/lib/load-custom-routes";
import { buildCustomRoute } from "next/dist/server/lib/router-utils/filesystem";

describe("legacyRedirects", () => {
  it("passes Next.js internal custom route validation", () => {
    expect(() => {
      checkCustomRoutes(legacyRedirects, "redirect");
    }).not.toThrow();
  });

  it("contains valid sources and destinations", () => {
    expect(legacyRedirects.length).toBeGreaterThan(5);

    for (const r of legacyRedirects) {
      expect(r.source.startsWith("/")).toBe(true);
      expect(r.destination.length).toBeGreaterThan(0);
      expect(r.permanent).toBe(true);
    }
  });

  it("leaves the short-link prefixes to the committee's club_links", () => {
    // A static redirect here would shadow a link the committee edits in the app.
    for (const r of legacyRedirects) expect(r.source).not.toMatch(/^\/(e|media)\//i);
  });

  it("matches key club redirects correctly", () => {
    const builtRoutes = legacyRedirects.map((r) =>
      buildCustomRoute("redirect", r)
    );

    function matchPath(pathname: string) {
      for (const r of builtRoutes) {
        const params = r.match(pathname);
        if (params) {
          return { source: r.source, destination: r.destination };
        }
      }
      return null;
    }

    // Single redirects
    expect(matchPath("/merch")?.destination).toBe(
      "https://studentsunionucl.org/clubs-societies/hiking-club/products"
    );
    expect(matchPath("/feedback")?.destination).toBe("/e/feedback");
    expect(matchPath("/wl")?.destination).toBe(
      "https://linktr.ee/ucl_walk_leaders"
    );

    // Group redirects: category
    expect(matchPath("/category")?.source).toBe("/category/:path*");
    expect(matchPath("/category/trips")?.source).toBe("/category/:path*");

    // Group redirects: single-post
    expect(matchPath("/single-post")?.source).toBe("/single-post/:path*");
    expect(matchPath("/single-post/sample-article")?.source).toBe(
      "/single-post/:path*"
    );

    // Boots article matches specific redirect before group redirect
    expect(
      matchPath("/single-post/2018/01/31/We-need-to-talk-about-boots…")
        ?.destination
    ).toBe("/post/2018/01/31/we-need-to-talk-about-boots-e2-80-a6");
    expect(
      matchPath("/single-post/2018/01/31/We-need-to-talk-about-boots%E2%80%A6")
        ?.destination
    ).toBe("/post/2018/01/31/we-need-to-talk-about-boots-e2-80-a6");
    expect(
      matchPath("/single-post/2018/01/31/We-need-to-talk-about-boots%e2%80%a6")
        ?.destination
    ).toBe("/post/2018/01/31/we-need-to-talk-about-boots-e2-80-a6");
  });
});
