import Link from "next/link";
import { UserRound } from "lucide-react";
import { accessSummary } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { SignInButton } from "@/components/SignInButton";
import { ClubMark } from "@/components/ClubMark";

export async function Header() {
  const member = await getCurrentMember();

  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="UCL Hiking Club home">
        <ClubMark />
        <span><strong>UCL Hiking</strong> Club</span>
      </Link>
      <nav className="main-nav" aria-label="Main navigation">
        <Link href="/#walks">Walks</Link>
        <Link href="/#membership">Membership</Link>
        <Link href="/#about">About</Link>
      </nav>
      {member ? (
        <Link className="member-pill" href="/portal">
          <span className="avatar"><UserRound size={15} /></span>
          <span className="member-pill-copy">
            <strong>{member.full_name?.split(" ")[0] || "My account"}</strong>
            <small>{accessSummary({ membershipTier: member.membership_tier, governanceRole: member.governance_role, isWalkLeader: member.is_walk_leader })}</small>
          </span>
        </Link>
      ) : (
        <SignInButton compact />
      )}
    </header>
  );
}
