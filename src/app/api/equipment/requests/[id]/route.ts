import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";
import { can } from "@/lib/access";
import { canTransitionRequest, type RequestTransition } from "@/lib/kitLoans";
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

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { updateDevEquipmentRequestStatus } = await import("@/lib/dev-store");
      const updated = updateDevEquipmentRequestStatus(
        id,
        statusStr as "approved" | "rejected" | "returned" | "cancelled",
        notes || undefined,
        member.id,
      );
      if (!updated) {
        return NextResponse.json({ error: "Request not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, request: updated });
    }
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
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
  const target = statusStr as RequestTransition;

  if (!isOwner && !isCommittee) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canTransitionRequest(req.status, target, { isOwner, isReviewer: isCommittee })) {
    if (req.status === "approved" && target === "cancelled" && !isCommittee) {
      return NextResponse.json(
        { error: "This kit is already out on loan. Return it to a principal, who will mark it returned." },
        { status: 403 },
      );
    }
    if (!isCommittee) {
      return NextResponse.json({ error: "Forbidden: Committee access required to review requests" }, { status: 403 });
    }
    return NextResponse.json({ error: `A ${req.status} request can't be marked ${target}.` }, { status: 409 });
  }

  const now = new Date().toISOString();
  const eqItem = req.equipment;

  if (target === "approved" && eqItem.available_quantity < req.quantity) {
    return NextResponse.json(
      { error: `Insufficient stock to approve. Available: ${eqItem.available_quantity}, requested: ${req.quantity}` },
      { status: 400 },
    );
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

  // Only if nobody else changed it since we read it, so two clicks can't count
  // the same loan out twice. Stock moves in the database with the status change
  // (trigger equipment_requests_move_stock), so concurrent approvals can't over-lend.
  const { data: updated, error: updateError } = await supabase
    .from("equipment_requests")
    .update(updates)
    .eq("id", id)
    .eq("status", req.status)
    .select(`*, equipment:equipment_id(*), member:member_id(id, email, full_name)`)
    .maybeSingle();

  if (updateError) {
    if (updateError.message?.includes("insufficient_stock")) {
      return NextResponse.json(
        { error: "Not enough of this kit left to approve. Another loan was approved first; refresh to see current stock." },
        { status: 409 },
      );
    }
    // equipment_requests_open_has_borrower: the member deleted their account meanwhile.
    if (updateError.code === "23514") {
      return NextResponse.json({ error: "That member has deleted their account, so the request is closed." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to update request" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "This request was changed by someone else. Refresh and try again." }, { status: 409 });
  }

  await supabase.from("audit_log").insert({
    actor_member_id: member.id,
    action: `equipment_request_${statusStr}`,
    target_type: "equipment_requests",
    target_id: id,
    metadata: { new_status: statusStr, notes },
  });

  // The borrower hears the decision; a principal's own actions need no telling.
  if ((statusStr === "approved" || statusStr === "rejected") && !isOwner && req.member_id) {
    const what = `${req.quantity > 1 ? `${req.quantity} × ` : ""}${eqItem.name}`;
    await notify([req.member_id], {
      kind: "kit",
      title: statusStr === "approved" ? `Approved: ${what}` : `Declined: ${what}`,
      body: statusStr === "approved" ? "A principal will be in touch about the handover." : notes || "Ask a principal if you'd like to know why.",
      url: "/portal/equipment",
    });
  }

  return NextResponse.json({ ok: true, request: updated });
}
