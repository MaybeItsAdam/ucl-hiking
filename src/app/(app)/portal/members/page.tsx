import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MemberAdminPortal } from "@/components/MemberAdminPortal";
import { WalkLeaderRequests } from "@/components/WalkLeaderRequests";
import { can, canApproveLeaders, profileOf } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = {
  title: "Members | UCL Hiking Club",
};

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  if (!can(profileOf(member), "manage_members")) redirect("/portal");
  const { request } = await searchParams;

  return (
    <>
      <WalkLeaderRequests
        viewerId={member.id}
        focusId={typeof request === "string" ? request : null}
        canApprove={canApproveLeaders({ governanceRole: member.governance_role, email: member.email })}
      />
      <MemberAdminPortal viewer={{ id: member.id, governanceRole: member.governance_role, email: member.email }} />
    </>
  );
}
