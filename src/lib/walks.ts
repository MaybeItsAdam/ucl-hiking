import type { Member, Walk, WalkRegistration, WalkRegistrationStatus } from "./types";
import { can } from "./access";
import { getSupabaseAdmin, isSupabaseConfigured } from "./supabase";
import {
  cancelDevWalkRegistration,
  getDevBookings,
  getDevWalks,
  registerDevWalk,
} from "./dev-store";

export async function getPublicWalks(): Promise<Walk[]> {
  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      return getDevWalks().filter((w) => w.visibility === "public" && w.published);
    }
    return [];
  }
  const { data, error } = await getSupabaseAdmin()
    .from("walks")
    .select("id,title,location,starts_at,distance_km,ascent_m,difficulty,capacity,spaces_remaining,visibility,summary")
    .eq("published", true)
    .eq("visibility", "public")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(6);

  if (error || !data) return [];
  return data as Walk[];
}

export async function getWalksForMember(member: Member | null): Promise<Walk[]> {
  const profile = member
    ? {
        membershipTier: member.membership_tier,
        governanceRole: member.governance_role,
        isWalkLeader: member.is_walk_leader,
      }
    : null;

  const allowedVisibilities: ("public" | "members" | "explorers")[] = ["public"];
  if (profile && can(profile, "view_member_walks")) {
    allowedVisibilities.push("members");
  }
  if (profile && can(profile, "view_explorer_walks")) {
    allowedVisibilities.push("explorers");
  }

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const walks = getDevWalks().filter((w) => allowedVisibilities.includes(w.visibility));
      if (member) {
        const bookings = getDevBookings(member.id);
        const map = new Map(bookings.map((b) => [b.walk_id, b.status]));
        for (const w of walks) {
          w.my_registration = map.get(w.id) || null;
        }
      }
      return walks;
    }
    return [];
  }

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("walks")
    .select(`
      id,
      title,
      location,
      starts_at,
      distance_km,
      ascent_m,
      difficulty,
      capacity,
      spaces_remaining,
      visibility,
      summary,
      published,
      leader_member_id,
      leader:leader_member_id (id, full_name, email)
    `)
    .in("visibility", allowedVisibilities)
    .gte("starts_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("starts_at", { ascending: true });

  const canSeeDrafts = profile && (can(profile, "manage_walks") || can(profile, "manage_own_walks"));
  if (!canSeeDrafts) {
    query = query.eq("published", true);
  }

  const { data: walksData, error } = await query;
  if (error || !walksData || walksData.length === 0) {
    return [];
  }

  const walks = walksData as unknown as (Walk & { leader?: { id: string; full_name: string | null; email: string } })[];

  // Fetch registrations for current member to attach my_registration status
  if (member) {
    const { data: regs } = await supabase
      .from("walk_registrations")
      .select("walk_id, status")
      .eq("member_id", member.id)
      .in("status", ["confirmed", "waitlist"]);

    if (regs && regs.length > 0) {
      const regMap = new Map<string, WalkRegistrationStatus>(
        regs.map((r) => [r.walk_id, r.status as WalkRegistrationStatus]),
      );
      for (const w of walks) {
        w.my_registration = regMap.get(w.id) || null;
      }
    }
  }

  return walks;
}

export async function getMemberBookings(memberId: string): Promise<WalkRegistration[]> {
  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      return getDevBookings(memberId);
    }
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("walk_registrations")
    .select(`
      walk_id,
      member_id,
      status,
      created_at,
      updated_at,
      walk:walk_id (
        id,
        title,
        location,
        starts_at,
        distance_km,
        ascent_m,
        difficulty,
        capacity,
        spaces_remaining,
        visibility,
        summary,
        leader:leader_member_id (id, full_name, email)
      )
    `)
    .eq("member_id", memberId)
    .in("status", ["confirmed", "waitlist"])
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data as unknown as WalkRegistration[];
}

