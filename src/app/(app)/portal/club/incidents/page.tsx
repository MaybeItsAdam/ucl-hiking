import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClubSubnav } from "@/components/ClubSubnav";
import { IncidentList } from "@/components/club/IncidentList";
import { requireClub } from "@/lib/clubPage";
import { eventDetails } from "@/lib/eventDetails";
import { getEventsInClubYear } from "@/lib/events";
import { clubYear } from "@/lib/hikeMap";

export const metadata: Metadata = { title: "Incidents | UCL Hiking Club" };

export default async function IncidentsPage() {
  const { principal } = await requireClub();
  if (!principal) redirect("/portal/club");
  const year = clubYear();
  const events = [...(await getEventsInClubYear(year - 1)), ...(await getEventsInClubYear(year))];
  const eventNames = Object.fromEntries(events.filter((e) => e.suu_event_id).map((e) => [e.suu_event_id!, eventDetails(e).name]));
  return (
    <article className="club-page">
      <ClubSubnav active="incidents" principal={principal} />
      <IncidentList eventNames={eventNames} />
    </article>
  );
}
