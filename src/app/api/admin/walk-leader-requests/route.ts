import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { REQUEST_COLUMNS } from "@/lib/walkLeaderRequests";

/** GET /api/admin/walk-leader-requests — open requests, oldest first. */
export async function GET() {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(profileOf(member), "manage_members")) {
    return NextResponse.json({ error: "Forbidden: Committee access required" }, { status: 403 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ requests: [] });

  const { data, error } = await getSupabaseAdmin()
    .from("walk_leader_requests")
    .select(`${REQUEST_COLUMNS}, member:member_id (full_name, email)`)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  // Missing before the migration: nothing to review.
  if (error) return NextResponse.json({ requests: [] });
  return NextResponse.json({ requests: data ?? [] });
}
