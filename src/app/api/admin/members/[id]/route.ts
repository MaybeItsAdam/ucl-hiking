import { NextResponse } from "next/server";
import { can, canChangeRole, isGovernanceRole, profileOf, type RoleChange } from "@/lib/access";
import { audit } from "@/lib/audit";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_COLUMNS = "id, full_name, email, governance_role, is_walk_leader, governance_role_locked, walk_leader_locked";

/** GET /api/admin/members/:id — what the member sheet shows beyond the roster row. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(profileOf(member), "manage_members")) {
    return NextResponse.json({ error: "Forbidden: Committee access required" }, { status: 403 });
  }
  if (!UUID.test(id) || !isSupabaseConfigured()) return NextResponse.json({ loans: [] });

  const { data, error } = await getSupabaseAdmin()
    .from("equipment_requests")
    .select("id, quantity, start_date, end_date, status, equipment:equipment_id (name)")
    .eq("member_id", id)
    .in("status", ["pending", "approved"])
    .order("start_date", { ascending: false });
  if (error) return NextResponse.json({ error: "Couldn't load this member's kit" }, { status: 500 });
  return NextResponse.json({ loans: data ?? [] });
}

function parseBody(body: Record<string, unknown>): { change: RoleChange } | { unlock: RoleChange["field"] } | null {
  if (body.unlock === "governance_role" || body.unlock === "is_walk_leader") return { unlock: body.unlock };
  if (body.field === "is_walk_leader" && typeof body.value === "boolean") {
    return { change: { field: "is_walk_leader", value: body.value } };
  }
  if (body.field === "governance_role" && (body.value === null || body.value === "committee")) {
    return { change: { field: "governance_role", value: body.value } };
  }
  return null;
}

/**
 * PATCH /api/admin/members/:id — set walk leader or a committee seat by hand,
 * or hand the column back to the sync (`{ unlock }`). Rules: `canChangeRole`.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentMember();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = body && typeof body === "object" ? parseBody(body) : null;
  if (!parsed) return NextResponse.json({ error: "Unrecognised change" }, { status: 400 });

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Membership service is not configured" }, { status: 503 });
  }
  const supabase = getSupabaseAdmin();
  const { data: target, error: loadError } = await supabase
    .from("members")
    .select(TARGET_COLUMNS)
    .eq("id", id)
    .is("revoked_at", null)
    .maybeSingle();
  if (loadError) return NextResponse.json({ error: "Couldn't load that member" }, { status: 500 });
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (target.governance_role !== null && !isGovernanceRole(target.governance_role)) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Unlocking is judged as if setting that column, so only a principal can
  // hand a committee seat back to the sync.
  const field = "change" in parsed ? parsed.change.field : parsed.unlock;
  const judged: RoleChange =
    "change" in parsed
      ? parsed.change
      : field === "is_walk_leader"
        ? { field, value: target.is_walk_leader }
        : { field: "governance_role", value: null };
  const allowed = canChangeRole(
    { id: actor.id, governanceRole: actor.governance_role },
    { id: target.id, governanceRole: target.governance_role },
    judged,
  );
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          field === "governance_role"
            ? "Only a principal can change committee seats, and never their own."
            : "Only committee can change walk leaders, and never their own.",
      },
      { status: 403 },
    );
  }

  const lockColumn = field === "governance_role" ? "governance_role_locked" : "walk_leader_locked";
  const update =
    "change" in parsed ? { [parsed.change.field]: parsed.change.value, [lockColumn]: true } : { [lockColumn]: false };

  const { data: updated, error } = await supabase
    .from("members")
    .update(update)
    .eq("id", id)
    .select(TARGET_COLUMNS)
    .single();
  if (error || !updated) return NextResponse.json({ error: "Couldn't save that change" }, { status: 500 });

  await audit(actor.id, "change" in parsed ? `member.set_${field}` : `member.unlock_${field}`, "member", id, {
    from: field === "governance_role" ? target.governance_role : target.is_walk_leader,
    to: "change" in parsed ? parsed.change.value : "sync",
  });

  return NextResponse.json({ member: updated });
}
