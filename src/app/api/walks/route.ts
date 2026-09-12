import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { getWalksForMember } from "@/lib/walks";

export async function GET() {
  const member = await getCurrentMember();
  const walks = await getWalksForMember(member);
  return NextResponse.json({ walks });
}

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = {
    membershipTier: member.membership_tier,
    governanceRole: member.governance_role,
    isWalkLeader: member.is_walk_leader,
  };

  if (!can(profile, "manage_own_walks") && !can(profile, "manage_walks")) {
    return NextResponse.json(
      { error: "Forbidden: Walk leader or committee privileges required" },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = String(body.title || "").trim();
  const location = String(body.location || "").trim();
  const startsAt = String(body.starts_at || "").trim();
  const distanceKm = Number(body.distance_km);
  const ascentM = Number(body.ascent_m);
  const difficulty = String(body.difficulty || "moderate");
  const capacity = Number(body.capacity || 20);
  const visibility = String(body.visibility || "members");
  const summary = String(body.summary || "").trim();
  const published = body.published !== false;

  if (!title || !location || !startsAt || isNaN(distanceKm) || isNaN(ascentM) || capacity <= 0) {
    return NextResponse.json({ error: "Missing or invalid required fields" }, { status: 400 });
  }

  if (!["easy", "moderate", "challenging"].includes(difficulty)) {
    return NextResponse.json({ error: "Invalid difficulty" }, { status: 400 });
  }

  if (!["public", "members", "explorers"].includes(visibility)) {
    return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { addDevWalk } = await import("@/lib/dev-store");
      const walk = addDevWalk({
        title,
        location,
        starts_at: startsAt,
        distance_km: distanceKm,
        ascent_m: ascentM,
        difficulty: difficulty as "easy" | "moderate" | "challenging",
        capacity,
        spaces_remaining: capacity,
        visibility: visibility as "public" | "members" | "explorers",
        summary: summary || null,
        leader_member_id: member.id,
        published,
        leader: {
          id: member.id,
          full_name: member.full_name,
          email: member.email,
        },
      });
      return NextResponse.json({ ok: true, walk });
    }
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();
  const { data: walk, error } = await supabase
    .from("walks")
    .insert({
      title,
      location,
      starts_at: startsAt,
      distance_km: distanceKm,
      ascent_m: ascentM,
      difficulty,
      capacity,
      spaces_remaining: capacity,
      visibility,
      summary: summary || null,
      leader_member_id: member.id,
      published,
    })
    .select(`*, leader:leader_member_id (id, full_name, email)`)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("audit_log").insert({
    actor_member_id: member.id,
    action: "create_walk",
    target_type: "walks",
    target_id: walk.id,
    metadata: { title, location, startsAt, visibility },
  });

  return NextResponse.json({ ok: true, walk });
}
