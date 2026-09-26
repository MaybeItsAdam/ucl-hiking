import { NextResponse } from "next/server";
import { getAttendees } from "@/lib/attendees";
import { audit } from "@/lib/audit";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { loadDayContext } from "@/lib/walkDay";

type Params = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Add someone to the register: a member from the roster, or just a name for a walk-up. */
export async function POST(request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const loaded = await loadDayContext((await params).id, member);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "The register needs the database." }, { status: 503 });

  let body: { member_id?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the person as JSON." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const eventSuuId = loaded.ctx.event.suu_event_id;
  let row: { event_suu_id: string; member_id: string | null; name: string; email: string | null; source: "leader" };

  if (typeof body.member_id === "string" && UUID.test(body.member_id)) {
    const { data: person } = await supabase
      .from("members")
      .select("id, email, full_name")
      .eq("id", body.member_id)
      .is("revoked_at", null)
      .maybeSingle();
    if (!person) return NextResponse.json({ error: "That member wasn't found." }, { status: 404 });
    const existing = (await getAttendees(eventSuuId)).find(
      (a) => a.member_id === person.id || (a.email && a.email.toLowerCase() === person.email.toLowerCase()),
    );
    if (existing) {
      if (existing.removed) await supabase.from("event_attendees").update({ removed: false }).eq("id", existing.id);
      return NextResponse.json({ ok: true, attendees: await getAttendees(eventSuuId) });
    }
    row = { event_suu_id: eventSuuId, member_id: person.id, name: person.full_name || person.email, email: person.email, source: "leader" };
  } else {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    if (!name) return NextResponse.json({ error: "Give a name." }, { status: 400 });
    row = { event_suu_id: eventSuuId, member_id: null, name, email: null, source: "leader" };
  }

  const { error } = await supabase.from("event_attendees").insert(row);
  if (error) return NextResponse.json({ error: "They weren't added. Try again." }, { status: 500 });
  await audit(member.id, "walk.attendee_added", "event", eventSuuId, { member: row.member_id, name: row.member_id ? undefined : row.name });
  return NextResponse.json({ ok: true, attendees: await getAttendees(eventSuuId) });
}

/** Take someone off the register. Ticket holders are hidden, not deleted, so the sync doesn't re-add them. */
export async function DELETE(request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const loaded = await loadDayContext((await params).id, member);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "The register needs the database." }, { status: 503 });

  const attendeeId = new URL(request.url).searchParams.get("attendee") ?? "";
  const eventSuuId = loaded.ctx.event.suu_event_id;
  const target = (await getAttendees(eventSuuId)).find((a) => a.id === attendeeId);
  if (!target) return NextResponse.json({ error: "They're not on this register." }, { status: 404 });

  const supabase = getSupabaseAdmin();
  const { error } =
    target.source === "leader"
      ? await supabase.from("event_attendees").delete().eq("id", target.id)
      : await supabase.from("event_attendees").update({ removed: true, checked_in_at: null }).eq("id", target.id);
  if (error) return NextResponse.json({ error: "They weren't removed. Try again." }, { status: 500 });
  await audit(member.id, "walk.attendee_removed", "event", eventSuuId, { attendee: target.id });
  return NextResponse.json({ ok: true, attendees: await getAttendees(eventSuuId) });
}
