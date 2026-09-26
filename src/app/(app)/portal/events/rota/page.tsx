import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EventsSubnav } from "@/components/EventsSubnav";
import { RotaBoard, type RotaWalk } from "@/components/RotaBoard";
import { can, profileOf } from "@/lib/access";
import { eventDetails } from "@/lib/eventDetails";
import { eventWhen, longDate } from "@/lib/eventList";
import { getEventPlans } from "@/lib/eventPlans";
import { getUpcomingEvents } from "@/lib/events";
import { getAvailability, rotaWalks } from "@/lib/rota";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export const metadata: Metadata = { title: "Leader rota | UCL Hiking Club" };

export default async function RotaPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const profile = profileOf(member);
  if (!can(profile, "lead_walks")) redirect("/portal/events");
  const canAssign = can(profile, "manage_walks");

  const events = rotaWalks(await getUpcomingEvents());
  const ids = events.map((e) => e.suu_event_id!);
  const [plans, availability] = await Promise.all([getEventPlans(ids), getAvailability(ids)]);

  let people: { id: string; name: string }[] = [];
  if (canAssign && isSupabaseConfigured()) {
    const { data } = await getSupabaseAdmin()
      .from("members")
      .select("id, full_name")
      .is("revoked_at", null)
      .or("is_walk_leader.eq.true,governance_role.not.is.null")
      .order("full_name");
    people = (data ?? []).map((p) => ({ id: p.id, name: p.full_name ?? "Unnamed" }));
  }

  const walks: RotaWalk[] = events.map((event) => {
    const plan = plans.get(event.suu_event_id!);
    const offers = availability.get(event.suu_event_id!) ?? [];
    return {
      id: event.id,
      suuId: event.suu_event_id!,
      name: eventDetails(event).name,
      when: `${longDate(event.starts_at!)} · ${eventWhen(event)}`,
      leaderId: plan?.leader_member_id ?? null,
      leaderName: plan?.leader?.full_name ?? null,
      backmarkerId: plan?.backmarker_member_id ?? null,
      backmarkerName: plan?.backmarker?.full_name ?? null,
      mine: offers.find((o) => o.member_id === member.id)?.status ?? null,
      offers: offers.map((o) => ({ memberId: o.member_id, name: o.member?.full_name ?? "Unnamed", status: o.status })),
    };
  });

  return (
    <article className="events-page">
      <EventsSubnav active="rota" showRota />
      <p className="day-note">
        Say which walks you can lead. {canAssign ? "Pick a leader and backmarker for each; it goes on the walk's plan." : "The committee picks from those who offer."}
      </p>
      <RotaBoard walks={walks} people={people} canAssign={canAssign} />
    </article>
  );
}
