import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Check, ChevronRight, ClipboardCheck, Footprints } from "lucide-react";
import { EventFacts } from "@/components/EventFacts";
import { EventsSubnav } from "@/components/EventsSubnav";
import { HikeMap } from "@/components/HikeMap";
import { WalkClaims, WalkClaimsSkeleton } from "@/components/WalkClaims";
import { WalkLeaderRequestForm } from "@/components/WalkLeaderRequestForm";
import { can, profileOf } from "@/lib/access";
import { getMemberAttendance, walkRole, type WalkRole } from "@/lib/attendees";
import { eventDetails, formatAscent, formatKm } from "@/lib/eventDetails";
import { eventWhen, isEventCurrent, isOnToday, longDate } from "@/lib/eventList";
import { getPlansNaming } from "@/lib/eventPlans";
import { dedupeEvents } from "@/lib/eventDuplicates";
import { getEventsBySuuIds } from "@/lib/events";
import { getRouteLines } from "@/lib/eventRoutes";
import { clubYear, clubYearLabel, eventPlaces, mapHikes, onMap, withTracks, yearStats } from "@/lib/hikeMap";
import { loadPlaces } from "@/lib/places";
import { getCurrentMember, getRealMember } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase";
import { latestWalkLeaderRequest } from "@/lib/walkLeaderRequests";

export const metadata: Metadata = { title: "My walks | UCL Hiking Club" };

/**
 * The walks you're on and the ones you've done: from your SU tickets and the
 * leaders' registers. This year's totals and a map of where you've been.
 * Walk leaders also see the walks they've led and which still need a claim;
 * everyone else can apply to be one.
 * Today's walk sits on top all day, with the register for whoever runs it.
 */
export default async function MyWalksPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const showRota = can(profileOf(member), "lead_walks");
  // Members who aren't leaders can apply, unless they already have; judged on
  // the real account, as the request is made as them whatever is previewed.
  const real = await getRealMember();
  const mayApply = Boolean(real && !real.is_walk_leader && !real.governance_role);

  // Walks they're booked on or checked in to, and walks a plan names them to lead or backmark.
  const [attendance, plans, wlRequest] = await Promise.all([
    getMemberAttendance(member.id, member.email),
    getPlansNaming(member.id),
    mayApply && real && isSupabaseConfigured() ? latestWalkLeaderRequest(real.id).catch(() => null) : null,
  ]);
  const offerLeading = mayApply && !showRota && wlRequest?.status !== "pending";
  const bySuuId = new Map(attendance.map((a) => [a.event_suu_id, a]));
  // One walk listed twice (lib/eventDuplicates) shows once, as the copy they're booked on.
  const all = dedupeEvents(await getEventsBySuuIds([...new Set([...bySuuId.keys(), ...plans.keys()])]), bySuuId.keys());
  // Totals, the map and Done stay theirs as walkers; leading one without a ticket isn't walking it here.
  const events = all.filter((e) => bySuuId.has(e.suu_event_id ?? ""));
  const [places, lines] = await Promise.all([loadPlaces(eventPlaces(events)), getRouteLines(events.map((e) => e.suu_event_id))]);
  const hikes = withTracks(mapHikes(events, places), lines);

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

      {offerLeading ? (
        // Here rather than in Account settings, which few members open: My walks is where walking lives.
        <section aria-labelledby="walk-leader-title" className="my-walks-apply">
          <h2 id="walk-leader-title" className="events-month">
            Walk leading
          </h2>
          <p className="event-meta">
            Been approved as a walk leader? Apply here for the rota, leader-only walks and reimbursements.
          </p>
          <WalkLeaderRequestForm initial={wlRequest} />
        </section>
      ) : null}

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
                  {/* A full page load, not a <Link>: with no signal the service
                      worker opens its saved copy, where a soft navigation
                      would wait for the connection (useOffline). */}
                  <a className="kit-btn" href={`/portal/events/${event.id}/day`}>
                    <ClipboardCheck size={15} aria-hidden="true" />
                    On the day<span className="sr-only">: {details.name}</span>
                  </a>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
