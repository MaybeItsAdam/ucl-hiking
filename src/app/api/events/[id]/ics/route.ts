import { NextResponse } from "next/server";
import { getEventPlan } from "@/lib/eventPlans";
import { getEvent } from "@/lib/events";
import { buildCalendar, toIcsEvent } from "@/lib/ics";
import { getCurrentMember } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

/** One event as a .ics file, for "Add to calendar". */
export async function GET(_request: Request, { params }: Params) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const event = await getEvent((await params).id);
  if (!event) return NextResponse.json({ error: "No such event." }, { status: 404 });
  const plan = await getEventPlan(event.suu_event_id);
  const entry = toIcsEvent(event, { meetPoint: plan?.meet_point, meetAt: plan?.meet_at });
  if (!entry) return NextResponse.json({ error: "This event has no date yet." }, { status: 409 });

  const slug = event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "event";
  return new NextResponse(buildCalendar([entry], event.title), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
