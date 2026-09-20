import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { can } from "@/lib/access";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { compareToolboxMembers, mapToolboxMember, type ExistingMemberForComparison, type ToolboxMembersResponse } from "@/lib/toolboxMembers";

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

  const base = (process.env.TOOLBOX_URL || "https://www.adamscampustoolbox.org.uk").replace(/\/$/, "");
  let payload: ToolboxMembersResponse;
  try {
    const response = await fetch(`${base}/api/v1/organisers/${encodeURIComponent(organiserId)}/members`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return NextResponse.json({ error: `Toolbox members API returned ${response.status}` }, { status: 502 });
    payload = await response.json() as ToolboxMembersResponse;
  } catch {
    return NextResponse.json({ error: "Toolbox members API is unavailable" }, { status: 502 });
  }
  if (!payload.snapshot?.complete || !Array.isArray(payload.members) || payload.members.length === 0) {
    return NextResponse.json({ error: "Toolbox returned no complete member snapshot; nobody was changed" }, { status: 502 });
  }
  const age = Date.now() - Date.parse(payload.snapshot.syncedAt);
  if (!Number.isFinite(age) || age > 72 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "Toolbox member snapshot is older than 72 hours; nobody was changed" }, { status: 409 });
  }
  const rows = payload.members.map(mapToolboxMember).filter((row) => row !== null);
  const skipped = payload.members.length - rows.length;
  const supabase = getSupabaseAdmin();
  const { data: activeMembers, error: comparisonError } = await supabase
    .from("members")
    .select("toolbox_user_id,email,membership_tier")
    .is("revoked_at", null);
  if (comparisonError) return NextResponse.json({ error: "Current Hiking members could not be compared" }, { status: 500 });
  const comparison = compareToolboxMembers(rows, (activeMembers ?? []) as ExistingMemberForComparison[]);
  const authoritative = process.env.TOOLBOX_MEMBERS_AUTHORITATIVE === "true";
  if (!authoritative) return NextResponse.json({ ok: true, mode: "shadow", snapshot: payload.snapshot, skipped, comparison });
  if (rows.length === 0) return NextResponse.json({ error: "No linked members; nobody was changed" }, { status: 422 });

  const syncedAt = new Date().toISOString();
  for (const row of rows) {
    const { data: byToolboxId, error: idLookupError } = await supabase
      .from("members")
      .select("id")
      .eq("toolbox_user_id", row.toolbox_user_id)
      .maybeSingle();
    if (idLookupError) return NextResponse.json({ error: "Existing members could not be checked" }, { status: 500 });
    let existing = byToolboxId;
    if (!existing) {
      const { data: byEmail, error: emailLookupError } = await supabase
        .from("members")
        .select("id")
        .eq("email", row.email)
        .maybeSingle();
      if (emailLookupError) return NextResponse.json({ error: "Existing members could not be checked" }, { status: 500 });
      existing = byEmail;
    }
    const values = { ...row, sync_source: "toolbox-members", synced_at: syncedAt, revoked_at: null };
    const result = existing
      ? await supabase.from("members").update(values).eq("id", existing.id)
      : await supabase.from("members").insert(values);
    if (result.error) return NextResponse.json({ error: "Toolbox members could not be stored" }, { status: 500 });
  }

  const activeIds = new Set(rows.map((row) => row.toolbox_user_id));
  const { data: owned, error: ownedError } = await supabase.from("members").select("id,toolbox_user_id").eq("sync_source", "toolbox-members").is("revoked_at", null);
  if (ownedError) return NextResponse.json({ error: "Members updated but stale access could not be checked" }, { status: 500 });
  const missing = (owned ?? []).filter((row) => row.toolbox_user_id && !activeIds.has(row.toolbox_user_id)).map((row) => row.id);
  if (missing.length) {
    const { error } = await supabase.from("members").update({ revoked_at: syncedAt, synced_at: syncedAt }).in("id", missing);
    if (error) return NextResponse.json({ error: "Members updated but stale access could not be revoked" }, { status: 500 });
  }
  await supabase.from("member_sync_runs").insert({ source: "toolbox-members", received_count: payload.members.length, upserted_count: rows.length, revoked_count: missing.length, started_at: syncedAt });
  return NextResponse.json({ ok: true, mode: "authoritative", upserted: rows.length, revoked: missing.length, skipped, comparison, syncedAt });
}
