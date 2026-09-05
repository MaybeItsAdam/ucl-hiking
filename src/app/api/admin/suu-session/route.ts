import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export async function GET() {
  const member = await getCurrentMember();
  if (
    !member ||
    !can(
      {
        membershipTier: member.membership_tier,
        governanceRole: member.governance_role,
        isWalkLeader: member.is_walk_leader,
      },
      "manage_suu_session",
    )
  ) {
    return NextResponse.json({ error: "Forbidden: Principal or Admin access required" }, { status: 403 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("suu_session_settings").select("*").eq("id", "default").maybeSingle();

  return NextResponse.json({
    sessionId: data?.session_id || null,
    authState: data?.auth_state || null,
    status: data?.status || "unconfigured",
    lastError: data?.last_error || null,
    lastCheckedAt: data?.last_checked_at || null,
    updatedAt: data?.updated_at || null,
  });
}

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (
    !member ||
    !can(
      {
        membershipTier: member.membership_tier,
        governanceRole: member.governance_role,
        isWalkLeader: member.is_walk_leader,
      },
      "manage_suu_session",
    )
  ) {
    return NextResponse.json({ error: "Forbidden: Principal or Admin access required" }, { status: 403 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: { sessionId?: unknown; authState?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const authState = typeof body.authState === "string" ? body.authState.trim() : null;

  if (!sessionId && !authState) {
    return NextResponse.json({ error: "Session ID or auth state must be provided" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const supabase = getSupabaseAdmin();

  const { error } = await supabase.from("suu_session_settings").upsert(
    {
      id: "default",
      session_id: sessionId || null,
      auth_state: authState || null,
      status: "active",
      last_error: null,
      last_checked_at: now,
      updated_by: member.id,
      updated_at: now,
    },
    { onConflict: "id" },
  );

  if (error) {
    return NextResponse.json({ error: "Failed to update SU session" }, { status: 500 });
  }

  await supabase.from("audit_log").insert({
    actor_member_id: member.id,
    action: "update_suu_session",
    target_type: "suu_session_settings",
    target_id: "default",
    metadata: { updated_by_email: member.email },
  });

  return NextResponse.json({ ok: true, status: "active", updatedAt: now });
}
