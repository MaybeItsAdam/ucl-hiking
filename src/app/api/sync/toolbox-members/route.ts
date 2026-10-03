import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { compareToolboxMembers, fetchToolboxMembers, mapToolboxMember, TOOLBOX_SYNC_SOURCE, type ExistingMemberForComparison } from "@/lib/toolboxMembers";

function bearerMatches(header: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authorised(request: Request) {
  if (bearerMatches(request.headers.get("authorization"))) return true;
  const member = await getCurrentMember();
  return Boolean(member && can({ membershipTier: member.membership_tier, governanceRole: member.governance_role, isWalkLeader: member.is_walk_leader }, "trigger_sync"));
}

export async function GET(request: Request) {
  if (!(await authorised(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const token = process.env.TOOLBOX_API_TOKEN;
  const organiserId = process.env.TOOLBOX_ORGANISER_ID;
  if (!token || !organiserId) return NextResponse.json({ error: "Toolbox membership sync is not configured" }, { status: 503 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const supabase = getSupabaseAdmin();
  const syncedAt = new Date().toISOString();
  let comparison: ReturnType<typeof compareToolboxMembers> | null = null;
  let received = 0;
  // Every run past this point leaves a row in member_sync_runs, failures included.
  const fail = async (error: string, status: number) => {
    await supabase.from("member_sync_runs").insert({ source: TOOLBOX_SYNC_SOURCE, received_count: received, upserted_count: 0, revoked_count: 0, comparison, error, started_at: syncedAt });
    return NextResponse.json({ error }, { status });
  };

  const snapshot = await fetchToolboxMembers();
  if (!snapshot.ok) {
    received = snapshot.received;
    return fail(snapshot.error, snapshot.status);
  }
  received = snapshot.members.length;
  const rows = snapshot.members.map(mapToolboxMember).filter((row) => row !== null);
  const skipped = snapshot.members.length - rows.length;
  const { data: activeMembers, error: comparisonError } = await supabase
    .from("members")
    .select("toolbox_user_id,email,membership_tier")
    .is("revoked_at", null);
  if (comparisonError) return fail("Current Hiking members could not be compared", 500);
  // How far the members table was from Toolbox before this run put it right.
  comparison = compareToolboxMembers(rows, (activeMembers ?? []) as ExistingMemberForComparison[]);
  // A roster with nobody linked would revoke everyone; that's a Toolbox problem, not a club with no members.
  if (rows.length === 0) return fail("No linked members; nobody was changed", 422);

  for (const row of rows) {
    const { data: byToolboxId, error: idLookupError } = await supabase
      .from("members")
      .select("id")
      .eq("toolbox_user_id", row.toolbox_user_id)
      .maybeSingle();
    if (idLookupError) return fail("Existing members could not be checked", 500);
    let existing = byToolboxId;
    if (!existing) {
      const { data: byEmail, error: emailLookupError } = await supabase
        .from("members")
        .select("id")
        .eq("email", row.email)
        .maybeSingle();
      if (emailLookupError) return fail("Existing members could not be checked", 500);
      existing = byEmail;
    }
    const values = { ...row, sync_source: TOOLBOX_SYNC_SOURCE, synced_at: syncedAt, revoked_at: null };
    const result = existing
      ? await supabase.from("members").update(values).eq("id", existing.id)
      : await supabase.from("members").insert(values);
    if (result.error) return fail("Toolbox members could not be stored", 500);
  }

  const activeIds = new Set(rows.map((row) => row.toolbox_user_id));
  const { data: owned, error: ownedError } = await supabase.from("members").select("id,toolbox_user_id").eq("sync_source", TOOLBOX_SYNC_SOURCE).is("revoked_at", null);
  if (ownedError) return fail("Members updated but stale access could not be checked", 500);
  const missing = (owned ?? []).filter((row) => !row.toolbox_user_id || !activeIds.has(row.toolbox_user_id)).map((row) => row.id);
  if (missing.length) {
    const { error } = await supabase.from("members").update({ revoked_at: syncedAt, synced_at: syncedAt }).in("id", missing);
    if (error) return fail("Members updated but stale access could not be revoked", 500);
  }
  await supabase.from("member_sync_runs").insert({ source: TOOLBOX_SYNC_SOURCE, received_count: received, upserted_count: rows.length, revoked_count: missing.length, comparison, started_at: syncedAt });
  return NextResponse.json({ ok: true, upserted: rows.length, revoked: missing.length, skipped, comparison, syncedAt });
}
