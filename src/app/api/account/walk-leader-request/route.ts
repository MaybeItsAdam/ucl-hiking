import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { getRealMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { findUnlinked, REQUEST_COLUMNS, unlinkedRosterNames, type WalkLeaderRequest } from "@/lib/walkLeaderRequests";

// getRealMember, not getCurrentMember: an admin previewing another role is
// still themselves, and asks (or doesn't) as themselves.

function unavailable() {
  return NextResponse.json({ error: "Requests need the database." }, { status: 503 });
}

async function latestRequest(memberId: string): Promise<WalkLeaderRequest | null> {
  const { data } = await getSupabaseAdmin()
    .from("walk_leader_requests")
    .select(REQUEST_COLUMNS)
    .eq("member_id", memberId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as WalkLeaderRequest | null) ?? null;
}

/** GET — the member's latest request, and the calendar names they can pick from. */
export async function GET() {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured()) return unavailable();
  const [request, names] = await Promise.all([latestRequest(member.id), unlinkedRosterNames().catch(() => null)]);
  return NextResponse.json({ request, names });
}

/** POST `{ wl_name: string | null, note?: string }` — ask the committee for walk leader access. */
export async function POST(request: Request) {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured()) return unavailable();
  if (member.is_walk_leader || member.governance_role !== null) {
    return NextResponse.json({ error: "You already have walk leader access." }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as { wl_name?: unknown; note?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Send it as JSON." }, { status: 400 });

  let wlName: string | null = null;
  if (typeof body.wl_name === "string" && body.wl_name.trim()) {
    const names = await unlinkedRosterNames().catch(() => null);
    if (!names) return NextResponse.json({ error: "The WL roster couldn't be read. Try again." }, { status: 502 });
    wlName = findUnlinked(names, body.wl_name);
    if (!wlName) return NextResponse.json({ error: "That name is already linked to someone, or isn't on the roster." }, { status: 409 });
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("walk_leader_requests")
    .insert({ member_id: member.id, wl_name: wlName, note })
    .select(REQUEST_COLUMNS)
    .single();
  if (error?.code === "23505") return NextResponse.json({ error: "You've already asked. The committee will get back to you." }, { status: 409 });
  if (error || !data) return NextResponse.json({ error: "Your request wasn't sent. Try again." }, { status: 500 });

  await audit(member.id, "walk_leader_request.create", "walk_leader_request", data.id, { wl_name: wlName });
  const { data: committee } = await supabase.from("members").select("id").not("governance_role", "is", null).is("revoked_at", null);
  await notify(
    (committee ?? []).map((m) => m.id as string),
    {
      kind: "leader",
      title: `${member.full_name || member.email} asked for walk leader access`,
      body: wlName ? `They say they're "${wlName}" on the WL calendar.` : "They aren't on the WL calendar yet.",
      url: "/portal/members",
    },
  );
  return NextResponse.json({ request: data });
}

/** DELETE — withdraw a pending request. */
export async function DELETE() {
  const member = await getRealMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isSupabaseConfigured()) return unavailable();
  const { data, error } = await getSupabaseAdmin()
    .from("walk_leader_requests")
    .update({ status: "withdrawn", decided_at: new Date().toISOString() })
    .eq("member_id", member.id)
    .eq("status", "pending")
    .select("id");
  if (error) return NextResponse.json({ error: "Couldn't withdraw it. Try again." }, { status: 500 });
  for (const row of data ?? []) await audit(member.id, "walk_leader_request.withdraw", "walk_leader_request", row.id as string);
  return NextResponse.json({ request: await latestRequest(member.id) });
}
