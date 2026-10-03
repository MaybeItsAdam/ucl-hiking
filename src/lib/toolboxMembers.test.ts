import { describe, expect, it } from "vitest";
import { compareToolboxMembers, expiryFromDateRange, mapToolboxMember, rosterFromToolbox, tierFromToolboxMembership } from "./toolboxMembers";

describe("Toolbox member mapping", () => {
  it("maps supported products and the end of the SU date range", () => {
    expect(tierFromToolboxMembership("Explorer Membership")).toBe("explorer");
    expect(expiryFromDateRange("01/09/2026 - 31/08/2027")).toBe("2027-08-31T23:59:59.999Z");
  });
  it("refuses unlinked members and unknown products", () => {
    const base = { id: "m", toolboxUserId: null, email: null, fullName: "Ada Lovelace", memberType: "Student", membershipType: "Explorer", dateRange: null, identityStatus: "unlinked" as const };
    expect(mapToolboxMember(base)).toBeNull();
    expect(tierFromToolboxMembership("Life member")).toBeNull();
  });

  it("compares by stable id first and email as a migration fallback", () => {
    const comparison = compareToolboxMembers(
      [
        { toolbox_user_id: "toolbox-1", email: "one@example.com", full_name: "One", membership_tier: "standard", membership_expires_at: null },
        { toolbox_user_id: "toolbox-2", email: "two@example.com", full_name: "Two", membership_tier: "explorer", membership_expires_at: null },
        { toolbox_user_id: "toolbox-3", email: "three@example.com", full_name: "Three", membership_tier: "taster", membership_expires_at: null },
      ],
      [
        { toolbox_user_id: "toolbox-1", email: "old@example.com", membership_tier: "standard" },
        { toolbox_user_id: null, email: "two@example.com", membership_tier: "standard" },
        { toolbox_user_id: "toolbox-4", email: "four@example.com", membership_tier: "explorer" },
      ],
    );
    expect(comparison).toEqual({ toolboxEligible: 3, hikingActive: 3, onlyToolbox: 1, onlyHiking: 1, tierMismatches: 1 });
  });

  it("lists unlinked members for name matching, with a Toolbox id only once confirmed", () => {
    const base = { toolboxUserId: "t1", email: null, memberType: "Student", dateRange: "01/09/2026 - 31/08/2027" };
    expect(
      rosterFromToolbox([
        { ...base, id: "m1", fullName: "Ada Lovelace", membershipType: "Taster", identityStatus: "unlinked" },
        { ...base, id: "m2", fullName: "Alan Turing", membershipType: "Explorer", identityStatus: "confirmed" },
        { ...base, id: "m3", fullName: "Grace Hopper", membershipType: "Life member", identityStatus: "confirmed" },
      ]),
    ).toEqual([
      { id: "m1", full_name: "Ada Lovelace", member_type: "Student", membership_tier: "taster", membership_expires_at: "2027-08-31T23:59:59.999Z", toolbox_user_id: null },
      { id: "m2", full_name: "Alan Turing", member_type: "Student", membership_tier: "explorer", membership_expires_at: "2027-08-31T23:59:59.999Z", toolbox_user_id: "t1" },
    ]);
  });
});
