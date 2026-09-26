import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { buildMembershipList, type RosterAccount } from "@/lib/roster";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * GET /api/admin/roster — the committee membership list: the SU roster
 * (`su_roster`) with each person's site account attached by name, plus accounts
 * not on the roster. Swap the roster source when the Toolbox members API lands.
 */
const PAGE_SIZE = 1000;

/** PostgREST caps each response at 1000 rows, so read a table page by page. */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return { rows, error: null };
  }
}

export async function GET() {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!can(profileOf(member), "manage_members")) {
    return NextResponse.json({ error: "Forbidden: Committee access required" }, { status: 403 });
  }

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ members: [], syncedAt: null });
    }
    const { getDevMembers } = await import("@/lib/dev-store");
    return NextResponse.json({ members: buildMembershipList([], getDevMembers()), syncedAt: null });
  }

  const supabase = getSupabaseAdmin();
  const [roster, accounts] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from("su_roster")
        .select("id, full_name, member_type, membership_tier, membership_expires_at, synced_at")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("members")
        .select(
          "id, email, full_name, membership_tier, governance_role, is_walk_leader, membership_expires_at, last_signed_in_at, governance_role_locked, walk_leader_locked",
        )
        .is("revoked_at", null)
        .order("id")
        .range(from, to),
    ),
  ]);

  const error = roster.error ?? accounts.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rosterRows = roster.rows;
  const syncedAt = rosterRows.reduce<string | null>(
    (latest, row) => (latest && latest > row.synced_at ? latest : row.synced_at),
    null,
  );

  return NextResponse.json({
    members: buildMembershipList(rosterRows, accounts.rows as RosterAccount[]),
    syncedAt,
  });
}
