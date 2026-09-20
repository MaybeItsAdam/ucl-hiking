import type { MembershipTier } from "@/lib/access";

export interface ToolboxMember {
  id: string;
  toolboxUserId: string | null;
  email: string | null;
  fullName: string;
  memberType: string | null;
  membershipType: string | null;
  dateRange: string | null;
  identityStatus: "confirmed" | "unlinked";
}

export interface ToolboxMembersResponse {
  snapshot: { id: string; syncedAt: string; memberCount: number; complete: true } | null;
  members: ToolboxMember[];
}

const TIERS: Record<string, MembershipTier> = { taster: "taster", standard: "standard", explorer: "explorer" };

export function tierFromToolboxMembership(value: string | null | undefined): MembershipTier | null {
  const found = (value ?? "").toLowerCase().split(/[^a-z]+/).map((word) => TIERS[word]).filter(Boolean);
  return found.length === 1 ? found[0] : null;
}

/** SU currently renders `01/09/2026 - 31/08/2027`; keep unknown formats null. */
export function expiryFromDateRange(value: string | null | undefined): string | null {
  const matches = [...(value ?? "").matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)];
  const last = matches.at(-1);
  if (!last) return null;
  const date = new Date(Date.UTC(Number(last[3]), Number(last[2]) - 1, Number(last[1]), 23, 59, 59, 999));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function mapToolboxMember(member: ToolboxMember) {
  const membershipTier = tierFromToolboxMembership(member.membershipType);
  if (!member.toolboxUserId || !member.email || !membershipTier || member.identityStatus !== "confirmed") return null;
  return {
    email: member.email.trim().toLowerCase(),
    full_name: member.fullName,
    toolbox_user_id: member.toolboxUserId,
    membership_tier: membershipTier,
    membership_expires_at: expiryFromDateRange(member.dateRange),
  };
}

type MappedToolboxMember = NonNullable<ReturnType<typeof mapToolboxMember>>;

export interface ExistingMemberForComparison {
  toolbox_user_id: string | null;
  email: string;
  membership_tier: string;
}

export function compareToolboxMembers(
  toolboxMembers: MappedToolboxMember[],
  hikingMembers: ExistingMemberForComparison[],
) {
  const hikingByToolboxId = new Map(
    hikingMembers.flatMap((member) => member.toolbox_user_id ? [[member.toolbox_user_id, member] as const] : []),
  );
  const hikingByEmail = new Map(hikingMembers.map((member) => [member.email.trim().toLowerCase(), member]));
  const matchedHiking = new Set<ExistingMemberForComparison>();
  let onlyToolbox = 0;
  let tierMismatches = 0;

  for (const member of toolboxMembers) {
    const hiking = hikingByToolboxId.get(member.toolbox_user_id) ?? hikingByEmail.get(member.email);
    if (!hiking) {
      onlyToolbox += 1;
      continue;
    }
    matchedHiking.add(hiking);
    if (hiking.membership_tier !== member.membership_tier) tierMismatches += 1;
  }

  return {
    toolboxEligible: toolboxMembers.length,
    hikingActive: hikingMembers.length,
    onlyToolbox,
    onlyHiking: hikingMembers.length - matchedHiking.size,
    tierMismatches,
  };
}
