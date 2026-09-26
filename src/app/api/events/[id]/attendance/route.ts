import { NextResponse } from "next/server";
import { collapseOps, getAttendees, parseAttendanceOps } from "@/lib/attendees";
import { audit } from "@/lib/audit";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { loadDayContext } from "@/lib/walkDay";

type Params = { params: Promise<{ id: string }> };

/**
 * Replay the day-of page's queue of check-ins. The page may have been offline
 * all morning, so this takes a batch and is safe to send twice: each person
 * ends up in the state of their last tap.
 */
export async function POST(request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const loaded = await loadDayContext((await params).id, member);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "The register needs the database." }, { status: 503 });

  let body: { ops?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the changes as JSON." }, { status: 400 });
  }
  const ops = parseAttendanceOps(body.ops);
  if (!ops) return NextResponse.json({ error: "Those changes aren't in a form the register understands." }, { status: 400 });

  const eventSuuId = loaded.ctx.event.suu_event_id;
  const known = new Set((await getAttendees(eventSuuId)).map((a) => a.id));
  const { checkIns, allBackAt } = collapseOps(ops);
  const supabase = getSupabaseAdmin();

  for (const [attendeeId, at] of checkIns) {
    if (!known.has(attendeeId)) continue;
    await supabase
      .from("event_attendees")
      .update({ checked_in_at: at, checked_in_by: at ? member.id : null })
      .eq("id", attendeeId)
      .eq("event_suu_id", eventSuuId);
  }
  if (allBackAt) {
    await supabase
      .from("event_attendees")
      .update({ returned_at: allBackAt })
      .eq("event_suu_id", eventSuuId)
      .eq("removed", false)
      .not("checked_in_at", "is", null)
      .is("returned_at", null);
    await audit(member.id, "walk.all_back", "event", eventSuuId, { at: allBackAt });
  }

  const attendees = await getAttendees(eventSuuId);
  return NextResponse.json({ ok: true, attendees });
}
