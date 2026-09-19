import { redirect } from "next/navigation";
import { APP_PAGE_HREFS, availablePages } from "@/lib/app-pages";
import { getCurrentMember } from "@/lib/session";

/** Sign-in lands here; send each member to the first page they can use. */
export default async function PortalPage(props: {
  searchParams?: Promise<{ section?: string }>;
}) {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");

  const pages = availablePages({
    membershipTier: member.membership_tier,
    governanceRole: member.governance_role,
    isWalkLeader: member.is_walk_leader,
  });
  const searchParams = props.searchParams ? await props.searchParams : undefined;
  // Old links used ?section=members.
  const wanted = searchParams?.section === "members" ? "members" : pages[0];
  redirect(APP_PAGE_HREFS[pages.includes(wanted) ? wanted : pages[0]]);
}
