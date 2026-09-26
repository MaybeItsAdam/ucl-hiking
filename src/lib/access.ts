export const MEMBERSHIP_TIERS = ["taster", "standard", "explorer"] as const;
export const GOVERNANCE_ROLES = ["committee", "principal", "admin"] as const;

export type MembershipTier = (typeof MEMBERSHIP_TIERS)[number];
export type GovernanceRole = (typeof GOVERNANCE_ROLES)[number];

export const MEMBERSHIP_LABELS: Record<MembershipTier, string> = {
  explorer: "Explorer",
  standard: "Standard",
  taster: "Taster",
};

export const GOVERNANCE_LABELS: Record<GovernanceRole, string> = {
  admin: "Admin",
  principal: "Principal",
  committee: "Committee",
};

export type Capability =
  | "lead_walks"
  | "manage_walks"
  | "manage_members"
  | "manage_suu_session"
  | "view_sync_monitor"
  | "trigger_sync"
  | "request_equipment"
  | "review_equipment_requests"
  | "manage_equipment"
  | "review_incidents"
  | "manage_money"
  | "manage_club";

export interface AccessProfile {
  membershipTier: MembershipTier;
  governanceRole: GovernanceRole | null;
  isWalkLeader: boolean;
}

export function isMembershipTier(value: unknown): value is MembershipTier {
  return typeof value === "string" && MEMBERSHIP_TIERS.includes(value as MembershipTier);
}

export function isGovernanceRole(value: unknown): value is GovernanceRole {
  return typeof value === "string" && GOVERNANCE_ROLES.includes(value as GovernanceRole);
}

/** Capabilities are additive; walk leadership never upgrades membership tier. */
export function can(profile: AccessProfile, capability: Capability): boolean {
  const { membershipTier, governanceRole, isWalkLeader } = profile;
  switch (capability) {
    case "lead_walks":
      return isWalkLeader || governanceRole !== null;
    case "manage_walks":
    case "manage_members":
    case "view_sync_monitor":
    case "trigger_sync":
      return governanceRole !== null;
    // Principals hold the kit: they lend it and never ask to borrow it.
    // Explorers and committee borrow from a principal.
    case "review_equipment_requests":
    case "manage_equipment":
    case "manage_suu_session":
    // Incident reports can hold health details, so they stay with the principals.
    case "review_incidents":
    // Trip money is the treasurer's and president's, who are principals.
    case "manage_money":
      return governanceRole === "principal" || governanceRole === "admin";
    // The Club tab: broadcasts, stats, money and the handbook.
    case "manage_club":
      return governanceRole !== null;
    case "request_equipment":
      return membershipTier === "explorer" || governanceRole === "committee";
  }
}

export type RoleChange =
  | { field: "is_walk_leader"; value: boolean }
  | { field: "governance_role"; value: "committee" | null };

export interface RoleActor {
  id: string;
  governanceRole: GovernanceRole | null;
}

export interface RoleTarget {
  id: string;
  governanceRole: GovernanceRole | null;
}

/**
 * Who may change whom from the Members page. Walk leadership is any
 * governance role's call; committee seats are a principal's. Principal and
 * admin come from the Toolbox and are never granted or removed in the app.
 */
export function canChangeRole(actor: RoleActor, target: RoleTarget, change: RoleChange): boolean {
  if (actor.governanceRole === null || actor.id === target.id) return false;
  if (change.field === "is_walk_leader") return true;
  if (actor.governanceRole !== "principal" && actor.governanceRole !== "admin") return false;
  // Only ever between "no role" and "committee".
  return target.governanceRole === null || target.governanceRole === "committee";
}

/** The kit desk is for borrowers and for the principals who lend to them. */
export function canUseKit(profile: AccessProfile): boolean {
  return can(profile, "request_equipment") || can(profile, "manage_equipment");
}

/** The access profile of a member row, for `can()`. */
export function profileOf(member: {
  membership_tier: MembershipTier;
  governance_role: GovernanceRole | null;
  is_walk_leader: boolean;
}): AccessProfile {
  return {
    membershipTier: member.membership_tier,
    governanceRole: member.governance_role,
    isWalkLeader: member.is_walk_leader,
  };
}

export function accessSummary(profile: AccessProfile): string {
  const labels = [MEMBERSHIP_LABELS[profile.membershipTier]];
  if (profile.isWalkLeader) labels.push("Walk leader");
  if (profile.governanceRole) labels.push(GOVERNANCE_LABELS[profile.governanceRole]);
  return labels.join(" · ");
}
