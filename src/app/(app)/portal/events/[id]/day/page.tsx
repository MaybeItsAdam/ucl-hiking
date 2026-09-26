import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { WalkDayLoader } from "@/components/walk-day/WalkDayLoader";
import { eventDetails } from "@/lib/eventDetails";
import { eventWhen, longDate } from "@/lib/eventList";
import { getCurrentMember } from "@/lib/session";
import { loadDayContext } from "@/lib/walkDay";

export const metadata: Metadata = { title: "On the day | UCL Hiking Club" };

type Params = { params: Promise<{ id: string }> };

/** The leader's register, headcount and incident form for one walk. */
export default async function WalkDayPage({ params }: Params) {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const { id } = await params;
  const loaded = await loadDayContext(id, member);
  if (!loaded.ok) redirect(`/portal/events/${id}`);
  const { event } = loaded.ctx;

  return (
    <article className="event-page">
      <Link href={`/portal/events/${event.id}`} className="event-back">
        <ChevronLeft size={18} aria-hidden="true" />
        Event
      </Link>
      <header className="day-head">
        <span className="event-eyebrow">On the day</span>
        <h2>{eventDetails(event).name}</h2>
        <p className="event-meta">
          {event.starts_at ? `${longDate(event.starts_at)} · ` : null}
          {eventWhen(event)}
        </p>
      </header>
      <WalkDayLoader eventId={event.id} />
    </article>
  );
}
