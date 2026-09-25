import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EquipmentPortal } from "@/components/EquipmentPortal";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = {
  title: "Equipment | UCL Hiking Club",
};

export default async function EquipmentPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  // Committee borrow from a principal; members will ask later, not yet.
  if (member.governance_role === null) redirect("/portal");

  const isPrincipal = can(
    {
      membershipTier: member.membership_tier,
      governanceRole: member.governance_role,
      isWalkLeader: member.is_walk_leader,
    },
    "manage_equipment",
  );

  return (
    <EquipmentPortal memberId={member.id} isPrincipal={isPrincipal} />
  );
}
