import { profileOf } from "@/lib/access";
import { walkRole, type WalkRole } from "@/lib/attendees";
import { getEventPlan, type EventPlanView } from "@/lib/eventPlans";
import { getEvent } from "@/lib/events";
import type { Member, SUEvent } from "@/lib/types";

export interface DayContext {
  event: SUEvent & { suu_event_id: string };
  plan: EventPlanView | null;
  role: WalkRole;
}

/**
 * The event, its plan and the viewer's part in it — or why they can't run it.
 * Every day-of route starts here so the rule lives in one place.
 */
export async function loadDayContext(
  eventId: string,
  member: Member,
): Promise<{ ok: true; ctx: DayContext } | { ok: false; status: number; error: string }> {
  const event = await getEvent(eventId);
  if (!event?.suu_event_id) return { ok: false, status: 404, error: "No such event." };
  const plan = await getEventPlan(event.suu_event_id);
  const role = walkRole({ id: member.id, ...profileOf(member) }, plan);
  if (!role) return { ok: false, status: 403, error: "Only this walk's leaders and the committee run the register." };
  return { ok: true, ctx: { event: event as DayContext["event"], plan, role } };
}
