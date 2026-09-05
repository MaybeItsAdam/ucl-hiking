import { describe, expect, it } from "vitest";
import { accessSummary, can, isGovernanceRole, isMembershipTier } from "./access";

describe("access model", () => {
  it("keeps walk leadership independent from membership tier", () => {
    const standardLeader = {
      membershipTier: "standard" as const,
      governanceRole: null,
      isWalkLeader: true,
    };
    expect(can(standardLeader, "manage_own_walks")).toBe(true);
    expect(can(standardLeader, "view_explorer_walks")).toBe(false);
    expect(accessSummary(standardLeader)).toBe("Standard · Walk leader");
  });

  it("lets an explorer view explorer walks without granting leader tools", () => {
    const explorer = {
      membershipTier: "explorer" as const,
      governanceRole: null,
      isWalkLeader: false,
    };
    expect(can(explorer, "view_explorer_walks")).toBe(true);
    expect(can(explorer, "manage_own_walks")).toBe(false);
  });

  it("keeps governance separate and validates sync values", () => {
    expect(isMembershipTier("standard")).toBe(true);
    expect(isMembershipTier("walk_leader")).toBe(false);
    expect(isGovernanceRole("committee")).toBe(true);
    expect(isGovernanceRole("standard")).toBe(false);
  });

  it("permits standard and explorer members to request equipment loan but denies taster members", () => {
    const taster = { membershipTier: "taster" as const, governanceRole: null, isWalkLeader: false };
    const standard = { membershipTier: "standard" as const, governanceRole: null, isWalkLeader: false };
    const explorer = { membershipTier: "explorer" as const, governanceRole: null, isWalkLeader: false };

    expect(can(taster, "request_equipment")).toBe(false);
    expect(can(standard, "request_equipment")).toBe(true);
    expect(can(explorer, "request_equipment")).toBe(true);
  });

  it("restricts SU session management to principal and admin roles only", () => {
    const committee = { membershipTier: "standard" as const, governanceRole: "committee" as const, isWalkLeader: false };
    const principal = { membershipTier: "standard" as const, governanceRole: "principal" as const, isWalkLeader: false };
    const admin = { membershipTier: "explorer" as const, governanceRole: "admin" as const, isWalkLeader: false };

    expect(can(committee, "manage_suu_session")).toBe(false);
    expect(can(principal, "manage_suu_session")).toBe(true);
    expect(can(admin, "manage_suu_session")).toBe(true);

    expect(can(committee, "view_sync_monitor")).toBe(true);
    expect(can(committee, "review_equipment_requests")).toBe(true);
  });
});
