import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { audit } from "@/lib/audit";
import { a1, readValues } from "@/lib/googleSheets";
import { getRealMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { identityOf } from "@/lib/walkClaims";
import { findUnlinked, syncRosterLeader } from "@/lib/walkLeaderRequests";
import { readRoster, TABS, WALK_SHEETS } from "@/lib/walkSheet";

/**
 * POST `{ wl_name: string }` — "this is me on the WL calendar", from My walks.
 *
 * For walk leaders and committee whose account isn't tied to a roster row
 * (their sign-in email isn't on it, and the app holds no calendar name for
 * them), so the calendar's walks can't be matched to them. Only a row nobody
 * has linked can be taken; their email goes on it, so the daily roster sync
 * keeps the link rather than undoing it. Audited, and a principal can undo it
 * from the roster sheet.
 */
export async function POST(request: Request) {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "This needs the database." }, { status: 503 });
  if (!can(profileOf(member), "lead_walks")) return NextResponse.json({ error: "This is for walk leaders." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { wl_name?: unknown } | null;
  if (typeof body?.wl_name !== "string" || !body.wl_name.trim()) {
    return NextResponse.json({ error: "Pick your name on the WL calendar." }, { status: 400 });
  }

  const rows = await readValues(WALK_SHEETS.leaders, a1(TABS.roster, "A1:G")).catch(() => null);
  if (!rows) return NextResponse.json({ error: "The WL roster couldn't be read. Try again." }, { status: 502 });
  const roster = readRoster(rows);

  const supabase = getSupabaseAdmin();
  const { data: me } = await supabase.from("members").select("wl_name").eq("id", member.id).maybeSingle();
  const before = (me?.wl_name as string | null | undefined) ?? null;
  if (identityOf({ email: member.email, full_name: member.full_name, wl_name: before }, roster).linked) {
    return NextResponse.json({ error: "Your account is already linked to the roster. Ask a principal to change it." }, { status: 409 });
  }

  const unlinked = roster.filter((r) => r.active && !r.email).map((r) => r.name);
  const name = findUnlinked(unlinked, body.wl_name);
  if (!name) return NextResponse.json({ error: "That name is already linked to someone, or isn't on the roster." }, { status: 409 });

  const { error } = await supabase.from("members").update({ wl_name: name }).eq("id", member.id);
  if (error) return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 500 });
  try {
    // Finds the row by the name just saved and writes their email on it.
    await syncRosterLeader(member.id, true);
  } catch {
    await supabase.from("members").update({ wl_name: before }).eq("id", member.id);
    return NextResponse.json({ error: "The WL roster couldn't be updated. Try again." }, { status: 502 });
  }

  await audit(member.id, "member.link_calendar_name", "member", member.id, { from: before, to: name });
  return NextResponse.json({ wl_name: name });
}
