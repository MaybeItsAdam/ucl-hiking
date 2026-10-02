import type { Metadata } from "next";
import { ClubSubnav } from "@/components/ClubSubnav";
import { ExpenseClaimForm } from "@/components/ExpenseClaimForm";
import { profileOf } from "@/lib/access";
import { requireClub } from "@/lib/clubPage";
import { claimKindsFor } from "@/lib/expenseClaims";

export const metadata: Metadata = { title: "Expenses | UCL Hiking Club" };

export default async function ClubExpensesPage() {
  const { member, principal } = await requireClub();
  return (
    <article className="club-page">
      <ClubSubnav active="expenses" principal={principal} />
      <ExpenseClaimForm kinds={claimKindsFor(profileOf(member))} name={member.full_name ?? ""} email={member.email} />
    </article>
  );
}