export async function registerForWalk(
  member: Member,
  walkId: string,
): Promise<{ ok: boolean; status?: WalkRegistrationStatus; error?: string }> {
  const profile = {
    membershipTier: member.membership_tier,
    governanceRole: member.governance_role,
    isWalkLeader: member.is_walk_leader,
  };

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      return registerDevWalk(member, walkId);
    }
    return { ok: false, error: "Database not configured" };
  }

  const supabase = getSupabaseAdmin();

  // Fetch walk
  const { data: walk, error: walkErr } = await supabase
    .from("walks")
    .select("*")
    .eq("id", walkId)
    .single();

  if (walkErr || !walk) {
    return { ok: false, error: "Walk not found" };
  }

  // Capability checks
  if (walk.visibility === "explorers" && !can(profile, "view_explorer_walks")) {
    return { ok: false, error: "This walk is exclusive to Explorer tier members." };
  }
  if (walk.visibility === "members" && !can(profile, "book_walks")) {
    return { ok: false, error: "You need a Standard or Explorer membership to book member walks." };
  }

  // Check existing registration
  const { data: existing } = await supabase
    .from("walk_registrations")
    .select("status")
    .eq("walk_id", walkId)
    .eq("member_id", member.id)
    .maybeSingle();

  if (existing && ["confirmed", "waitlist"].includes(existing.status)) {
    return { ok: false, error: `You are already ${existing.status} for this walk.` };
  }

  const status: WalkRegistrationStatus = walk.spaces_remaining > 0 ? "confirmed" : "waitlist";

  if (status === "confirmed") {
    const newSpaces = Math.max(0, walk.spaces_remaining - 1);
    await supabase.from("walks").update({ spaces_remaining: newSpaces }).eq("id", walkId);
  }

  const { error: regErr } = await supabase.from("walk_registrations").upsert({
    walk_id: walkId,
    member_id: member.id,
    status,
    updated_at: new Date().toISOString(),
  });

  if (regErr) {
    return { ok: false, error: "Failed to save registration: " + regErr.message };
  }

  await supabase.from("audit_log").insert({
    actor_member_id: member.id,
    action: `walk_register_${status}`,
    target_type: "walk_registrations",
    target_id: walkId,
    metadata: { memberEmail: member.email, status, spaces_remaining: walk.spaces_remaining },
  });

  return { ok: true, status };
}

export async function cancelWalkRegistration(
  member: Member,
  walkId: string,
): Promise<{ ok: boolean; error?: string; waitlistPromoted?: string | null }> {
  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      return cancelDevWalkRegistration(member, walkId);
    }
    return { ok: false, error: "Database not configured" };
  }

  const supabase = getSupabaseAdmin();

  const { data: reg, error: regErr } = await supabase
    .from("walk_registrations")
    .select("*")
    .eq("walk_id", walkId)
    .eq("member_id", member.id)
    .single();

  if (regErr || !reg || reg.status === "cancelled") {
    return { ok: false, error: "No active booking found to cancel." };
  }

  const wasConfirmed = reg.status === "confirmed";

  // Mark registration as cancelled
  await supabase
    .from("walk_registrations")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("walk_id", walkId)
    .eq("member_id", member.id);

  let waitlistPromoted: string | null = null;

  if (wasConfirmed) {
    // Find the oldest active waitlisted member for this walk to promote
    const { data: oldestWaitlist } = await supabase
      .from("walk_registrations")
      .select("member_id, created_at")
      .eq("walk_id", walkId)
      .eq("status", "waitlist")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (oldestWaitlist) {
      // Promote waitlisted member
      await supabase
        .from("walk_registrations")
        .update({ status: "confirmed", updated_at: new Date().toISOString() })
        .eq("walk_id", walkId)
        .eq("member_id", oldestWaitlist.member_id);

      waitlistPromoted = oldestWaitlist.member_id;

      await supabase.from("audit_log").insert({
        actor_member_id: member.id,
        action: "walk_waitlist_promoted",
        target_type: "walk_registrations",
        target_id: walkId,
        metadata: { promoted_member_id: oldestWaitlist.member_id },
      });
    } else {
      // No waitlist: replenish space on the walk
      const { data: walk } = await supabase.from("walks").select("capacity, spaces_remaining").eq("id", walkId).single();
      if (walk) {
        const newSpaces = Math.min(walk.capacity, walk.spaces_remaining + 1);
        await supabase.from("walks").update({ spaces_remaining: newSpaces }).eq("id", walkId);
      }
    }
  }

  await supabase.from("audit_log").insert({
    actor_member_id: member.id,
    action: "walk_cancel_booking",
    target_type: "walk_registrations",
    target_id: walkId,
    metadata: { wasConfirmed, waitlistPromoted },
  });

  return { ok: true, waitlistPromoted };
}
