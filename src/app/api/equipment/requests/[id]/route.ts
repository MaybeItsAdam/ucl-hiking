import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const profile = {
    membershipTier: member.membership_tier,
    governanceRole: member.governance_role,
    isWalkLeader: member.is_walk_leader,
  };

  const isCommittee = can(profile, "review_equipment_requests");

  let body: { status?: unknown; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const statusStr = String(body.status || "");
  const notes = typeof body.notes === "string" ? body.notes.trim() : null;

  if (!["approved", "rejected", "returned", "cancelled"].includes(statusStr)) {
    return NextResponse.json({ error: "Invalid request status" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: req, error: fetchError } = await supabase
    .from("equipment_requests")
    .select("*, equipment:equipment_id(*)")
    .eq("id", id)
    .single();

  if (fetchError || !req) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const isOwner = req.member_id === member.id;

  if (statusStr === "cancelled") {
    if (!isOwner && !isCommittee) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (!isCommittee) {
    return NextResponse.json({ error: "Forbidden: Committee access required to review requests" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const eqItem = req.equipment;

  if (statusStr === "approved" && req.status !== "approved") {
    if (eqItem.available_quantity < req.quantity) {
      return NextResponse.json(
        { error: `Insufficient stock to approve. Available: ${eqItem.available_quantity}, requested: ${req.quantity}` },
        { status: 400 },
      );
    }
    const newAvail = eqItem.available_quantity - req.quantity;
    await supabase.from("equipment").update({ available_quantity: newAvail }).eq("id", eqItem.id);
  } else if ((statusStr === "returned" || statusStr === "cancelled") && req.status === "approved") {
    const newAvail = Math.min(eqItem.total_quantity, eqItem.available_quantity + req.quantity);
    await supabase.from("equipment").update({ available_quantity: newAvail }).eq("id", eqItem.id);
  }

  const updates: Record<string, unknown> = {
    status: statusStr,
    notes: notes || req.notes,
    updated_at: now,
  };

  if (isCommittee) {
    updates.reviewed_by = member.id;
    updates.reviewed_at = now;
  }

  const { data: updated, error: updateError } = await supabase
    .from("equipment_requests")
    .update(updates)
    .eq("id", id)
    .select(`*, equipment:equipment_id(*), member:member_id(id, email, full_name)`)
    .single();

  if (updateError) {
    return NextResponse.json({ error: "Failed to update request" }, { status: 500 });
  }

  await supabase.from("audit_log").insert({
    actor_member_id: member.id,
    action: `equipment_request_${statusStr}`,
    target_type: "equipment_requests",
    target_id: id,
    metadata: { new_status: statusStr, notes },
  });

  return NextResponse.json({ ok: true, request: updated });
}
