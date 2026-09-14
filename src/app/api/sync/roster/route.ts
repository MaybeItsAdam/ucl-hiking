import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { matchRosterByName, ROSTER_SYNC_SOURCE, tierFromMembershipType, type RosterEntry } from "@/lib/roster";

/**
 * TEMPORARY. POST /api/sync/roster — the daily SU roster from `hiking-roster-sync`.
 *
 * Stores the snapshot in `su_roster` (which sign-in matches names against), then
 * brings every member who got in by name match (`sync_source = 'suu-roster'`) in
 * line with it: tier and expiry updated, anyone no longer on the roster revoked.
 * Members from any other source are never touched here.
 *
 * Retire with the job; see supabase/migrations/20260914000000_su_roster.sql.
 */

interface IncomingRow {
  fullName?: unknown;
  memberType?: unknown;
  membershipType?: unknown;
  membershipExpiresAt?: unknown;
}

function secretMatches(provided: string | null): boolean {
  const expected = process.env.MEMBER_SYNC_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-member-sync-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Membership service is not configured" }, { status: 503 });
  }

  let payload: { members?: IncomingRow[] };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(payload.members) || payload.members.length > 2_000) {
    return NextResponse.json({ error: "members must be an array of at most 2,000 rows" }, { status: 400 });
  }

  const syncedAt = new Date().toISOString();
  const skippedTypes: Record<string, number> = {};
  const roster = payload.members.flatMap((row) => {
    const fullName = text(row.fullName, 200);
    const tier = tierFromMembershipType(text(row.membershipType, 100));
    if (!fullName || !tier) {
      const key = text(row.membershipType, 100) ?? "(none)";
      skippedTypes[key] = (skippedTypes[key] ?? 0) + 1;
      return [];
    }
    const expires = text(row.membershipExpiresAt, 40);
    return [{
      full_name: fullName,
      member_type: text(row.memberType, 100),
      membership_tier: tier,
      membership_expires_at: expires && !Number.isNaN(Date.parse(expires)) ? new Date(expires).toISOString() : null,
      synced_at: syncedAt,
    }];
  });

  // An SU page that failed to render parses as nobody; never let that revoke the club.
  if (roster.length === 0) {
    return NextResponse.json({ error: "No usable roster rows; nothing changed", skippedTypes }, { status: 422 });
  }

  const supabase = getSupabaseAdmin();
  // Insert the new snapshot before deleting the old one, so sign-in never sees an empty roster.
  const { error: insertError } = await supabase.from("su_roster").insert(roster);
  if (insertError) {
    return NextResponse.json({ error: "Roster could not be stored" }, { status: 500 });
  }
  const { error: pruneError } = await supabase.from("su_roster").delete().lt("synced_at", syncedAt);
  if (pruneError) {
    return NextResponse.json({ error: "Roster stored but the previous snapshot could not be removed" }, { status: 500 });
  }

  const { data: linked, error: linkedError } = await supabase
    .from("members")
    .select("id,full_name,membership_tier,membership_expires_at,revoked_at")
    .eq("sync_source", ROSTER_SYNC_SOURCE);
  if (linkedError) {
    return NextResponse.json({ error: "Roster stored but members could not be reconciled" }, { status: 500 });
  }

  let updated = 0;
  let revoked = 0;
  for (const member of linked ?? []) {
    const match = matchRosterByName(roster as RosterEntry[], member.full_name);
    const change = match
      ? {
          membership_tier: match.membership_tier,
          membership_expires_at: match.membership_expires_at,
          revoked_at: null,
        }
      : { revoked_at: member.revoked_at ?? syncedAt };
    const unchanged = match
      ? member.membership_tier === match.membership_tier &&
        member.membership_expires_at === match.membership_expires_at &&
        member.revoked_at === null
      : member.revoked_at !== null;
    if (unchanged) continue;

    const { error } = await supabase
      .from("members")
      .update({ ...change, synced_at: syncedAt })
      .eq("id", member.id);
    if (error) {
      return NextResponse.json({ error: "Roster stored but members could not be reconciled" }, { status: 500 });
    }
    if (match) updated += 1;
    else revoked += 1;
  }

  await supabase.from("member_sync_runs").insert({
    source: ROSTER_SYNC_SOURCE,
    received_count: payload.members.length,
    upserted_count: updated,
    revoked_count: revoked,
    started_at: syncedAt,
  });

  return NextResponse.json({ ok: true, rosterRows: roster.length, skippedTypes, updated, revoked, syncedAt });
}
