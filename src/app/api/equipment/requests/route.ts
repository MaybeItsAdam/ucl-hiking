import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export async function GET() {
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
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("equipment_requests")
    .select(`
      *,
      equipment:equipment_id(*),
      member:member_id(id, email, full_name, membership_tier)
    `)
    .order("created_at", { ascending: false });

  if (!isCommittee) {
    query = query.eq("member_id", member.id);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Failed to fetch equipment requests" }, { status: 500 });
  }

  return NextResponse.json({ requests: data || [] });
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

  if (!can(profile, "request_equipment")) {
    return NextResponse.json(
      { error: "Taster members cannot file borrowing requests. Standard or Explorer membership required." },
      { status: 403 },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: {
    equipmentId?: unknown;
    quantity?: unknown;
    startDate?: unknown;
    endDate?: unknown;
    purpose?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const equipmentId = typeof body.equipmentId === "string" ? body.equipmentId.trim() : "";
  const quantity = typeof body.quantity === "number" && body.quantity > 0 ? Math.floor(body.quantity) : 1;
  const startDate = typeof body.startDate === "string" ? body.startDate.trim() : "";
  const endDate = typeof body.endDate === "string" ? body.endDate.trim() : "";
  const purpose = typeof body.purpose === "string" ? body.purpose.trim() : "";

  if (!equipmentId || !startDate || !endDate || !purpose) {
    return NextResponse.json(
      { error: "Equipment item, start date, end date, and borrowing purpose are required" },
      { status: 400 },
    );
  }

  if (new Date(endDate) < new Date(startDate)) {
    return NextResponse.json({ error: "End date must be on or after start date" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: item, error: itemError } = await supabase
    .from("equipment")
    .select("id, name, available_quantity")
    .eq("id", equipmentId)
    .single();

  if (itemError || !item) {
    return NextResponse.json({ error: "Equipment item not found" }, { status: 404 });
  }

  if (item.available_quantity < quantity) {
    return NextResponse.json(
      { error: `Requested quantity (${quantity}) exceeds currently available stock (${item.available_quantity})` },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("equipment_requests")
    .insert({
      member_id: member.id,
      equipment_id: equipmentId,
      quantity,
      start_date: startDate,
      end_date: endDate,
      purpose,
      status: "pending",
    })
    .select(`*, equipment:equipment_id(*)`)
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to submit equipment borrow request" }, { status: 500 });
  }

  await supabase.from("audit_log").insert({
    actor_member_id: member.id,
    action: "create_equipment_request",
    target_type: "equipment_requests",
    target_id: data.id,
    metadata: { equipment_id: equipmentId, quantity, start_date: startDate, end_date: endDate },
  });

  return NextResponse.json({ ok: true, request: data });
}
