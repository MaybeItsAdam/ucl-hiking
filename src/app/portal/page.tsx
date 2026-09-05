import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  ChevronRight,
  Footprints,
  Map,
  Shield,
  Users,
} from "lucide-react";
import { Header } from "@/components/Header";
import { SyncMonitor } from "@/components/SyncMonitor";
import { EquipmentPortal } from "@/components/EquipmentPortal";
import { accessSummary, can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";

export default async function PortalPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");

  const firstName = member.full_name?.split(" ")[0] || "hiker";
  const profile = {
    membershipTier: member.membership_tier,
    governanceRole: member.governance_role,
    isWalkLeader: member.is_walk_leader,
  };

  const isCommittee = can(profile, "view_sync_monitor");
  const isPrincipal = can(profile, "manage_suu_session");

  return (
    <main className="portal-page">
      <div className="portal-shell">
        <Header />
        <section className="portal-welcome">
          <div>
            <span className="eyebrow">Member basecamp</span>
            <h1>Morning, {firstName}.</h1>
            <p>Your next good weekend starts here.</p>
          </div>
          <span className="role-card">
            <small>Your access</small>
            <strong>{accessSummary(profile)}</strong>
            <i>Synced with the SU roster</i>
          </span>
        </section>

        {isCommittee && (
          <section style={{ padding: "0 28px" }}>
            <SyncMonitor isPrincipal={isPrincipal} />
          </section>
        )}

        <section className="portal-grid">
          <article className="portal-feature">
            <div className="portal-icon"><Map /></div>
            <span>Next walk</span>
            <h2>Box Hill &amp;<br />the Stepping Stones</h2>
            <p>Saturday · 08:15 from Victoria</p>
            <Link href="/#walks">View walk details <ChevronRight size={17} /></Link>
          </article>
          <div className="portal-links">
            <Link href="/#walks"><CalendarDays /><span><strong>Walk calendar</strong><small>See public and member-only walks</small></span><ChevronRight /></Link>
            <Link href="/#membership"><Footprints /><span><strong>My bookings</strong><small>Trips, waitlists and kit notes</small></span><ChevronRight /></Link>
            {can(profile, "manage_own_walks") && (
              <Link href="/portal"><Shield /><span><strong>Leader tools</strong><small>Plans, registers and safety notes</small></span><ChevronRight /></Link>
            )}
            {can(profile, "manage_members") && (
              <Link href="/portal"><Users /><span><strong>Member administration</strong><small>Roster, roles and sync status</small></span><ChevronRight /></Link>
            )}
          </div>
        </section>

        <section style={{ padding: "0 28px 40px" }}>
          <EquipmentPortal
            memberId={member.id}
            membershipTier={member.membership_tier}
            isCommittee={isCommittee}
          />
        </section>

        <form action="/api/auth/logout" method="post" className="logout-form">
          <button type="submit">Sign out</button>
        </form>
      </div>
    </main>
  );
}
