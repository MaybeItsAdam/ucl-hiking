import { redirect } from "next/navigation";
import { can, profileOf } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";

/** Every Club page starts here: committee only, and whether they're a principal. */
export async function requireClub() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const profile = profileOf(member);
  if (!can(profile, "manage_club")) redirect("/portal");
  return { member, principal: can(profile, "manage_money") };
}
