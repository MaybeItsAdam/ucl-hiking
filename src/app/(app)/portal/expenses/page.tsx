import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExpenseClaimForm } from "@/components/ExpenseClaimForm";
import { profileOf } from "@/lib/access";
import { claimKindsFor } from "@/lib/expenseClaims";
import { isClaimKind } from "@/lib/reimbursementToken";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export const metadata: Metadata = { title: "Expenses | UCL Hiking Club" };

/** Its own tab, for everyone who can claim: walk leaders and committee. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ kind?: string; date?: string }> }) {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const kinds = claimKindsFor(profileOf(member));
  if (!kinds.length) redirect("/portal");

  // My walks links here as ?kind=wl&date=2026-10-18 for a walk still to claim.
  const params = await searchParams;
  const kind = isClaimKind(params.kind) && kinds.includes(params.kind) ? params.kind : undefined;
  const date = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : undefined;
  let nickname: string | undefined;
  if (kind === "wl" && isSupabaseConfigured()) {
    const { data } = await getSupabaseAdmin().from("members").select("wl_name").eq("id", member.id).maybeSingle();
    nickname = (data?.wl_name as string | null | undefined) ?? undefined;
  }

  return (
    <article className="account-settings">
      <ExpenseClaimForm
        // A new prefill (another walk's "Claim") starts a fresh form.
        key={`${kind ?? ""}:${date ?? ""}`}
        kinds={kinds}
        name={member.full_name ?? ""}
        email={member.email}
        initial={kind || date ? { kind, date, nickname } : undefined}
      />
    </article>
  );
}
