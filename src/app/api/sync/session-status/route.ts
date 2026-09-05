import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { getCurrentMember } from "@/lib/session";
import { can } from "@/lib/access";

function secretMatches(provided: string | null): boolean {
  const expected = process.env.MEMBER_SYNC_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

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
      "view_sync_monitor",
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();
  const [sessionRes, memberSyncRes, eventSyncRes] = await Promise.all([
    supabase.from("suu_session_settings").select("*").eq("id", "default").maybeSingle(),
    supabase.from("member_sync_runs").select("*").order("completed_at", { ascending: false }).limit(5),
    supabase.from("event_sync_runs").select("*").order("completed_at", { ascending: false }).limit(5),
  ]);

  return NextResponse.json({
    session: sessionRes.data || { status: "unconfigured", last_error: null, last_checked_at: null },
    memberSyncs: memberSyncRes.data || [],
    eventSyncs: eventSyncRes.data || [],
  });
}

export async function POST(request: Request) {
  const secretProvided = request.headers.get("x-member-sync-secret");
  const isSecretValid = secretMatches(secretProvided);

  if (!isSecretValid) {
    const member = await getCurrentMember();
    if (
      !member ||
      !can(
        {
          membershipTier: member.membership_tier,
          governanceRole: member.governance_role,
          isWalkLeader: member.is_walk_leader,
        },
        "view_sync_monitor",
      )
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: { status?: unknown; error?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const statusStr = String(body.status || "error");
  const status = ["active", "expired", "error", "unconfigured"].includes(statusStr) ? statusStr : "error";
  const errorMsg = typeof body.error === "string" ? body.error : null;
  const now = new Date().toISOString();

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("suu_session_settings").upsert(
    {
      id: "default",
      status,
      last_error: errorMsg,
      last_checked_at: now,
      updated_at: now,
    },
    { onConflict: "id" },
  );

  if (error) {
    return NextResponse.json({ error: "Failed to update session status" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status, lastCheckedAt: now });
}
