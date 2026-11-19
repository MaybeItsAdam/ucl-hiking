import { NextResponse } from "next/server";
import { canGrantAlumni } from "@/lib/access";
import { audit } from "@/lib/audit";
import { isMissingAlumni } from "@/lib/alumniStore";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT /api/admin/alumni/:id `{ value }` — give a member alumni access, or take
 * it away. Principals and admins, never for themselves (`canGrantAlumni`).
 * Granted while someone is still a member, it waits until their membership
 * lapses; from then on they can sign in to the Navigator and the photo
 * archive, and nothing else (lib/alumni).
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentMember();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (actor.is_preview || !canGrantAlumni({ id: actor.id, governanceRole: actor.governance_role }, id)) {
    return NextResponse.json({ error: "Only a principal can change alumni access, and never for themselves." }, { status: 403 });
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
  // Past members included: revoked accounts are exactly who this is for.
  const { data: target, error: loadError } = await supabase.from("members").select("id").eq("id", id).maybeSingle();
  if (loadError) return NextResponse.json({ error: "Couldn't load that member" }, { status: 500 });
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const { error } = value
    ? await supabase.from("alumni").upsert({ member_id: id, granted_by: actor.id }, { onConflict: "member_id" })
    : await supabase.from("alumni").delete().eq("member_id", id);
  if (error) {
    if (isMissingAlumni(error)) {
      return NextResponse.json({ error: "Alumni access can't be granted until the database is updated." }, { status: 503 });
    }
    return NextResponse.json({ error: "Couldn't save that change" }, { status: 500 });
  }

  await audit(actor.id, value ? "member.grant_alumni" : "member.revoke_alumni", "member", id, {});
  return NextResponse.json({ alumnus: value });
}
