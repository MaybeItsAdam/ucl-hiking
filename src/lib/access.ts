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
  | "view_member_walks"
  | "book_walks"
  | "view_explorer_walks"
  | "manage_own_walks"
  | "manage_walks"
  | "manage_members"
  | "manage_committee"
  | "manage_system"
  | "manage_suu_session"
  | "view_sync_monitor"
  | "trigger_sync"
  | "request_equipment"
  | "review_equipment_requests"
  | "manage_equipment";

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
    case "view_member_walks":
    case "book_walks":
      return membershipTier !== "taster";
    case "view_explorer_walks":
      return membershipTier === "explorer";
    case "manage_own_walks":
      return isWalkLeader || governanceRole !== null;
    case "manage_walks":
    case "manage_members":
    case "view_sync_monitor":
    case "trigger_sync":
    case "review_equipment_requests":
    case "manage_equipment":
      return governanceRole !== null;
    case "manage_committee":
    case "manage_suu_session":
      return governanceRole === "principal" || governanceRole === "admin";
    case "manage_system":
      return governanceRole === "admin";
    case "request_equipment":
      return membershipTier !== "taster";
  }
}

export function accessSummary(profile: AccessProfile): string {
  const labels = [MEMBERSHIP_LABELS[profile.membershipTier]];
  if (profile.isWalkLeader) labels.push("Walk leader");
  if (profile.governanceRole) labels.push(GOVERNANCE_LABELS[profile.governanceRole]);
  return labels.join(" · ");
}
