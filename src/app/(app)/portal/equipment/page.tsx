import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EquipmentPortal } from "@/components/EquipmentPortal";
import { can, canUseKit, profileOf } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = {
  title: "Equipment | UCL Hiking Club",
};

export default async function EquipmentPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const profile = profileOf(member);
  // Explorers and committee borrow from a principal; nobody else sees the kit.
  if (!canUseKit(profile)) redirect("/portal");

  const isPrincipal = can(profile, "manage_equipment");

  return (
    <EquipmentPortal memberId={member.id} isPrincipal={isPrincipal} />
  );
}
