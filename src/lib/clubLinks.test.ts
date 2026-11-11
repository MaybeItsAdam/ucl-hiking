import { describe, expect, it } from "vitest";
import { linkKey, normalizeDestination, normalizeLinkPath, pointsAtItself, requestedPath } from "./clubLinks";

describe("normalizeLinkPath", () => {
  it("accepts the forms people paste", () => {
    expect(normalizeLinkPath("e/trip-signup")).toEqual({ path: "/e/trip-signup" });
    expect(normalizeLinkPath(" /e/WL/about/ ")).toEqual({ path: "/e/WL/about" });
    expect(normalizeLinkPath("https://uclhiking.org/media/trips/iow")).toEqual({ path: "/media/trips/iow" });
    expect(normalizeLinkPath("/E/Feedback")).toEqual({ path: "/e/Feedback" });
  });

  it("keeps links to the short-link prefixes", () => {
    expect(normalizeLinkPath("/portal")).toHaveProperty("error");
    expect(normalizeLinkPath("/events")).toHaveProperty("error");
    expect(normalizeLinkPath("/e/")).toHaveProperty("error");
    expect(normalizeLinkPath("")).toHaveProperty("error");
  });

  it("refuses characters that don't belong in a path", () => {
    expect(normalizeLinkPath("/e/trip signup")).toHaveProperty("error");
    expect(normalizeLinkPath("/e/a?b")).toHaveProperty("error");
    expect(normalizeLinkPath("/e/%20")).toHaveProperty("error");
  });
});

describe("normalizeDestination", () => {
  it("accepts web addresses and site paths", () => {
    expect(normalizeDestination("https://forms.gle/abc")).toEqual({ destination: "https://forms.gle/abc" });
    expect(normalizeDestination("forms.gle/abc")).toEqual({ destination: "https://forms.gle/abc" });
    expect(normalizeDestination("/portal/events")).toEqual({ destination: "/portal/events" });
  });

  it("refuses anything that isn't a web address", () => {
    expect(normalizeDestination("javascript:alert(1)")).toHaveProperty("error");
    expect(normalizeDestination("mailto:x@y.z")).toHaveProperty("error");
    expect(normalizeDestination("//evil.example")).toHaveProperty("error");
    expect(normalizeDestination("nonsense")).toHaveProperty("error");
    expect(normalizeDestination("")).toHaveProperty("error");
  });
});

describe("matching", () => {
  it("ignores case and decodes the request", () => {
    expect(linkKey(requestedPath("e", ["WL", "About"]))).toBe(linkKey("/e/wl/about"));
    expect(requestedPath("media", ["trips", "iow%2Ddrive"])).toBe("/media/trips/iow-drive");
  });

  it("spots a link that points at itself", () => {
    expect(pointsAtItself("/e/x", "/E/x/")).toBe(true);
    expect(pointsAtItself("/e/x", "/e/x?y=1")).toBe(true);
    expect(pointsAtItself("/e/x", "/e/y")).toBe(false);
    expect(pointsAtItself("/e/x", "https://uclhiking.org/e/x")).toBe(false);
  });
});
