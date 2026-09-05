import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isGovernanceRole, isMembershipTier } from "@/lib/access";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

interface SyncMember {
  email?: unknown;
  fullName?: unknown;
  membershipTier?: unknown;
  governanceRole?: unknown;
  isWalkLeader?: unknown;
  membershipExpiresAt?: unknown;
  sourceReference?: unknown;
}

function secretMatches(provided: string | null): boolean {
  const expected = process.env.MEMBER_SYNC_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-member-sync-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Membership service is not configured" }, { status: 503 });
  }

  let payload: { source?: unknown; members?: SyncMember[]; fullSnapshot?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(payload.members) || payload.members.length > 5_000) {
    return NextResponse.json({ error: "members must be an array of at most 5,000 rows" }, { status: 400 });
  }
  const source = typeof payload.source === "string" ? payload.source.slice(0, 100) : "gcp-job";
  const now = new Date().toISOString();
  const rows = payload.members.map((row) => ({
    email: typeof row.email === "string" ? row.email.trim().toLowerCase() : "",
    full_name: typeof row.fullName === "string" ? row.fullName.trim() || null : null,
    membership_tier: row.membershipTier,
    governance_role: row.governanceRole ?? null,
    is_walk_leader: row.isWalkLeader === true,
    membership_expires_at:
      typeof row.membershipExpiresAt === "string" ? row.membershipExpiresAt : null,
    source_reference: typeof row.sourceReference === "string" ? row.sourceReference : null,
    sync_source: source,
    synced_at: now,
    revoked_at: null,
  }));

  const invalid = rows.find(
    (row) =>
      !row.email.includes("@") ||
      !isMembershipTier(row.membership_tier) ||
      (row.governance_role !== null && !isGovernanceRole(row.governance_role)),
  );
  if (invalid) {
    return NextResponse.json(
      { error: "Every row needs a valid email, membershipTier and optional governanceRole" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const startedAt = new Date().toISOString();
  const { error } = await supabase.from("members").upsert(rows, { onConflict: "email" });
  if (error) {
    return NextResponse.json({ error: "Member sync failed" }, { status: 500 });
  }

  let revokedCount = 0;
  if (payload.fullSnapshot === true && rows.length > 0) {
    const activeEmails = new Set(rows.map((row) => row.email));
    const { data: existing } = await supabase
      .from("members")
      .select("id,email")
      .eq("sync_source", source)
      .is("revoked_at", null);
    const missingIds = (existing || [])
      .filter((member) => !activeEmails.has(String(member.email).toLowerCase()))
      .map((member) => member.id);
    if (missingIds.length) {
      const { error: revokeError } = await supabase
        .from("members")
        .update({ revoked_at: now })
        .in("id", missingIds);
      if (revokeError) {
        return NextResponse.json({ error: "Members updated but stale access could not be revoked" }, { status: 500 });
      }
      revokedCount = missingIds.length;
    }
  }

  await supabase.from("member_sync_runs").insert({
    source,
    received_count: rows.length,
    upserted_count: rows.length,
    revoked_count: revokedCount,
    started_at: startedAt,
  });

  return NextResponse.json({ ok: true, upserted: rows.length, revoked: revokedCount, syncedAt: now });
}
