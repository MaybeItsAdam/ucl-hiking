import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EquipmentPortal } from "@/components/EquipmentPortal";
import { can, canUseKit, profileOf } from "@/lib/access";
import { canHandleKit } from "@/lib/kitHandlers";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = {
  title: "Equipment | UCL Hiking Club",
};

/**
 * Every member can open this page: anyone can scan a kit tag to see what it
 * is and who has it, and confirm they've been passed it. Borrowing is for
 * explorers and committee; booking pickups and moving kit in and out of
 * storage for the committee, principals and anyone granted kit handling.
 * The Equipment tab itself still shows only for borrowers and kit handlers
 * (lib/app-pages); everyone else arrives here from a kit notification or a tag.
 */
export default async function EquipmentPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const profile = profileOf(member);
  const isKitHandler = await canHandleKit(member);
  const isPrincipal = can(profile, "manage_equipment");

  return (
    <EquipmentPortal
      memberId={member.id}
      memberRole={member.governance_role}
      isPrincipal={isPrincipal}
      isKitHandler={isKitHandler}
      canBorrow={canUseKit(profile)}
    />
  );
}
