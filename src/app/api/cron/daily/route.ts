import { NextResponse } from "next/server";
import { cronOrCommittee } from "@/lib/cronAuth";
import { getEventPlans } from "@/lib/eventPlans";
import { eventDetails } from "@/lib/eventDetails";
import { getUpcomingEvents } from "@/lib/events";
import { mapHikes } from "@/lib/hikeMap";
import { notify, walkRecipients } from "@/lib/notify";
import { loadPlaces } from "@/lib/places";
import { isTomorrow, reminderMessage } from "@/lib/reminders";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { getWalkForecast, londonDay } from "@/lib/weather";

/**
 * Once a day, early evening: remind everyone on tomorrow's walks, and nudge
 * anyone whose club kit is overdue. `sent_reminders` makes a second run (a
 * retry, or committee pressing it by hand) send nothing twice.
 */
export async function GET(request: Request) {
  if (!(await cronOrCommittee(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const supabase = getSupabaseAdmin();

  /** Claim a key; false if an earlier run already did. */
  async function claim(key: string): Promise<boolean> {
    const { error } = await supabase.from("sent_reminders").insert({ key });
    return !error;
  }

  const reminded: string[] = [];
  const tomorrow = (await getUpcomingEvents()).filter(
    (e) => e.suu_event_id && e.status !== "cancelled" && isTomorrow(e) && ["hike", "walk", "trip"].includes(eventDetails(e).kind),
  );
  const plans = await getEventPlans(tomorrow.map((e) => e.suu_event_id!));
  for (const event of tomorrow) {
    if (!(await claim(`reminder:${event.suu_event_id}`))) continue;
    const recipients = await walkRecipients(event.suu_event_id!);
    if (!recipients.length) continue;
    const details = eventDetails(event);
    const places = await loadPlaces([details.start, details.finish].filter((p): p is string => Boolean(p)));
    const [hike] = mapHikes([event], places);
    const at = hike?.start ?? hike?.finish ?? null;
    const forecast = at ? await getWalkForecast(at, event.starts_at) : null;
    const plan = plans.get(event.suu_event_id!) ?? null;
    await notify(recipients, { kind: "reminder", ...reminderMessage(event, plan, forecast), url: `/portal/events/${event.id}` });
    reminded.push(event.suu_event_id!);
  }

  const today = londonDay(new Date().toISOString());
  const { data: overdue } = await supabase
    .from("equipment_requests")
    .select("id, member_id, end_date, quantity, equipment:equipment_id (name)")
    .eq("status", "approved")
    .lt("end_date", today);
  let nudged = 0;
  for (const loan of (overdue ?? []) as unknown as { id: string; member_id: string; end_date: string; quantity: number; equipment: { name: string } | null }[]) {
    // Once when it first goes overdue, then weekly.
    const week = Math.floor((Date.parse(today) - Date.parse(loan.end_date)) / (7 * 24 * 60 * 60 * 1000));
    if (!(await claim(`overdue:${loan.id}:${week}`))) continue;
    await notify([loan.member_id], {
      kind: "kit",
      title: `Please return ${loan.quantity > 1 ? `${loan.quantity} × ` : ""}${loan.equipment?.name ?? "club kit"}`,
      body: `It was due back on ${new Date(loan.end_date).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}. Arrange the handover with a principal.`,
      url: "/portal/equipment",
    });
    nudged += 1;
  }

  return NextResponse.json({ ok: true, reminded, overdueNudged: nudged });
}
