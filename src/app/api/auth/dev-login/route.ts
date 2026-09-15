import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const requestUrl = new URL(request.url);
  // The address UCL sign-in hands the Toolbox, so this matches the real account.
  const email = "zcabacl@ucl.ac.uk";

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseAdmin();
    let { data: member } = await supabase
      .from("members")
      .select("id,email,full_name,toolbox_user_id,membership_tier,governance_role,is_walk_leader,membership_expires_at,revoked_at")
      .eq("email", email)
      .maybeSingle();

    if (!member) {
      const now = new Date().toISOString();
      const { data: created, error } = await supabase
        .from("members")
        .upsert(
          {
            email,
            full_name: "Adam Cleary",
            toolbox_user_id: "dev-admin-id",
            membership_tier: "explorer",
            governance_role: "admin",
            is_walk_leader: true,
            sync_source: "dev-login",
            synced_at: now,
            last_signed_in_at: now,
          },
          { onConflict: "email" }
        )
        .select()
        .single();

      if (!error && created) {
        member = created;
      }
    }

    if (member) {
      await setSessionCookie({
        toolboxUserId: member.toolbox_user_id || "dev-admin-id",
        memberId: member.id,
        email: member.email,
        name: member.full_name || "Adam Cleary",
        membershipTierAtSignIn: member.membership_tier,
        governanceRoleAtSignIn: member.governance_role,
        wasWalkLeaderAtSignIn: member.is_walk_leader,
      });

      const next = requestUrl.searchParams.get("next") || "/portal";
      return NextResponse.redirect(`${requestUrl.origin}${next}`);
    }
  }

  // Fallback in-memory dev session if Supabase is offline
  await setSessionCookie({
    toolboxUserId: "dev-admin-id",
    memberId: "dev-member-id",
    email,
    name: "Adam Cleary (Dev)",
    membershipTierAtSignIn: "explorer",
    governanceRoleAtSignIn: "admin",
    wasWalkLeaderAtSignIn: true,
  });

  const next = requestUrl.searchParams.get("next") || "/portal";
  return NextResponse.redirect(`${requestUrl.origin}${next}`);
}
