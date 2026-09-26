import { describe, expect, it } from "vitest";
import { lockedGovernanceRole, lockedWalkLeader, type LockedRoles } from "./roleLocks";

const row = (over: Partial<LockedRoles> = {}): LockedRoles => ({
  governance_role: null,
  is_walk_leader: false,
  governance_role_locked: false,
  walk_leader_locked: false,
  ...over,
});

describe("role locks", () => {
  it("takes the sync's value when nothing is locked or the member is new", () => {
    expect(lockedGovernanceRole("committee", undefined)).toBe("committee");
    expect(lockedGovernanceRole(null, row({ governance_role: "committee" }))).toBeNull();
    expect(lockedWalkLeader(true, row())).toBe(true);
  });

  it("keeps a committee seat a principal granted when the sync says none", () => {
    const granted = row({ governance_role: "committee", governance_role_locked: true });
    expect(lockedGovernanceRole(null, granted)).toBe("committee");
  });

  it("keeps a removal a principal made when the sync still says committee", () => {
    const removed = row({ governance_role: null, governance_role_locked: true });
    expect(lockedGovernanceRole("committee", removed)).toBeNull();
  });

  it("lets the Toolbox promote a locked member to principal or admin", () => {
    const locked = row({ governance_role: "committee", governance_role_locked: true });
    expect(lockedGovernanceRole("principal", locked)).toBe("principal");
    expect(lockedGovernanceRole("admin", locked)).toBe("admin");
  });

  it("keeps a hand-set walk leader flag either way", () => {
    expect(lockedWalkLeader(false, row({ is_walk_leader: true, walk_leader_locked: true }))).toBe(true);
    expect(lockedWalkLeader(true, row({ is_walk_leader: false, walk_leader_locked: true }))).toBe(false);
  });
});
