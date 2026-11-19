import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EquipmentPortal } from "@/components/EquipmentPortal";
import { can, canUseKit, profileOf } from "@/lib/access";
import { canHandleKit } from "@/lib/kitHandlers";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = {
  title: "Equipment | UCL Hiking Club",
};

export default async function EquipmentPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const profile = profileOf(member);
  // Explorers and committee borrow from a principal; anyone a principal has
  // let scan kit gets the page too, for the scanner.
  const isKitHandler = await canHandleKit(member);
  if (!canUseKit(profile) && !isKitHandler) redirect("/portal");

  const isPrincipal = can(profile, "manage_equipment");

  return (
    <EquipmentPortal
      memberId={member.id}
      isPrincipal={isPrincipal}
      isKitHandler={isKitHandler}
      canBorrow={canUseKit(profile)}
    />
  );
}
