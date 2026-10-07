import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExpenseClaimForm } from "@/components/ExpenseClaimForm";
import { profileOf } from "@/lib/access";
import { claimKindsFor } from "@/lib/expenseClaims";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = { title: "Expenses | UCL Hiking Club" };

/** Its own tab, for everyone who can claim: walk leaders and committee. */
export default async function ExpensesPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const kinds = claimKindsFor(profileOf(member));
  if (!kinds.length) redirect("/portal");
  return (
    <article className="account-settings">
      <ExpenseClaimForm kinds={kinds} name={member.full_name ?? ""} email={member.email} />
    </article>
  );
}
