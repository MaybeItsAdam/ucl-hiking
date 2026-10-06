import { NextResponse } from "next/server";
import { getAttendees, getTicketListCheck, headcount, syncEventAttendees, type TicketListCheck } from "@/lib/attendees";
import { audit } from "@/lib/audit";
import { canViewSafety, loadSafety, type SafetyDetails } from "@/lib/safety";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { loadDayContext } from "@/lib/walkDay";

type Params = { params: Promise<{ id: string }> };

/**
 * Everything the leader needs on the day, in one response the page can keep
 * for offline use: the register, the emergency details they may see, and the
 * club kit booked for the walk.
 */
export async function GET(_request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const loaded = await loadDayContext((await params).id, member);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const { event, plan, role } = loaded.ctx;

  const attendees = await getAttendees(event.suu_event_id);
  const visible = attendees.filter((a) =>
    canViewSafety({
      viewerId: member.id,
      leaderId: plan?.leader_member_id ?? null,
      backmarkerId: plan?.backmarker_member_id ?? null,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      attendee: a,
    }),
  );
  const safetyById = await loadSafety(visible.map((a) => a.member_id!));
  const safety: Record<string, SafetyDetails> = {};
  for (const a of visible) {
    const details = safetyById.get(a.member_id!);
    if (details) safety[a.id] = details;
  }
  if (Object.keys(safety).length) {
    await audit(member.id, "safety.view", "event", event.suu_event_id, {
      members: visible.filter((a) => safety[a.id]).map((a) => a.member_id),
    });
  }

  let kit: { id: string; name: string; quantity: number; status: string; borrower: string | null }[] = [];
  let ticketList: TicketListCheck | null = null;
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseAdmin();
    const [kitRes, check] = await Promise.all([
      supabase
        .from("equipment_requests")
        .select("id, quantity, status, equipment:equipment_id (name), member:member_id (full_name)")
        .eq("event_suu_id", event.suu_event_id)
        .in("status", ["pending", "approved"]),
      getTicketListCheck(event.suu_event_id),
    ]);
    type KitRow = { id: string; quantity: number; status: string; equipment: { name: string } | null; member: { full_name: string | null } | null };
    kit = ((kitRes.data ?? []) as unknown as KitRow[]).map((r) => ({
      id: r.id,
      name: r.equipment?.name ?? "Kit",
      quantity: r.quantity,
      status: r.status,
      borrower: r.member?.full_name ?? null,
    }));
    ticketList = check;
  }

  return NextResponse.json({
    event: { id: event.id, suu_event_id: event.suu_event_id, title: event.title, starts_at: event.starts_at, ends_at: event.ends_at },
    role,
    leader: plan?.leader?.full_name ?? null,
    backmarker: plan?.backmarker?.full_name ?? null,
    // The register works by name; ticketholders' emails stay on the server.
    attendees: attendees.map((a) => ({ ...a, email: null })),
    headcount: headcount(attendees),
    safety,
    kit,
    ticketList,
    fetchedAt: new Date().toISOString(),
  });
}

/** Ask Toolbox for the latest ticketholders now, rather than waiting for the daily run. */
export async function POST(_request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const loaded = await loadDayContext((await params).id, member);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "The register needs the database." }, { status: 503 });
  const result = await syncEventAttendees(loaded.ctx.event.suu_event_id);
  return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
}
