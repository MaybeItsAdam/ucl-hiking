import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import {
  KIT_COOL_OFF_DAYS,
  deletionBlockSummary,
  describeItem,
  parseDeletionResult,
  type DeletionBlock,
} from "@/lib/kitLoans";
import { notify } from "@/lib/notify";
import { clearRolePreviewCookie, clearSessionCookie, getSession } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * In-app account deletion (App Store guideline 5.1.1(v), Play account-deletion policy).
 *
 * Deletes the signed-in person's `members` row through `delete_member_account()`,
 * which checks for club kit and deletes in one transaction:
 *
 * - kit out on loan (an approved request, overdue or not) blocks deletion;
 * - so does a loan that ended less than KIT_COOL_OFF_DAYS ago, so a principal can
 *   check what came back;
 * - pending requests are cancelled, and the lending history is kept with the
 *   borrower's name and email on it rather than deleted.
 *
 * A trigger on `members` refuses any delete while kit is out, so this is not the
 * only line of defence. Walk attendance and emergency details cascade away; audit
 * rows and walks they led keep existing with the member reference set to null. It
 * does not touch the Toolbox/UCL identity or the SU membership, so a current
 * member who signs in again gets a fresh account.
 *
 * Uses the session rather than getCurrentMember() so that an expired or revoked member
 * can still delete their data, and so role preview never changes whose row is deleted.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in to delete your account." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== "delete") {
    return NextResponse.json({ error: "Confirm the deletion to continue." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Membership service is not configured" }, { status: 503 });
    }
    await clearRolePreviewCookie();
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }

  const { data, error } = await getSupabaseAdmin().rpc("delete_member_account", {
    p_member_id: session.memberId,
    p_cool_off_days: KIT_COOL_OFF_DAYS,
  });
  if (error) {
    console.error(`[account.delete] ${session.memberId}: ${error.code ?? ""} ${error.message}`);
    // restrict_violation: the members trigger caught kit the function didn't see.
    if (error.code === "23001") {
      return NextResponse.json(
        { error: "You still have club kit out on loan. Return it to a principal first, then delete your account." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Could not delete your account. Try again." }, { status: 500 });
  }

  const result = parseDeletionResult(data);
  if (!result) {
    console.error(`[account.delete] ${session.memberId}: unexpected result ${JSON.stringify(data)}`);
    return NextResponse.json({ error: "Could not delete your account. Try again." }, { status: 500 });
  }

  if (result.status === "blocked") {
    const block: DeletionBlock =
      result.reason === "on_loan"
        ? { reason: "on_loan", items: result.items }
        : { reason: "cooling_off", until: result.until, items: result.items };
    await reportBlockedAttempt(session.memberId, session.name || session.email, block);
    return NextResponse.json({ error: deletionBlockSummary(block), block }, { status: 409 });
  }

  // "deleted", or "not_found" when the row was already gone: either way, sign out.
  await clearRolePreviewCookie();
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}

/**
 * A blocked attempt is audited. If kit is out, the principals hear about it too:
 * someone trying to leave with club kit is worth a chase. A cool-off block is
 * routine (the kit is back) and only audited.
 */
async function reportBlockedAttempt(memberId: string, who: string, block: DeletionBlock) {
  await audit(memberId, "account.self_delete_blocked", "member", memberId, {
    reason: block.reason,
    requests: block.items.map((i) => i.id),
  });
  if (block.reason !== "on_loan") return;

  const { data: principals, error } = await getSupabaseAdmin()
    .from("members")
    .select("id")
    .in("governance_role", ["principal", "admin"])
    .is("revoked_at", null)
    .neq("id", memberId);
  if (error) {
    console.error(`[account.delete] principals not notified: ${error.message}`);
    return;
  }
  const items = block.items.map(describeItem).join(", ");
  await notify(
    (principals ?? []).map((p) => p.id as string),
    {
      kind: "kit",
      title: `${who} tried to delete their account with kit out`,
      body: `Still on loan: ${items}. The deletion was blocked until it is marked returned.`,
      url: "/portal/equipment",
    },
  );
}
