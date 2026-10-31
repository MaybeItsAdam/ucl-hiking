import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Check, ChevronRight, ClipboardCheck, Footprints } from "lucide-react";
import { EventFacts } from "@/components/EventFacts";
import { EventsSubnav } from "@/components/EventsSubnav";
import { HikeMap } from "@/components/HikeMap";
import { WalkClaims, WalkClaimsSkeleton } from "@/components/WalkClaims";
import { can, profileOf } from "@/lib/access";
import { getMemberAttendance, walkRole, type WalkRole } from "@/lib/attendees";
import { eventDetails, formatAscent, formatKm } from "@/lib/eventDetails";
import { eventWhen, isEventCurrent, isOnToday, longDate } from "@/lib/eventList";
import { getPlansNaming } from "@/lib/eventPlans";
import { getEventsBySuuIds } from "@/lib/events";
import { clubYear, clubYearLabel, eventPlaces, mapHikes, onMap, yearStats } from "@/lib/hikeMap";
import { loadPlaces } from "@/lib/places";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = { title: "My walks | UCL Hiking Club" };

/**
 * The walks you're on and the ones you've done: from your SU tickets and the
 * leaders' registers. This year's totals and a map of where you've been.
 * Walk leaders also see the walks they've led and which still need a claim.
 * Today's walk sits on top all day, with the register for whoever runs it.
 */
export default async function MyWalksPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const showRota = can(profileOf(member), "lead_walks");

  // Walks they're booked on or checked in to, and walks a plan names them to lead or backmark.
  const [attendance, plans] = await Promise.all([getMemberAttendance(member.id), getPlansNaming(member.id)]);
  const bySuuId = new Map(attendance.map((a) => [a.event_suu_id, a]));
  const all = await getEventsBySuuIds([...new Set([...bySuuId.keys(), ...plans.keys()])]);
  // Totals, the map and Done stay theirs as walkers; leading one without a ticket isn't walking it here.
  const events = all.filter((e) => bySuuId.has(e.suu_event_id ?? ""));
  const places = await loadPlaces(eventPlaces(events));
  const hikes = mapHikes(events, places);

  const year = clubYear();
  const thisYear = hikes.filter((h) => clubYear(new Date(h.date)) === year);
  const stats = yearStats(thisYear);
  const pinned = hikes.filter((h) => !h.upcoming && onMap(h));

  // Today's walk stays on top all day, finished or not, with the leader's way into the register.
  const now = new Date();
  const viewer = { id: member.id, ...profileOf(member) };
  const roles = new Map(all.map((e) => [e.id, e.suu_event_id ? walkRole(viewer, plans.get(e.suu_event_id) ?? null) : null]));
  const today = all.filter((e) => e.status !== "cancelled" && isOnToday(e, now));
  const upcoming = all.filter((e) => !today.includes(e) && isEventCurrent(e, now));
  const done = events.filter((e) => !today.includes(e) && !upcoming.includes(e)).reverse();

  return (
    <article className="events-page">
      <EventsSubnav active="mine" showRota={showRota} showProgramme={can(profileOf(member), "manage_walks")} />

      {today.length ? <WalkList title="On today" events={today} bySuuId={bySuuId} roles={roles} dayLinks /> : null}

      {showRota ? (
        // Reads the reimbursement spreadsheet, which can take a few seconds: the rest of the page doesn't wait,
        // and the section holds its place with a skeleton so leaders can see it's still coming.
        <Suspense fallback={<WalkClaimsSkeleton />}>
          <WalkClaims member={member} />
        </Suspense>
      ) : null}

      {events.length || today.length || upcoming.length ? (
        <>
          {events.length ? (
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
          ) : null}

          {pinned.length ? <HikeMap hikes={pinned} label="Map of the walks you've done" /> : null}

          {upcoming.length ? <WalkList title="Coming up" events={upcoming} bySuuId={bySuuId} roles={roles} /> : null}
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
  roles,
  dayLinks = false,
}: {
  title: string;
  events: Awaited<ReturnType<typeof getEventsBySuuIds>>;
  bySuuId: Map<string, { checked_in_at: string | null }>;
  roles?: Map<string, WalkRole | null>;
  /** Today's list: whoever runs the walk gets the register, headcount and incident form. */
  dayLinks?: boolean;
}) {
  return (
    <section aria-label={title}>
      <h2 className="events-month">{title}</h2>
      <ol className="events-list">
        {events.map((event) => {
          const details = eventDetails(event);
          const went = bySuuId.get(event.suu_event_id ?? "")?.checked_in_at;
          const role = roles?.get(event.id) ?? null;
          return (
            <li key={event.id}>
              <Link href={`/portal/events/${event.id}`} className={`event-row kind-${details.kind}`}>
                <div className="event-body">
                  <h3>
                    {details.name}
                    {role === "leader" || role === "backmarker" ? (
                      <span className="event-chip my-walk-role">{role === "leader" ? "Leading" : "Backmarker"}</span>
                    ) : null}
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
              {dayLinks && role && event.suu_event_id ? (
                <div className="event-day-actions">
                  <Link className="kit-btn" href={`/portal/events/${event.id}/day`}>
                    <ClipboardCheck size={15} aria-hidden="true" />
                    On the day<span className="sr-only">: {details.name}</span>
                  </Link>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
