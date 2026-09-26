import { NextResponse } from "next/server";
import { can, profileOf } from "@/lib/access";
import { audit } from "@/lib/audit";
import { parseAudience, type Audience } from "@/lib/clubStats";
import { notify } from "@/lib/notify";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/** A slip of the thumb shouldn't message the whole club six times. */
const PER_HOUR = 5;

async function audienceIds(audience: Audience): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  if (audience.type === "event") {
    const { data } = await supabase
      .from("event_attendees")
      .select("member_id")
      .eq("event_suu_id", audience.eventSuuId)
      .eq("removed", false)
      .not("member_id", "is", null);
    return (data ?? []).map((r) => r.member_id as string);
  }
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from("members").select("id").is("revoked_at", null).range(from, from + 999);
    if (audience.type === "tier") query = query.eq("membership_tier", audience.tier);
    if (audience.type === "leaders") query = query.or("is_walk_leader.eq.true,governance_role.not.is.null");
    const { data } = await query;
    ids.push(...(data ?? []).map((r) => r.id as string));
    if (!data || data.length < 1000) break;
  }
  return ids;
}

/** How many people a broadcast would reach, before sending. */
export async function GET(request: Request) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(profileOf(member), "manage_club")) return NextResponse.json({ error: "Committee only." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ count: 0 });
  const params = new URL(request.url).searchParams;
  const audience = parseAudience({ type: params.get("type"), tier: params.get("tier"), eventSuuId: params.get("event") });
  if (!audience) return NextResponse.json({ error: "Choose who it's for." }, { status: 400 });
  return NextResponse.json({ count: new Set(await audienceIds(audience)).size });
}

export async function POST(request: Request) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(profileOf(member), "manage_club")) return NextResponse.json({ error: "Committee only." }, { status: 403 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Broadcasts need the database." }, { status: 503 });

  let body: { audience?: unknown; title?: unknown; body?: unknown; url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send it as JSON." }, { status: 400 });
  }
  const audience = parseAudience(body.audience);
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 140) : "";
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 1000) : "";
  const url = typeof body.url === "string" && body.url.startsWith("/") && !body.url.startsWith("//") ? body.url : null;
  if (!audience) return NextResponse.json({ error: "Choose who it's for." }, { status: 400 });
  if (!title) return NextResponse.json({ error: "Give it a title." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { count } = await supabase
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_member_id", member.id)
    .eq("action", "club.broadcast")
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if ((count ?? 0) >= PER_HOUR) return NextResponse.json({ error: `That's ${PER_HOUR} broadcasts this hour. Try again later.` }, { status: 429 });

  const recipients = await audienceIds(audience);
  if (!recipients.length) return NextResponse.json({ error: "Nobody is in that audience." }, { status: 400 });
  const result = await notify(recipients, { kind: "broadcast", title, body: text || null, url });
  await audit(member.id, "club.broadcast", "audience", audience.type, { audience, title, recipients: recipients.length, ...result });
  return NextResponse.json({ ok: true, ...result });
}
