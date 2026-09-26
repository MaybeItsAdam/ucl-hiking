import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarX2, ChevronRight, Map as MapIcon, MapPin } from "lucide-react";
import { EventFacts, routeLabel } from "@/components/EventFacts";
import { EventsSubnav } from "@/components/EventsSubnav";
import { can, profileOf } from "@/lib/access";
import { eventDetails, formatKm, KIND_LABELS } from "@/lib/eventDetails";
import { countdown, eventWhen, groupEventsByMonth, longDate } from "@/lib/eventList";
import { getEventsInClubYear, getUpcomingEvents } from "@/lib/events";
import { clubYear, clubYearLabel, mapHikes, yearStats } from "@/lib/hikeMap";
import { getCurrentMember } from "@/lib/session";
import type { SUEvent } from "@/lib/types";

export const metadata: Metadata = {
  title: "Events | UCL Hiking Club",
};

const STATUS_LABELS: Partial<Record<SUEvent["status"], string>> = {
  cancelled: "Cancelled",
  sold_out: "Sold out",
};

function StatusChip({ status }: { status: SUEvent["status"] }) {
  const label = STATUS_LABELS[status];
  return label ? <span className={`event-status is-${status}`}>{label}</span> : null;
}

/** The next thing on, big: what it is, how soon, and the numbers that decide it. */
function NextUp({ event }: { event: SUEvent }) {
  const details = eventDetails(event);
  const soon = countdown(event);
  const route = routeLabel(details);
  return (
    <Link href={`/portal/events/${event.id}`} className={`event-next kind-${details.kind}`}>
      <div className="event-next-top">
        <span className="event-next-label">Next up</span>
        {soon ? <span className="event-countdown">{soon.label}</span> : null}
      </div>
      <div className="event-next-main">
        <span className="event-next-emoji" aria-hidden="true">
          {details.emoji ?? "🥾"}
        </span>
        <div className="event-next-text">
          <span className="event-eyebrow">{details.eyebrow ?? KIND_LABELS[details.kind]}</span>
          <h2>
            {details.name}
            <StatusChip status={event.status} />
          </h2>
          <p className="event-meta">
            {longDate(event.starts_at!)} · {eventWhen(event)}
          </p>
        </div>
      </div>
      <EventFacts details={details} />
      {route ? (
        <p className="event-route">
          <MapPin size={14} aria-hidden="true" />
          {route}
        </p>
      ) : details.lead ? (
        <p className="event-lead">{details.lead}</p>
      ) : null}
      <span className="event-next-cta">
        See the details <ArrowRight size={15} aria-hidden="true" />
      </span>
    </Link>
  );
}

export default async function EventsPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");

  const year = clubYear();
  const [upcoming, thisYear] = await Promise.all([getUpcomingEvents(), getEventsInClubYear(year)]);
  const stats = yearStats(mapHikes(thisYear, new Map()));

  const next = upcoming.find((event) => event.starts_at && event.status !== "cancelled");
  const months = groupEventsByMonth(upcoming.filter((event) => event !== next));

  return (
    <article className="events-page">
      <EventsSubnav active="upcoming" showRota={can(profileOf(member), "lead_walks")} />
      {next ? <NextUp event={next} /> : null}

      <Link href="/portal/events/map" className="events-map-link">
        <span className="events-map-icon">
          <MapIcon size={20} aria-hidden="true" />
        </span>
        <span className="events-map-text">
          <strong>{clubYearLabel(year)} on the map</strong>
          <span>
            {stats.done
              ? `${stats.done} ${stats.done === 1 ? "walk" : "walks"}${stats.km ? ` · ${formatKm(stats.km)}` : ""} so far`
              : "Every walk the club does this year"}
          </span>
        </span>
        <ChevronRight size={18} aria-hidden="true" className="events-map-chevron" />
      </Link>

      {!next && months.length === 0 ? (
        <div className="events-empty">
          <CalendarX2 size={28} aria-hidden="true" />
          <p>No upcoming events yet. New walks and socials appear here as soon as the committee posts them.</p>
        </div>
      ) : (
        months.map((month) => (
          <section key={month.key} aria-labelledby={`events-${month.key}`}>
            <h2 id={`events-${month.key}`} className="events-month">
              {month.label}
            </h2>
            <ol className="events-list">
              {month.items.map(({ event, weekday, day, when }) => {
                const details = eventDetails(event);
                const route = routeLabel(details);
                const walking = details.kind === "hike" || details.kind === "walk" || details.kind === "trip";
                return (
                  <li key={event.id}>
                    <Link
                      href={`/portal/events/${event.id}`}
                      className={`event-row kind-${details.kind}${event.status === "cancelled" ? " is-cancelled" : ""}`}
                    >
                      <div className="event-date">
                        <span>{weekday}</span>
                        <strong>{day}</strong>
                        <em aria-hidden="true">{details.emoji ?? ""}</em>
                      </div>
                      <div className="event-body">
                        <span className="event-eyebrow">{details.eyebrow ?? KIND_LABELS[details.kind]}</span>
                        <h3>
                          {details.name}
                          <StatusChip status={event.status} />
                        </h3>
                        <p className="event-meta">
                          {when}
                          {details.meetingPoint ? <> · {details.meetingPoint}</> : null}
                        </p>
                        <EventFacts details={details} />
                        {walking && route ? (
                          <p className="event-route">
                            <MapPin size={13} aria-hidden="true" />
                            {route}
                          </p>
                        ) : details.lead && !walking ? (
                          <p className="event-description">{details.lead}</p>
                        ) : null}
                      </div>
                      <ChevronRight size={18} aria-hidden="true" className="event-chevron" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}
    </article>
  );
}
