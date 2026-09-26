import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { can, canUseKit, profileOf } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

function secretMatches(provided: string | null): boolean {
  const expected = process.env.MEMBER_SYNC_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const isSync = secretMatches(request.headers.get("x-member-sync-secret"));
  if (!isSync) {
    const member = await getCurrentMember();
    if (!member) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canUseKit(profileOf(member))) {
      return NextResponse.json({ error: "Kit is for Explorer members and committee" }, { status: 403 });
    }
  }

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { getDevEquipment } = await import("@/lib/dev-store");
      return NextResponse.json({ equipment: getDevEquipment() });
    }
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

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { addDevEquipment, updateDevEquipment } = await import("@/lib/dev-store");
      if (typeof body.id === "string" && body.id) {
        const item = updateDevEquipment(body.id, {
          name,
          category,
          description,
          total_quantity: totalQty,
          available_quantity: Math.min(availQty, totalQty),
          condition: condition as "excellent" | "good" | "fair" | "needs_repair",
        });
        return NextResponse.json({ ok: true, equipment: item });
      } else {
        const item = addDevEquipment({
          name,
          category,
          description,
          total_quantity: totalQty,
          available_quantity: Math.min(availQty, totalQty),
          condition: condition as "excellent" | "good" | "fair" | "needs_repair",
        });
        return NextResponse.json({ ok: true, equipment: item });
      }
    }
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
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

export async function DELETE(request: Request) {
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

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "Equipment ID is required" }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      const { deleteDevEquipment } = await import("@/lib/dev-store");
      const deleted = deleteDevEquipment(id);
      if (!deleted) {
        return NextResponse.json({ error: "Equipment item not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("equipment").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: "Failed to delete equipment item" }, { status: 500 });
  }

  await supabase.from("audit_log").insert({
    actor_member_id: member.id,
    action: "delete_equipment",
    target_type: "equipment",
    target_id: id,
  });

  return NextResponse.json({ ok: true });
}

