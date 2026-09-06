import { NextResponse } from "next/server";
import { isGovernanceRole, isMembershipTier } from "@/lib/access";
import { setSessionCookie } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { isToolboxAdmin, verifyToolboxToken } from "@/lib/toolbox";

export async function POST(request: Request) {
  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (typeof body.token !== "string" || body.token.length > 8_000) {
    return NextResponse.json({ error: "Missing sign-in token" }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Membership service is not configured" }, { status: 503 });
  }

  let identity;
  try {
    identity = await verifyToolboxToken(body.token);
  } catch {
    return NextResponse.json({ error: "Identity service is unavailable" }, { status: 502 });
  }
  if (!identity) {
    return NextResponse.json({ error: "UCL sign-in has expired or is invalid" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  let { data: member, error } = await supabase
    .from("members")
    .select("id,email,full_name,membership_tier,governance_role,is_walk_leader,membership_expires_at,revoked_at")
    .eq("email", identity.email)
    .maybeSingle();

  // If the user is an admin on Adam's Campus Toolbox (global admin, Adam Cleary, or store reviewer),
  // ensure they have an active Admin Explorer account so signing in with Toolbox always works.
  if (isToolboxAdmin(identity)) {
    const isFullAdmin =
      member &&
      member.governance_role === "admin" &&
      member.membership_tier === "explorer" &&
      !member.revoked_at;

    if (!isFullAdmin) {
      const now = new Date().toISOString();
      const defaultName =
        identity.name ||
        member?.full_name ||
        (identity.email.includes("apple")
          ? "Apple Reviewer"
          : identity.email.includes("android")
          ? "Android Reviewer"
          : "Adam Cleary");

      const { data: upserted, error: upsertError } = await supabase
        .from("members")
        .upsert(
          {
            email: identity.email,
            full_name: defaultName,
            toolbox_user_id: identity.id,
            membership_tier: "explorer",
            governance_role: "admin",
            is_walk_leader: true,
            sync_source: "toolbox-admin",
            synced_at: now,
            revoked_at: null,
            last_signed_in_at: now,
          },
          { onConflict: "email" },
        )
        .select(
          "id,email,full_name,membership_tier,governance_role,is_walk_leader,membership_expires_at,revoked_at",
        )
        .single();

      if (!upsertError && upserted) {
        member = upserted;
        error = null;
      }
    }
  }

  const expired = member?.membership_expires_at
    ? new Date(member.membership_expires_at) < new Date()
    : false;
  if (
    error || !member || member.revoked_at || expired ||
    !isMembershipTier(member.membership_tier) ||
    (member.governance_role !== null && !isGovernanceRole(member.governance_role))
  ) {
    return NextResponse.json(
      {
        error:
          "Your UCL account is valid, but it is not on the current Hiking Club member list.",
      },
      { status: 403 },
    );
  }

  const { error: updateError } = await supabase
    .from("members")
    .update({
      toolbox_user_id: identity.id,
      last_signed_in_at: new Date().toISOString(),
      ...(member.full_name ? {} : { full_name: identity.name }),
    })
    .eq("id", member.id);
  if (updateError) {
    return NextResponse.json({ error: "Could not link membership" }, { status: 500 });
  }

  await supabase.from("audit_log").insert({
    actor_member_id: member.id,
    action: "auth.sign_in",
    target_type: "member",
    target_id: member.id,
    metadata: { identityProvider: "adams-campus-toolbox" },
  });

  await setSessionCookie({
    toolboxUserId: identity.id,
    memberId: member.id,
    email: identity.email,
    name: identity.name ?? undefined,
    membershipTierAtSignIn: member.membership_tier,
    governanceRoleAtSignIn: member.governance_role,
    wasWalkLeaderAtSignIn: member.is_walk_leader,
  });

  return NextResponse.json({ ok: true, redirectTo: "/portal" });
}
