import { describe, expect, it } from "vitest";
import { albumVisible, attendedEventIds, canManageAlbums, normalizeAlbumUrl, visibleAlbums } from "./photoAlbums";

describe("normalizeAlbumUrl", () => {
  it("takes Google Photos shared-album links", () => {
    expect(normalizeAlbumUrl("https://photos.app.goo.gl/fMYpnBuYXBEbJ1zK8")).toEqual({ url: "https://photos.app.goo.gl/fMYpnBuYXBEbJ1zK8" });
    expect(normalizeAlbumUrl("  photos.app.goo.gl/abc  ")).toEqual({ url: "https://photos.app.goo.gl/abc" });
    expect(normalizeAlbumUrl("http://photos.google.com/share/AF1Qip")).toEqual({ url: "https://photos.google.com/share/AF1Qip" });
  });

  it("reads blank as removing the album", () => {
    expect(normalizeAlbumUrl("")).toEqual({ url: null });
    expect(normalizeAlbumUrl(null)).toEqual({ url: null });
  });

  it("refuses anything else", () => {
    for (const input of ["https://example.com/album", "javascript:alert(1)", "https://photos.app.goo.gl/", "not a url at all", 42]) {
      expect(normalizeAlbumUrl(input), String(input)).toHaveProperty("error");
    }
    expect(normalizeAlbumUrl(`https://photos.app.goo.gl/${"a".repeat(600)}`)).toHaveProperty("error");
  });
});

describe("who sees which album", () => {
  const albums = [{ event_suu_id: "dales" }, { event_suu_id: "iow" }, { event_suu_id: "snowdonia" }];

  it("shows the committee every album", () => {
    expect(visibleAlbums(albums, { seesAll: true, attended: new Set() })).toHaveLength(3);
  });

  it("shows a member or alumnus only the trips they went on", () => {
    const viewer = { seesAll: false, attended: new Set(["iow"]) };
    expect(visibleAlbums(albums, viewer)).toEqual([{ event_suu_id: "iow" }]);
    expect(albumVisible("dales", viewer)).toBe(false);
  });

  it("shows nothing to someone who went on nothing", () => {
    expect(visibleAlbums(albums, { seesAll: false, attended: new Set() })).toEqual([]);
  });

  it("lets only the committee and up attach albums", () => {
    const p = (governanceRole: "committee" | "principal" | "admin" | null, isWalkLeader = false) => ({
      membershipTier: "explorer" as const,
      governanceRole,
      isWalkLeader,
    });
    expect(canManageAlbums(p("committee"))).toBe(true);
    expect(canManageAlbums(p("principal"))).toBe(true);
    expect(canManageAlbums(p(null, true))).toBe(false);
    expect(canManageAlbums(p(null))).toBe(false);
  });
});

describe("attendedEventIds", () => {
  const ada = { id: "m-ada", email: "Ada@ucl.ac.uk" };
  const row = (event_suu_id: string, member_id: string | null, email: string | null, removed = false) => ({
    event_suu_id,
    member_id,
    email,
    removed,
  });

  it("counts tickets tied to the account, and untied ones by email", () => {
    const ids = attendedEventIds(ada, [row("dales", "m-ada", "ada@ucl.ac.uk"), row("iow", null, "ada@ucl.ac.uk")]);
    expect([...ids].sort()).toEqual(["dales", "iow"]);
  });

  it("skips refunds and other people's tickets", () => {
    const ids = attendedEventIds(ada, [
      row("dales", "m-ada", "ada@ucl.ac.uk", true),
      row("iow", "m-alan", "alan@ucl.ac.uk"),
      // Tied to someone else's account: the email alone doesn't make it Ada's.
      row("lakes", "m-alan", "ada@ucl.ac.uk"),
    ]);
    expect([...ids]).toEqual([]);
  });

  it("counts the walks they led or backmarked", () => {
    const ids = attendedEventIds(ada, [], [
      { event_suu_id: "snowdonia", leader_member_id: "m-ada", backmarker_member_id: null },
      { event_suu_id: "cornwall", leader_member_id: "m-alan", backmarker_member_id: "m-ada" },
      { event_suu_id: "romania", leader_member_id: "m-alan", backmarker_member_id: null },
    ]);
    expect([...ids].sort()).toEqual(["cornwall", "snowdonia"]);
  });
});
