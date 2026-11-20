import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { canGrantAlumni } from "./access";
import {
  ALUMNI_PAGES,
  ALUMNI_ROUTES,
  alumniEmail,
  alumniLink,
  alumnusMayOpen,
  archiveStanding,
  isCurrentMember,
  signsInAsAlumnus,
  studentEmailFor,
} from "./alumni";
import { APP_PAGE_HREFS } from "./app-pages";

const NOW = new Date("2026-11-19T12:00:00Z");
const current = { revoked_at: null, membership_expires_at: "2027-08-31T23:59:59Z" };
const revoked = { revoked_at: "2026-09-01T00:00:00Z", membership_expires_at: null };
const expired = { revoked_at: null, membership_expires_at: "2026-08-31T23:59:59Z" };

describe("alumni standing", () => {
  it("tells current members from lapsed ones", () => {
    expect(isCurrentMember(current, NOW)).toBe(true);
    expect(isCurrentMember({ revoked_at: null, membership_expires_at: null }, NOW)).toBe(true);
    expect(isCurrentMember(revoked, NOW)).toBe(false);
    expect(isCurrentMember(expired, NOW)).toBe(false);
  });

  it("makes a lapsed member with a grant an alumnus, and nobody else", () => {
    expect(archiveStanding(revoked, true, NOW)).toBe("alumnus");
    expect(archiveStanding(expired, true, NOW)).toBe("alumnus");
    expect(archiveStanding(revoked, false, NOW)).toBeNull();
    // The grant couldn't be read (no table yet, or the read failed): no.
    expect(archiveStanding(revoked, null, NOW)).toBeNull();
    expect(archiveStanding(null, true, NOW)).toBeNull();
  });

  it("leaves a current member a member, grant or not", () => {
    expect(archiveStanding(current, true, NOW)).toBe("member");
    expect(archiveStanding(current, false, NOW)).toBe("member");
    expect(signsInAsAlumnus(current, true, NOW)).toBe(false);
  });

  it("lets only granted alumni through sign-in", () => {
    expect(signsInAsAlumnus(revoked, true, NOW)).toBe(true);
    expect(signsInAsAlumnus(revoked, false, NOW)).toBe(false);
    expect(signsInAsAlumnus(null, true, NOW)).toBe(false);
  });
});

describe("what an alumnus may open", () => {
  it("allows the Navigator, its photo archive and their own settings", () => {
    for (const path of [
      "/portal",
      "/portal/navigator",
      "/portal/navigator/",
      "/portal/navigator/3",
      "/portal/navigator/photos",
      "/portal/navigator/photos?x=1",
      "/api/navigator/3",
      "/account",
      "/api/auth/logout",
      "/api/account/delete",
    ]) {
      expect(alumnusMayOpen(path), path).toBe(true);
    }
  });

  it("denies every other page and API", () => {
    for (const path of [
      "/portal/events",
      "/portal/events/abc",
      "/portal/events/rota",
      "/portal/members",
      "/portal/equipment",
      "/portal/club",
      "/portal/club/links",
      "/portal/handbook",
      "/portal/expenses",
      "/portal/inbox",
      "/portal/navigatorx",
      "/account/expenses",
      "/api/events",
      "/api/events/abc/album",
      "/api/admin/alumni",
      "/api/members/search",
      "/api/equipment/items",
      "/api/notifications",
    ]) {
      expect(alumnusMayOpen(path), path).toBe(false);
    }
  });

  it("gives alumni the Navigator and settings tabs only", () => {
    expect([...ALUMNI_PAGES].sort()).toEqual(["navigator", "settings"]);
    for (const page of ALUMNI_PAGES) expect(alumnusMayOpen(APP_PAGE_HREFS[page])).toBe(true);
  });

  it("lists only routes an alumnus may open", () => {
    for (const route of ALUMNI_ROUTES) expect(alumnusMayOpen(route.replace("[issue]", "3")), route).toBe(true);
  });
});

/** Every page and API route file under src/app, as its route ("/portal/navigator/[issue]"). */
function routeFiles(): { route: string; source: string }[] {
  const appDir = join(__dirname, "..", "app");
  const found: { route: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^(page|route)\.tsx?$/.test(entry.name)) {
        const segments = relative(appDir, dir)
          .split(sep)
          .filter((s) => s && !/^\(.*\)$/.test(s));
        found.push({ route: `/${segments.join("/")}`, source: readFileSync(path, "utf8") });
      }
    }
  };
  walk(appDir);
  return found;
}

describe("server-side gating", () => {
  // Every other route finds its viewer through getCurrentMember(), which turns
  // away anyone revoked or expired, alumni included. So the only way in for an
  // alumnus is getArchiveViewer(), and only the archive's routes may call it.
  it("lets only the archive's routes accept alumni", () => {
    const accepting = routeFiles()
      .filter((file) => file.source.includes("getArchiveViewer"))
      .map((file) => file.route)
      .sort();
    expect(accepting).toEqual([...ALUMNI_ROUTES].sort());
  });

  it("keeps the album editor's API on getCurrentMember, so alumni can't reach it", () => {
    const album = routeFiles().find((file) => file.route === "/api/events/[id]/album");
    expect(album?.source).toContain("getCurrentMember");
    expect(album?.source).not.toContain("getArchiveViewer");
  });
});

describe("who grants alumni access", () => {
  it("is principals and admins, never for themselves", () => {
    expect(canGrantAlumni({ id: "p", governanceRole: "principal" }, "m")).toBe(true);
    expect(canGrantAlumni({ id: "a", governanceRole: "admin" }, "m")).toBe(true);
    expect(canGrantAlumni({ id: "p", governanceRole: "principal" }, "p")).toBe(false);
    expect(canGrantAlumni({ id: "c", governanceRole: "committee" }, "m")).toBe(false);
    expect(canGrantAlumni({ id: "x", governanceRole: null }, "m")).toBe(false);
  });
});

describe("alumni addresses", () => {
  it("recognises @alumni.ucl.ac.uk addresses, whatever the case", () => {
    expect(alumniEmail(" Ada.Lovelace.18@Alumni.UCL.ac.uk ")).toBe("ada.lovelace.18@alumni.ucl.ac.uk");
    expect(alumniEmail("ada@ucl.ac.uk")).toBeNull();
    expect(alumniEmail("ada@alumni.ucl.ac.uk.evil.com")).toBeNull();
    expect(alumniEmail("ada@notalumni.ucl.ac.uk")).toBeNull();
    expect(alumniEmail(42)).toBeNull();
  });

  it("guesses the student address from the same name before the @", () => {
    expect(studentEmailFor("zcabxyz@alumni.ucl.ac.uk")).toBe("zcabxyz@ucl.ac.uk");
    expect(studentEmailFor("ada@gmail.com")).toBeNull();
  });

  it("decides what an alumni address that found a members row gets", () => {
    expect(alumniLink(null, null, NOW)).toBe("refused");
    expect(alumniLink(current, null, NOW)).toBe("member");
    expect(alumniLink(revoked, null, NOW)).toBe("auto_grant");
    expect(alumniLink(expired, { revoked_at: null }, NOW)).toBe("alumnus");
    // A principal took it away: sign-in mustn't hand it straight back.
    expect(alumniLink(revoked, { revoked_at: "2026-10-01T00:00:00Z" }, NOW)).toBe("refused");
  });
});
