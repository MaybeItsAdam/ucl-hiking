import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { buildMembershipList, type RosterAccount } from "@/lib/roster";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { fetchToolboxMembers, rosterFromToolbox } from "@/lib/toolboxMembers";

/**
 * GET /api/admin/roster — the committee membership list: Toolbox's SU roster
 * with each person's site account attached, plus accounts not on the roster.
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
  const [snapshot, accounts] = await Promise.all([
    fetchToolboxMembers(),
    fetchAll((from, to) =>
      supabase
        .from("members")
        .select(
          "id, email, full_name, toolbox_user_id, membership_tier, governance_role, is_walk_leader, membership_expires_at, last_signed_in_at, governance_role_locked, walk_leader_locked",
        )
        .is("revoked_at", null)
        .order("id")
        .range(from, to),
    ),
  ]);

  if (accounts.error) {
    return NextResponse.json({ error: accounts.error.message }, { status: 500 });
  }
  if (!snapshot.ok) {
    return NextResponse.json({ error: `Couldn't load the SU roster from Toolbox: ${snapshot.error}` }, { status: 502 });
  }

  return NextResponse.json({
    members: buildMembershipList(rosterFromToolbox(snapshot.members), accounts.rows as RosterAccount[]),
    syncedAt: snapshot.syncedAt,
  });
}
