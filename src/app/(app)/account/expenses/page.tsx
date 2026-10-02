import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExpenseClaimForm } from "@/components/ExpenseClaimForm";
import { profileOf } from "@/lib/access";
import { claimKindsFor } from "@/lib/expenseClaims";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = { title: "Claim expenses | UCL Hiking Club" };

/** Walk leaders' way in (committee also have it in the Club tab). */
export default async function AccountExpensesPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const kinds = claimKindsFor(profileOf(member));
  if (!kinds.length) redirect("/account");
  return (
    <article className="account-settings">
      <p className="expense-back">
        <Link href="/account">Settings</Link>
      </p>
      <h2>Claim expenses</h2>
      <ExpenseClaimForm kinds={kinds} name={member.full_name ?? ""} email={member.email} />
    </article>
  );
}
