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

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("equipment")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch equipment catalog" }, { status: 500 });
  }

  return NextResponse.json({ equipment: data || [] });
}

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (
    !member ||
    !can(
      {
        membershipTier: member.membership_tier,
        governanceRole: member.governance_role,
        isWalkLeader: member.is_walk_leader,
      },
      "manage_equipment",
    )
  ) {
    return NextResponse.json({ error: "Forbidden: Committee access required" }, { status: 403 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: {
    id?: unknown;
    name?: unknown;
    category?: unknown;
    description?: unknown;
    totalQuantity?: unknown;
    availableQuantity?: unknown;
    condition?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "General";
  const description = typeof body.description === "string" ? body.description.trim() : null;
  const totalQty = typeof body.totalQuantity === "number" && body.totalQuantity >= 0 ? Math.floor(body.totalQuantity) : 1;
  const availQty = typeof body.availableQuantity === "number" && body.availableQuantity >= 0 ? Math.floor(body.availableQuantity) : totalQty;
  const conditionStr = String(body.condition || "good");
  const condition = ["excellent", "good", "fair", "needs_repair"].includes(conditionStr) ? conditionStr : "good";

  if (!name) {
    return NextResponse.json({ error: "Equipment name is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  if (typeof body.id === "string" && body.id) {
    const { data, error } = await supabase
      .from("equipment")
      .update({
        name,
        category,
        description,
        total_quantity: totalQty,
        available_quantity: Math.min(availQty, totalQty),
        condition,
        updated_at: now,
      })
      .eq("id", body.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to update equipment item" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, equipment: data });
  }

  const { data, error } = await supabase
    .from("equipment")
    .insert({
      name,
      category,
      description,
      total_quantity: totalQty,
      available_quantity: Math.min(availQty, totalQty),
      condition,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create equipment item" }, { status: 500 });
  }

  await supabase.from("audit_log").insert({
    actor_member_id: member.id,
    action: "create_equipment",
    target_type: "equipment",
    target_id: data.id,
    metadata: { name, category, total_quantity: totalQty },
  });

  return NextResponse.json({ ok: true, equipment: data });
}
