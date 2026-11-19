import { NextResponse } from "next/server";
import { canGrantKitHandler } from "@/lib/access";
import { audit } from "@/lib/audit";
import { isMissingKitHandlers } from "@/lib/kitHandlers";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT /api/admin/members/:id/kit-handler `{ value }` — let a member scan
 * tagged kit, or stop them. Principals and admins, never for themselves
 * (`canGrantKitHandler`). Committee can already scan by role; this is for
 * anyone else.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentMember();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (actor.is_preview || !canGrantKitHandler({ id: actor.id, governanceRole: actor.governance_role }, id)) {
    return NextResponse.json({ error: "Only a principal can change who scans kit, and never for themselves." }, { status: 403 });
  }

  let value: unknown;
  try {
    value = ((await request.json()) as { value?: unknown })?.value;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof value !== "boolean") return NextResponse.json({ error: "Unrecognised change" }, { status: 400 });
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Membership service is not configured" }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();
  const { data: target, error: loadError } = await supabase
    .from("members")
    .select("id")
    .eq("id", id)
    .is("revoked_at", null)
    .maybeSingle();
  if (loadError) return NextResponse.json({ error: "Couldn't load that member" }, { status: 500 });
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const { error } = value
    ? await supabase.from("kit_handlers").upsert({ member_id: id, granted_by: actor.id }, { onConflict: "member_id" })
    : await supabase.from("kit_handlers").delete().eq("member_id", id);
  if (error) {
    if (isMissingKitHandlers(error)) {
      return NextResponse.json({ error: "Kit scanning can't be granted until the database is updated." }, { status: 503 });
    }
    return NextResponse.json({ error: "Couldn't save that change" }, { status: 500 });
  }

  await audit(actor.id, value ? "member.grant_kit_handler" : "member.revoke_kit_handler", "member", id, {});
  return NextResponse.json({ kitHandler: value });
}
