import { describe, expect, it } from "vitest";
import type { AccessProfile } from "@/lib/access";
import { availablePages } from "@/lib/app-pages";
import { isHandbookVisibility, readableVisibilities } from "@/lib/handbook";

const member: AccessProfile = { membershipTier: "standard", governanceRole: null, isWalkLeader: false };
const leader: AccessProfile = { ...member, isWalkLeader: true };
const committee: AccessProfile = { ...member, governanceRole: "committee" };

describe("handbook visibility", () => {
  it("lets members read pages shared with all members", () => {
    expect(readableVisibilities(member)).toEqual(["members"]);
  });

  it("lets walk leaders read their pages as well", () => {
    expect(readableVisibilities(leader)).toEqual(["walk_leaders", "members"]);
  });

  it("lets the committee read everything", () => {
    expect(readableVisibilities(committee)).toBeNull();
  });

  it("only accepts the three visibilities", () => {
    expect(isHandbookVisibility("members")).toBe(true);
    expect(isHandbookVisibility("everyone")).toBe(false);
    expect(isHandbookVisibility(undefined)).toBe(false);
  });
});

describe("Handbook tab", () => {
  it("appears for members only once something is shared with them", () => {
    expect(availablePages(member)).not.toContain("handbook");
    expect(availablePages(member, true)).toContain("handbook");
  });

  it("never appears for the committee, who read it from Club", () => {
    expect(availablePages(committee, true)).toContain("club");
    expect(availablePages(committee, true)).not.toContain("handbook");
  });
});

describe("Navigator tab", () => {
  it("is every member's, straight after Events", () => {
    for (const profile of [member, leader, committee]) expect(availablePages(profile).slice(0, 2)).toEqual(["events", "navigator"]);
  });

  it("puts a plain member's shared pages together, settings last", () => {
    expect(availablePages(member, true)).toEqual(["events", "navigator", "handbook", "settings"]);
  });

  it("isn't there signed out", () => {
    expect(availablePages(null)).toEqual(["settings"]);
  });
});
