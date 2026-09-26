import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ChevronRight, Footprints } from "lucide-react";
import { EventFacts } from "@/components/EventFacts";
import { EventsSubnav } from "@/components/EventsSubnav";
import { HikeMap } from "@/components/HikeMap";
import { can, profileOf } from "@/lib/access";
import { getMemberAttendance } from "@/lib/attendees";
import { eventDetails, formatAscent, formatKm } from "@/lib/eventDetails";
import { countdown, eventWhen, longDate } from "@/lib/eventList";
import { getEventsBySuuIds } from "@/lib/events";
import { clubYear, clubYearLabel, eventPlaces, mapHikes, onMap, yearStats } from "@/lib/hikeMap";
import { loadPlaces } from "@/lib/places";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = { title: "My walks | UCL Hiking Club" };

/**
 * The walks you're on and the ones you've done: from your SU tickets and the
 * leaders' registers. This year's totals and a map of where you've been.
 */
export default async function MyWalksPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const showRota = can(profileOf(member), "lead_walks");

  const attendance = await getMemberAttendance(member.id);
  const bySuuId = new Map(attendance.map((a) => [a.event_suu_id, a]));
  const events = await getEventsBySuuIds([...bySuuId.keys()]);
  const places = await loadPlaces(eventPlaces(events));
  const hikes = mapHikes(events, places);

  const year = clubYear();
  const thisYear = hikes.filter((h) => clubYear(new Date(h.date)) === year);
  const stats = yearStats(thisYear);
  const pinned = hikes.filter((h) => !h.upcoming && onMap(h));

  // Today's walk is still "coming up" until tomorrow.
  const upcoming = events.filter((e) => countdown(e)?.past === false);
  const done = events.filter((e) => !upcoming.includes(e)).reverse();

  return (
    <article className="events-page">
      <EventsSubnav active="mine" showRota={showRota} />

      {events.length ? (
        <>
          <dl className="event-stats">
            <div>
              <dt>{clubYearLabel(year)}</dt>
              <dd>
                {stats.done} {stats.done === 1 ? "walk" : "walks"}
              </dd>
            </div>
            <div>
              <dt>Distance</dt>
              <dd>{formatKm(stats.km)}</dd>
            </div>
            <div>
              <dt>Ascent</dt>
              <dd>{formatAscent(stats.ascentM)}</dd>
            </div>
            <div>
              <dt>Places</dt>
              <dd>{stats.places}</dd>
            </div>
          </dl>

          {pinned.length ? <HikeMap hikes={pinned} label="Map of the walks you've done" /> : null}

          {upcoming.length ? <WalkList title="Coming up" events={upcoming} bySuuId={bySuuId} /> : null}
          {done.length ? <WalkList title="Done" events={done} bySuuId={bySuuId} /> : null}
        </>
      ) : (
        <div className="events-empty">
          <Footprints size={28} aria-hidden="true" />
          <p>
            Walks you book on the SU show up here, along with every walk a leader checks you in on. Your totals and a
            map of where you&apos;ve been build up as you go.
          </p>
        </div>
      )}
    </article>
  );
}

function WalkList({
  title,
  events,
  bySuuId,
}: {
  title: string;
  events: Awaited<ReturnType<typeof getEventsBySuuIds>>;
  bySuuId: Map<string, { checked_in_at: string | null }>;
}) {
  return (
    <section aria-label={title}>
      <h2 className="events-month">{title}</h2>
      <ol className="events-list">
        {events.map((event) => {
          const details = eventDetails(event);
          const went = bySuuId.get(event.suu_event_id ?? "")?.checked_in_at;
          return (
            <li key={event.id}>
              <Link href={`/portal/events/${event.id}`} className={`event-row kind-${details.kind}`}>
                <div className="event-body">
                  <h3>
                    {details.name}
                    {went ? (
                      <span className="event-chip my-walk-in">
                        <Check size={12} aria-hidden="true" /> Checked in
                      </span>
                    ) : null}
                  </h3>
                  <p className="event-meta">
                    {event.starts_at ? `${longDate(event.starts_at)} · ` : null}
                    {eventWhen(event)}
                  </p>
                  <EventFacts details={details} />
                </div>
                <ChevronRight size={18} aria-hidden="true" className="event-chevron" />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
