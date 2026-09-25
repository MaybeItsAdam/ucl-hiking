import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MemberAdminPortal } from "@/components/MemberAdminPortal";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = {
  title: "Members | UCL Hiking Club",
};

export default async function MembersPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const profile = {
    membershipTier: member.membership_tier,
    governanceRole: member.governance_role,
    isWalkLeader: member.is_walk_leader,
  };
  if (!can(profile, "manage_members")) redirect("/portal");

  return (
    <MemberAdminPortal />
  );
}
