import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarX2, MapPin } from "lucide-react";
import { groupEventsByMonth } from "@/lib/eventList";
import { getCurrentMember } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import type { SUEvent } from "@/lib/types";

export const metadata: Metadata = {
  title: "Events | UCL Hiking Club",
};

const STATUS_LABELS: Partial<Record<SUEvent["status"], string>> = {
  cancelled: "Cancelled",
  sold_out: "Sold out",
};

/** Upcoming events, plus any that started earlier but are still running (a weekend away). */
async function upcomingEvents(): Promise<SUEvent[]> {
  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV === "production") return [];
    const { getDevEvents } = await import("@/lib/dev-store");
    return getDevEvents() as SUEvent[];
  }
  const now = new Date().toISOString();
  const { data } = await getSupabaseAdmin()
    .from("events")
    // `*`, not a column list: local dev reads the production database, which may
    // not have this deploy's columns yet.
    .select("*")
    .or(`starts_at.gte.${now},ends_at.gte.${now}`)
    .neq("status", "draft")
    .order("starts_at", { ascending: true })
    .limit(200);
  return (data ?? []) as SUEvent[];
}

export default async function EventsPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");

  const months = groupEventsByMonth(await upcomingEvents());

  return (
    <article className="events-page">
      {months.length === 0 ? (
        <div className="events-empty">
          <CalendarX2 size={28} aria-hidden="true" />
          <p>No upcoming events yet. New walks and socials appear here as soon as the committee posts them.</p>
        </div>
      ) : (
        months.map((month) => (
          <section key={month.key} aria-labelledby={`events-${month.key}`}>
            <h2 id={`events-${month.key}`} className="events-month">{month.label}</h2>
            <ol className="events-list">
              {month.items.map(({ event, weekday, day, when }) => {
                const status = STATUS_LABELS[event.status];
                return (
                  <li key={event.id} className={`event-row${event.status === "cancelled" ? " is-cancelled" : ""}`}>
                    <div className="event-date">
                      <span>{weekday}</span>
                      <strong>{day}</strong>
                    </div>
                    <div className="event-body">
                      <h3>
                        {event.title}
                        {status ? <span className={`event-status is-${event.status}`}>{status}</span> : null}
                      </h3>
                      <p className="event-meta">
                        {when}
                        {event.location ? <> · {event.location}</> : null}
                      </p>
                      {event.description ? <p className="event-description">{event.description}</p> : null}
                      {event.location_url ? (
                        <a className="event-link" href={event.location_url} target="_blank" rel="noopener noreferrer">
                          <MapPin size={14} aria-hidden="true" />
                          <span>Directions</span>
                        </a>
                      ) : null}
                    </div>
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
