import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MemberAdminPortal } from "@/components/MemberAdminPortal";
import { can, profileOf } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = {
  title: "Members | UCL Hiking Club",
};

export default async function MembersPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  if (!can(profileOf(member), "manage_members")) redirect("/portal");

  return <MemberAdminPortal viewer={{ id: member.id, governanceRole: member.governance_role }} />;
}
