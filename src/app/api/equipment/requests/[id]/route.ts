import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";
import { can, profileOf, type GovernanceRole } from "@/lib/access";
import {
  canTransitionRequest,
  mayHold,
  parseBookingInput,
  restrictionError,
  type BookingInput,
  type RequestTransition,
} from "@/lib/kitCustody";
import { canHandleKit } from "@/lib/kitHandlers";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

const TRANSITIONS: RequestTransition[] = ["booked", "approved", "rejected", "returned", "cancelled"];

const pickupTime = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

/**
 * Move a loan along (see lib/kitCustody):
 * - `booked`, with pickupAt / pickupLocation / pickupWithId: a kit handler
 *   arranges to meet the member (or moves the meeting).
 * - `approved`: handed over. Scanning a tagged item does this by itself; this
 *   is for untagged kit.
 * - `rejected`, `returned`: kit handlers. `cancelled`: the member while it
 *   isn't out yet, a kit handler likewise, a principal at any point.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isPrincipal = can(profileOf(member), "review_equipment_requests");
  const isHandler = isPrincipal || (await canHandleKit(member));

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const statusStr = String(body.status || "");
  const notes = typeof body.notes === "string" ? body.notes.trim() : null;

  if (!(TRANSITIONS as string[]).includes(statusStr)) {
    return NextResponse.json({ error: "Invalid request status" }, { status: 400 });
  }
  const target = statusStr as RequestTransition;

  let booking: BookingInput | null = null;
  if (target === "booked") {
    const parsed = parseBookingInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    booking = { ...parsed.input, pickupWithId: parsed.input.pickupWithId ?? member.id };
  }

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { updateDevEquipmentRequestStatus } = await import("@/lib/dev-store");
      const updated = updateDevEquipmentRequestStatus(
        id,
        target,
        notes || undefined,
        member.id,
        booking
          ? { pickup_at: booking.pickupAt, pickup_location: booking.pickupLocation, pickup_with_member_id: booking.pickupWithId }
          : {},
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
    .select("*, equipment:equipment_id(*), member:member_id(id, full_name, governance_role)")
    .eq("id", id)
    .single();

  if (fetchError || !req) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const isOwner = req.member_id === member.id;

  if (!isOwner && !isHandler) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canTransitionRequest(req.status, target, { isOwner, isHandler, isPrincipal })) {
    if (req.status === "approved" && target === "cancelled" && !isPrincipal) {
      return NextResponse.json(
        { error: "This kit is already out. Give it back to a committee member, who will check it in." },
        { status: 403 },
      );
    }
    if (!isHandler) {
      return NextResponse.json({ error: "Only the committee can book, hand over or take back kit." }, { status: 403 });
    }
    return NextResponse.json({ error: `A ${req.status} request can't be marked ${target}.` }, { status: 409 });
  }

  const now = new Date().toISOString();
  const eqItem = req.equipment;

  // Booking or handing over is what gives the member the kit: restricted kit
  // only for the roles it's restricted to.
  if ((target === "booked" || target === "approved") && !mayHold(eqItem?.restricted_to, req.member?.governance_role as GovernanceRole | null)) {
    return NextResponse.json(
      { error: restrictionError(eqItem?.name ?? "This kit", eqItem?.restricted_to, req.member?.full_name ?? "this member") },
      { status: 403 },
    );
  }

  // Stock is taken when a loan is first booked (or handed over without one).
  const takesStock = (target === "booked" || target === "approved") && req.status === "pending";
  if (takesStock && eqItem.available_quantity < req.quantity) {
    return NextResponse.json(
      { error: `Not enough in storage to book this. Available: ${eqItem.available_quantity}, requested: ${req.quantity}` },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {
    status: target,
    notes: notes || req.notes,
    updated_at: now,
  };

  if (isHandler) {
    updates.reviewed_by = member.id;
    updates.reviewed_at = now;
  }
  if (booking) {
    updates.pickup_at = booking.pickupAt;
    updates.pickup_location = booking.pickupLocation;
    updates.pickup_with_member_id = booking.pickupWithId;
    updates.booked_by = member.id;
    updates.booked_at = now;
  }

  // Only if nobody else changed it since we read it, so two clicks can't count
  // the same loan out twice. Stock moves in the database with the status change
  // (trigger equipment_requests_move_stock), so concurrent bookings can't over-lend.
  const { data: updated, error: updateError } = await supabase
    .from("equipment_requests")
    .update(updates)
    .eq("id", id)
    .eq("status", req.status)
    .eq("updated_at", req.updated_at)
    .select(
      `*, equipment:equipment_id(*), member:member_id(id, email, full_name), pickup_with:pickup_with_member_id(id, full_name)`,
    )
    .maybeSingle();

  if (updateError) {
    if (updateError.message?.includes("insufficient_stock")) {
      return NextResponse.json(
        { error: "Not enough of this kit left to book. Another loan was booked first; refresh to see current stock." },
        { status: 409 },
      );
    }
    // equipment_requests_open_has_borrower: the member deleted their account meanwhile.
    if (updateError.code === "23514") {
      return NextResponse.json({ error: "That member has deleted their account, so the request is closed." }, { status: 409 });
    }
    // pickup_with_member_id: no such member.
    if (updateError.code === "23503") {
      return NextResponse.json({ error: "The member they're meeting wasn't found." }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update request" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "This request was changed by someone else. Refresh and try again." }, { status: 409 });
  }

  await supabase.from("audit_log").insert({
    actor_member_id: member.id,
    action: `equipment_request_${target}`,
    target_type: "equipment_requests",
    target_id: id,
    metadata: {
      from_status: req.status,
      new_status: target,
      notes,
      ...(booking ? { pickup_at: booking.pickupAt, pickup_location: booking.pickupLocation, pickup_with: booking.pickupWithId } : {}),
    },
  });

  // The borrower hears about bookings and declines; their own actions need no telling.
  if ((target === "booked" || target === "rejected") && !isOwner && req.member_id) {
    const what = `${req.quantity > 1 ? `${req.quantity} × ` : ""}${eqItem.name}`;
    const withName = (updated as { pickup_with?: { full_name: string | null } | null }).pickup_with?.full_name;
    await notify([req.member_id], {
      kind: "kit",
      title: target === "booked" ? `Pickup booked: ${what}` : `Declined: ${what}`,
      body:
        target === "booked" && booking
          ? `${pickupTime.format(new Date(booking.pickupAt))}${booking.pickupLocation ? ` at ${booking.pickupLocation}` : ""}` +
            `${withName ? `, with ${withName}` : ""}.`
          : notes || "Ask a committee member if you'd like to know why.",
      url: "/portal/equipment",
    });
  }
  // Whoever they're meeting, if it isn't the person who booked it.
  if (booking && booking.pickupWithId !== member.id) {
    await notify([booking.pickupWithId!], {
      kind: "kit",
      title: `Kit pickup: ${req.member?.full_name ?? "a member"}`,
      body: `${pickupTime.format(new Date(booking.pickupAt))}${booking.pickupLocation ? ` at ${booking.pickupLocation}` : ""}: hand over ${eqItem.name}.`,
      url: "/portal/equipment",
    });
  }

  return NextResponse.json({ ok: true, request: updated });
}
