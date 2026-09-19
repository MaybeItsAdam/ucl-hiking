import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/Header";
import { PortalDashboard } from "@/components/PortalDashboard";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";

export default async function PortalPage(props: {
  searchParams?: Promise<{ view?: string; section?: string }>;
}) {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");

  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const initialView =
    searchParams?.view === "member" || searchParams?.view === "officer"
      ? searchParams.view
      : undefined;
  const initialSection = searchParams?.section === "members" ? "members" : "inventory";

  const profile = {
    membershipTier: member.membership_tier,
    governanceRole: member.governance_role,
    isWalkLeader: member.is_walk_leader,
  };

  const isCommittee = can(profile, "view_sync_monitor");
  const isPrincipal = can(profile, "manage_suu_session");
  const isWalkLeader = can(profile, "manage_own_walks");

  return (
    <main className="portal-page">
      <div className="portal-shell">
        <Header />
        <PortalDashboard
          member={member}
          isCommittee={isCommittee}
          isPrincipal={isPrincipal}
          isWalkLeader={isWalkLeader}
          initialView={initialView}
          initialSection={initialSection}
        />
        <form action="/api/auth/logout" method="post" className="logout-form">
          <button type="submit">Sign out</button>
        </form>
        <div className="portal-account-links">
          <Link className="portal-privacy-link" href="/privacy">Privacy</Link>
          <Link className="portal-privacy-link" href="/account/delete">Delete my account</Link>
        </div>
      </div>
    </main>
  );
}
