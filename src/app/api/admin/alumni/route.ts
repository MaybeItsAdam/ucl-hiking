import { NextResponse } from "next/server";
import { canGrantAlumni } from "@/lib/access";
import { isCurrentMember } from "@/lib/alumni";
import { isMissingAlumni } from "@/lib/alumniStore";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

interface AccountRow {
  id: string;
  full_name: string | null;
  email: string;
  revoked_at: string | null;
  membership_expires_at: string | null;
}

const ACCOUNT_COLUMNS = "id, full_name, email, revoked_at, membership_expires_at";

/**
 * GET /api/admin/alumni[?q=name or email] — who has alumni access, and, with
 * `q`, accounts to grant it to. The search covers past members too (the
 * Members list only holds current ones), since they are who alumni are.
 * Principals and admins only.
 */
export async function GET(request: Request) {
  const actor = await getCurrentMember();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Any id but their own: this asks only whether they hold the role.
  if (actor.is_preview || !canGrantAlumni({ id: actor.id, governanceRole: actor.governance_role }, "")) {
    return NextResponse.json({ error: "Only a principal can manage alumni." }, { status: 403 });
  }
  if (!isSupabaseConfigured()) return NextResponse.json({ alumni: [], results: [], ready: false });

  const supabase = getSupabaseAdmin();
  const { data: grants, error } = await supabase.from("alumni").select("member_id, granted_at").order("granted_at", { ascending: false }).limit(1000);
  if (error) {
    if (isMissingAlumni(error)) return NextResponse.json({ alumni: [], results: [], ready: false });
    return NextResponse.json({ error: "Couldn't load alumni." }, { status: 500 });
  }
  const grantedAt = new Map((grants ?? []).map((g) => [g.member_id as string, g.granted_at as string]));
  const now = new Date();
  const view = (row: AccountRow) => ({
    id: row.id,
    full_name: row.full_name || row.email.split("@")[0],
    email: row.email,
    current: isCurrentMember(row, now),
    alumnus: grantedAt.has(row.id),
    granted_at: grantedAt.get(row.id) ?? null,
  });

  let alumni: ReturnType<typeof view>[] = [];
  if (grantedAt.size) {
    const { data } = await supabase.from("members").select(ACCOUNT_COLUMNS).in("id", [...grantedAt.keys()]);
    alumni = ((data ?? []) as AccountRow[]).map(view).sort((a, b) => a.full_name.localeCompare(b.full_name, "en-GB"));
  }

  // PostgREST filter syntax is built from this string, so keep only what a name or an email contains.
  const q = (new URL(request.url).searchParams.get("q") ?? "").replace(/[^\p{L}\p{M}\p{N}\s'@._-]/gu, "").trim().slice(0, 80);
  let results: ReturnType<typeof view>[] = [];
  if (q.length >= 2) {
    const { data } = await supabase
      .from("members")
      .select(ACCOUNT_COLUMNS)
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
      .order("full_name")
      .limit(15);
    results = ((data ?? []) as AccountRow[]).map(view);
  }

  return NextResponse.json({ alumni, results, ready: true });
}
