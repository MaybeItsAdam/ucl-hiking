import type { GovernanceRole } from "@/lib/access";

export interface LockedRoles {
  governance_role: GovernanceRole | null;
  is_walk_leader: boolean;
  governance_role_locked: boolean;
  walk_leader_locked: boolean;
}

/** The roles only the Toolbox hands out; they override a lock set in the app. */
function isToolboxRole(role: GovernanceRole | null): boolean {
  return role === "principal" || role === "admin";
}

/**
 * The governance role to store when a sync or sign-in proposes `incoming` for a
 * member whose current row is `existing`. A hand-set role survives, unless the
 * Toolbox is promoting them to principal or admin.
 */
export function lockedGovernanceRole(
  incoming: GovernanceRole | null,
  existing: LockedRoles | undefined,
): GovernanceRole | null {
  if (!existing?.governance_role_locked || isToolboxRole(incoming)) return incoming;
  return existing.governance_role;
}

/** Walk leadership a sync proposes, unless a person has set it by hand. */
export function lockedWalkLeader(incoming: boolean, existing: LockedRoles | undefined): boolean {
  return existing?.walk_leader_locked ? existing.is_walk_leader : incoming;
}
