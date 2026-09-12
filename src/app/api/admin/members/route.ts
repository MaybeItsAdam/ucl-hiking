import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export async function GET(request: Request) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = {
    membershipTier: member.membership_tier,
    governanceRole: member.governance_role,
    isWalkLeader: member.is_walk_leader,
  };

  if (!can(profile, "manage_members")) {
    return NextResponse.json({ error: "Forbidden: Committee access required" }, { status: 403 });
  }

  const emptyResponse = {
    members: [],
    totalCount: 0,
    counts: {
      taster: 0,
      standard: 0,
      explorer: 0,
      leaders: 0,
    },
  };

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { getDevMembers, getDevMemberCounts } = await import("@/lib/dev-store");
      const { searchParams } = new URL(request.url);
      const q = searchParams.get("q")?.trim().toLowerCase() || "";
      const tier = searchParams.get("tier") || "";
      const role = searchParams.get("role") || "";
      const filtered = getDevMembers(q, tier, role);
      const counts = getDevMemberCounts();
      return NextResponse.json({
        members: filtered,
        totalCount: getDevMembers().length,
        counts,
      });
    }
    return NextResponse.json(emptyResponse);
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim().toLowerCase() || "";
  const tier = searchParams.get("tier") || "";
  const role = searchParams.get("role") || "";

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("members")
    .select("id, email, full_name, membership_tier, governance_role, is_walk_leader, membership_expires_at, synced_at, sync_source")
    .is("revoked_at", null)
    .order("full_name", { ascending: true });

  if (q) {
    query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
  }
  if (tier) {
    query = query.eq("membership_tier", tier);
  }
  if (role === "leader") {
    query = query.eq("is_walk_leader", true);
  } else if (role) {
    query = query.eq("governance_role", role);
  }

  const { data: members, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aggregate counts
  const { data: allMembers } = await supabase
    .from("members")
    .select("membership_tier, is_walk_leader")
    .is("revoked_at", null);

  const counts = {
    taster: 0,
    standard: 0,
    explorer: 0,
    leaders: 0,
  };

  if (allMembers) {
    for (const m of allMembers) {
      if (m.membership_tier === "taster") counts.taster++;
      else if (m.membership_tier === "standard") counts.standard++;
      else if (m.membership_tier === "explorer") counts.explorer++;
      if (m.is_walk_leader) counts.leaders++;
    }
  }

  return NextResponse.json({
    members: members || [],
    totalCount: allMembers?.length || members?.length || 0,
    counts,
  });
}
