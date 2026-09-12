import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = {
    membershipTier: member.membership_tier,
    governanceRole: member.governance_role,
    isWalkLeader: member.is_walk_leader,
  };

  const isCommittee = can(profile, "manage_walks");
  const isLeader = can(profile, "manage_own_walks");

  if (!isCommittee && !isLeader) {
    return NextResponse.json({ error: "Forbidden: Leader access required" }, { status: 403 });
  }

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { getDevWalkAttendees } = await import("@/lib/dev-store");
      return NextResponse.json({ attendees: getDevWalkAttendees(id) });
    }
    return NextResponse.json({ attendees: [] });
  }

  const supabase = getSupabaseAdmin();

  // If not committee, ensure the user is the leader of this specific walk
  if (!isCommittee) {
    const { data: walk } = await supabase.from("walks").select("leader_member_id").eq("id", id).single();
    if (!walk || walk.leader_member_id !== member.id) {
      return NextResponse.json({ error: "Forbidden: You are not the assigned leader for this walk" }, { status: 403 });
    }
  }

  const { data: attendees, error } = await supabase
    .from("walk_registrations")
    .select(`
      member_id,
      status,
      created_at,
      member:member_id (
        id,
        full_name,
        email,
        membership_tier
      )
    `)
    .eq("walk_id", id)
    .in("status", ["confirmed", "waitlist"])
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ attendees: attendees || [] });
}
