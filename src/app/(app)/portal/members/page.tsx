import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlumniAdmin } from "@/components/AlumniAdmin";
import { MemberAdminPortal } from "@/components/MemberAdminPortal";
import { WalkLeaderRequests } from "@/components/WalkLeaderRequests";
import { can, canApproveLeaders, canGrantAlumni, profileOf } from "@/lib/access";
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
      {/* Principals only: past members aren't on the roster above, so alumni have their own list. */}
      {!member.is_preview && canGrantAlumni({ id: member.id, governanceRole: member.governance_role }, "") ? (
        <AlumniAdmin viewerId={member.id} />
      ) : null}
    </>
  );
}
