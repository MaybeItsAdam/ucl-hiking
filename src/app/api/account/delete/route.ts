import { NextResponse } from "next/server";
import { clearRolePreviewCookie, clearSessionCookie, getSession } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * In-app account deletion (App Store guideline 5.1.1(v), Play account-deletion policy).
 *
 * Deletes the signed-in person's `members` row. Their equipment requests and walk
 * registrations cascade with it; audit rows and walks they led keep existing with the
 * member reference set to null. It does not touch the Toolbox/UCL identity or the SU
 * membership, so a current member who signs in again gets a fresh account.
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

  const supabase = getSupabaseAdmin();

  // Approved requests are kit currently out on loan and still counted against stock.
  // Deleting them would lose track of the kit, so it has to come back first.
  const { data: loans, error: loansError } = await supabase
    .from("equipment_requests")
    .select("id")
    .eq("member_id", session.memberId)
    .eq("status", "approved");
  if (loansError) {
    return NextResponse.json({ error: "Could not check your kit loans. Try again." }, { status: 500 });
  }
  if (loans && loans.length > 0) {
    return NextResponse.json(
      {
        error:
          "You still have club kit out on loan. Return it to the committee first, then delete your account.",
      },
      { status: 409 },
    );
  }

  // Sign-in audit rows name the person in their metadata; keep the event, drop the name.
  await supabase
    .from("audit_log")
    .update({ metadata: {} })
    .eq("target_type", "member")
    .eq("target_id", session.memberId)
    .like("action", "auth.%");

  const { error: deleteError } = await supabase.from("members").delete().eq("id", session.memberId);
  if (deleteError) {
    return NextResponse.json({ error: "Could not delete your account. Try again." }, { status: 500 });
  }

  await supabase.from("audit_log").insert({
    actor_member_id: null,
    action: "account.self_delete",
    target_type: "member",
    target_id: session.memberId,
    metadata: {},
  });

  await clearRolePreviewCookie();
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
