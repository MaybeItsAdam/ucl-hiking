import type { Metadata } from "next";
import { BroadcastForm } from "@/components/club/BroadcastForm";
import { ClubSubnav } from "@/components/ClubSubnav";
import { requireClub } from "@/lib/clubPage";
import { eventDetails } from "@/lib/eventDetails";
import { longDate } from "@/lib/eventList";
import { getUpcomingEvents } from "@/lib/events";

export const metadata: Metadata = { title: "Broadcast | UCL Hiking Club" };

export default async function BroadcastPage() {
  const { principal } = await requireClub();
  const walks = (await getUpcomingEvents())
    .filter((e) => e.suu_event_id && e.starts_at)
    .slice(0, 30)
    .map((e) => ({ suuId: e.suu_event_id!, label: `${longDate(e.starts_at!)} · ${eventDetails(e).name}` }));
  return (
    <article className="club-page">
      <ClubSubnav active="broadcast" principal={principal} />
      <BroadcastForm walks={walks} />
    </article>
  );
}
