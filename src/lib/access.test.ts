import { describe, expect, it } from "vitest";
import { accessSummary, can, canChangeRole, isGovernanceRole, isMembershipTier } from "./access";

const profile = (
  membershipTier: "taster" | "standard" | "explorer",
  governanceRole: "committee" | "principal" | "admin" | null = null,
  isWalkLeader = false,
) => ({ membershipTier, governanceRole, isWalkLeader });

describe("access model", () => {
  it("keeps walk leadership independent from membership tier", () => {
    const standardLeader = profile("standard", null, true);
    expect(can(standardLeader, "lead_walks")).toBe(true);
    expect(can(standardLeader, "manage_walks")).toBe(false);
    expect(accessSummary(standardLeader)).toBe("Standard · Walk leader");
    expect(can(profile("explorer"), "lead_walks")).toBe(false);
  });

  it("keeps governance separate and validates sync values", () => {
    expect(isMembershipTier("standard")).toBe(true);
    expect(isMembershipTier("walk_leader")).toBe(false);
    expect(isGovernanceRole("committee")).toBe(true);
    expect(isGovernanceRole("standard")).toBe(false);
  });

  it("lets only explorers and committee borrow kit; principals lend it", () => {
    expect(can(profile("taster"), "request_equipment")).toBe(false);
    expect(can(profile("standard"), "request_equipment")).toBe(false);
    expect(can(profile("standard", null, true), "request_equipment")).toBe(false);
    expect(can(profile("explorer"), "request_equipment")).toBe(true);
    expect(can(profile("standard", "committee"), "request_equipment")).toBe(true);
    expect(can(profile("standard", "principal"), "request_equipment")).toBe(false);
  });

  it("restricts SU session management and kit to principal and admin roles only", () => {
    const committee = profile("standard", "committee");
    const principal = profile("standard", "principal");
    const admin = profile("explorer", "admin");

    expect(can(committee, "manage_suu_session")).toBe(false);
    expect(can(principal, "manage_suu_session")).toBe(true);
    expect(can(admin, "manage_suu_session")).toBe(true);

    expect(can(committee, "view_sync_monitor")).toBe(true);
    expect(can(committee, "review_equipment_requests")).toBe(false);
    expect(can(committee, "manage_equipment")).toBe(false);
    expect(can(principal, "review_equipment_requests")).toBe(true);
    expect(can(principal, "manage_equipment")).toBe(true);
  });
});

describe("canChangeRole", () => {
  const member = { id: "m", governanceRole: null };
  const committee = { id: "c", governanceRole: "committee" as const };
  const principal = { id: "p", governanceRole: "principal" as const };
  const admin = { id: "a", governanceRole: "admin" as const };
  const leaderOn = { field: "is_walk_leader" as const, value: true };
  const makeCommittee = { field: "governance_role" as const, value: "committee" as const };
  const removeRole = { field: "governance_role" as const, value: null };

  it("lets any governance role toggle walk leader, but not ordinary members", () => {
    expect(canChangeRole(committee, member, leaderOn)).toBe(true);
    expect(canChangeRole(principal, member, leaderOn)).toBe(true);
    expect(canChangeRole(member, { id: "x", governanceRole: null }, leaderOn)).toBe(false);
  });

  it("lets only a principal (or admin) grant or remove committee", () => {
    expect(canChangeRole(committee, member, makeCommittee)).toBe(false);
    expect(canChangeRole(principal, member, makeCommittee)).toBe(true);
    expect(canChangeRole(admin, member, makeCommittee)).toBe(true);
    expect(canChangeRole(principal, { id: "c2", governanceRole: "committee" }, removeRole)).toBe(true);
    expect(canChangeRole(committee, { id: "c2", governanceRole: "committee" }, removeRole)).toBe(false);
  });

  it("never touches principals or admins, and nobody edits themselves", () => {
    expect(canChangeRole(principal, { id: "p2", governanceRole: "principal" }, removeRole)).toBe(false);
    expect(canChangeRole(admin, { id: "a2", governanceRole: "admin" }, makeCommittee)).toBe(false);
    expect(canChangeRole(principal, principal, leaderOn)).toBe(false);
  });
});
