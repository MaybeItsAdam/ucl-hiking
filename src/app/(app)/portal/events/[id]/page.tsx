import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  CalendarPlus,
  ChevronLeft,
  Clock,
  CloudSun,
  ExternalLink,
  Flag,
  Map as MapIcon,
  MapPin,
  Navigation,
  Route,
  Ticket,
  TrainFront,
  UserRound,
  Users,
} from "lucide-react";
import { DifficultyChip } from "@/components/EventFacts";
import { EventPlanEditor } from "@/components/EventPlanEditor";
import { KitChecklist } from "@/components/KitChecklist";
import { OpenExternal } from "@/components/OpenExternal";
import { profileOf } from "@/lib/access";
import { HikeMap } from "@/components/HikeMap";
import { DIFFICULTY_LABELS, eventDetails, formatAscent, formatKm, isHeading, KIND_LABELS } from "@/lib/eventDetails";
import { countdown, eventWhen, longDate } from "@/lib/eventList";
import { canEditPlan, getEventPlan } from "@/lib/eventPlans";
import { getEvent } from "@/lib/events";
import { mapHikes } from "@/lib/hikeMap";
import { loadPlaces, type LatLng } from "@/lib/places";
import { getCurrentMember } from "@/lib/session";
import { getWalkForecast } from "@/lib/weather";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const event = await getEvent((await params).id);
  return { title: `${event ? eventDetails(event).name : "Event"} | UCL Hiking Club` };
}

/** Google Maps: a walking route between the pins if there are two, the place if there is one. */
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

function mapsUrl(start: LatLng | null, finish: LatLng | null, fallback: string | null): string | null {
  const at = (p: LatLng) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  if (start && finish && at(start) !== at(finish)) {
    return `https://www.google.com/maps/dir/?api=1&origin=${at(start)}&destination=${at(finish)}&travelmode=walking`;
  }
  const point = start ?? finish;
  if (point) return `https://www.google.com/maps/search/?api=1&query=${at(point)}`;
  return fallback ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallback)}` : null;
}

export default async function EventPage({ params }: Params) {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");

  const event = await getEvent((await params).id);
  if (!event) notFound();

  const details = eventDetails(event);
  const [places, plan] = await Promise.all([
    loadPlaces([details.start, details.finish].filter((p): p is string => Boolean(p))),
    getEventPlan(event.suu_event_id),
  ]);
  const [hike] = mapHikes([event], places);
  const pinned = hike && (hike.start || hike.finish) ? hike : null;
  const soon = countdown(event);
  const walking = details.kind === "hike" || details.kind === "walk" || details.kind === "trip";
  const forecastAt = pinned?.start ?? pinned?.finish ?? null;
  const forecast = walking && forecastAt && event.status !== "cancelled" ? await getWalkForecast(forecastAt, event.starts_at) : null;
  const editable = Boolean(event.suu_event_id) && canEditPlan(profileOf(member));
  const planMeet = plan?.meet_at || plan?.meet_point
    ? [plan.meet_at ? clock.format(new Date(plan.meet_at)) : null, plan.meet_point].filter(Boolean).join(" · ")
    : null;
  const meet = planMeet ?? details.meetingPoint;
  const openInMaps = mapsUrl(
    pinned?.start ?? null,
    pinned?.finish ?? null,
    details.start ? `${details.start} station` : details.meetingPoint,
  );

  const stats = [
    details.distanceKm !== null ? { label: "Distance", value: formatKm(details.distanceKm) } : null,
    details.ascentM !== null ? { label: "Ascent", value: formatAscent(details.ascentM) } : null,
    details.difficulty ? { label: "Grade", value: DIFFICULTY_LABELS[details.difficulty], difficulty: details.difficulty } : null,
    details.trainFare ? { label: "Train", value: details.trainFare } : null,
  ].filter((s) => s !== null);

  const day = [
    meet ? { icon: Clock, label: "Meet", value: meet } : null,
    plan?.transport ? { icon: TrainFront, label: "Getting there", value: plan.transport } : null,
    walking && details.start && !plan?.transport ? { icon: TrainFront, label: "Train to", value: details.start } : null,
    walking && details.finish && details.finish !== details.start
      ? { icon: Flag, label: "Finish", value: details.finish }
      : walking && details.finish
        ? { icon: Flag, label: "Finish", value: `Back at ${details.finish}` }
        : null,
    plan?.leader ? { icon: UserRound, label: "Leader", value: plan.leader.full_name ?? "Named leader" } : null,
    plan?.backmarker ? { icon: Users, label: "Backmarker", value: plan.backmarker.full_name ?? "Named backmarker" } : null,
  ].filter((row) => row !== null);

  const hasFactSheet = details.more.some(isHeading);

  return (
    <article className={`event-page kind-${details.kind}${event.status === "cancelled" ? " is-cancelled" : ""}`}>
      <Link href="/portal/events" className="event-back">
        <ChevronLeft size={18} aria-hidden="true" />
        Events
      </Link>

      {event.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- any host Toolbox links to; nothing to optimise through
        <img className="event-hero-image" src={event.image_url} alt="" />
      ) : null}

      <header className="event-hero">
        <span className="event-hero-emoji" aria-hidden="true">
          {details.emoji ?? "🥾"}
        </span>
        <div className="event-hero-text">
          <span className="event-eyebrow">{details.eyebrow ?? KIND_LABELS[details.kind]}</span>
          <h2>{details.name}</h2>
          <p className="event-meta">
            {event.starts_at ? `${longDate(event.starts_at)} · ` : null}
            {eventWhen(event)}
          </p>
          <div className="event-hero-chips">
            {event.status === "cancelled" ? <span className="event-status is-cancelled">Cancelled</span> : null}
            {event.status === "sold_out" ? <span className="event-status is-sold_out">Sold out</span> : null}
            {soon && event.status !== "cancelled" ? (
              <span className={`event-countdown${soon.past ? " is-past" : ""}`}>{soon.label}</span>
            ) : null}
          </div>
        </div>
      </header>

      {stats.length ? (
        <dl className="event-stats">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{"difficulty" in stat && stat.difficulty ? <DifficultyChip difficulty={stat.difficulty} /> : stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {details.lead ? <p className="event-page-lead">{details.lead}</p> : null}

      <div className="event-actions">
        {plan?.booking_url && event.status !== "cancelled" ? (
          <OpenExternal className="kit-btn primary" href={plan.booking_url}>
            <Ticket size={15} aria-hidden="true" />
            Book on the SU
          </OpenExternal>
        ) : null}
        {event.starts_at ? (
          <a className="kit-btn" href={`/api/events/${event.id}/ics`} download>
            <CalendarPlus size={15} aria-hidden="true" />
            Add to calendar
          </a>
        ) : null}
        {editable ? <EventPlanEditor eventId={event.id} startsAt={event.starts_at} /> : null}
      </div>

      {forecast ? (
        <section className="event-section" aria-labelledby="event-weather">
          <h3 id="event-weather" className="event-section-title">
            Forecast
          </h3>
          <div className="event-forecast">
            <CloudSun size={22} aria-hidden="true" />
            <div className="event-forecast-main">
              <strong>{forecast.summary}</strong>
              <span>
                {forecast.tempMin}° to {forecast.tempMax}°C
              </span>
            </div>
            <dl>
              {forecast.rainChance !== null ? (
                <div>
                  <dt>Rain</dt>
                  <dd>{forecast.rainChance}%</dd>
                </div>
              ) : null}
              {forecast.windMaxKmh !== null ? (
                <div>
                  <dt>Wind</dt>
                  <dd>
                    {forecast.windMaxKmh}
                    {forecast.gustMaxKmh !== null && forecast.gustMaxKmh > forecast.windMaxKmh + 10 ? `–${forecast.gustMaxKmh}` : ""} km/h
                  </dd>
                </div>
              ) : null}
              {forecast.sunset ? (
                <div>
                  <dt>Sunset</dt>
                  <dd>{forecast.sunset.slice(11, 16)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </section>
      ) : null}

      {day.length || pinned || openInMaps || event.location_url || plan?.route_url ? (
        <section className="event-section" aria-labelledby="event-day">
          <h3 id="event-day" className="event-section-title">
            {walking ? "The day" : "Where"}
          </h3>
          <div className="event-day">
            {day.length ? (
              <ul className="event-day-rows">
                {day.map(({ icon: Icon, label, value }) => (
                  <li key={label}>
                    <Icon size={16} aria-hidden="true" />
                    <span className="event-day-label">{label}</span>
                    <span className="event-day-value">{value}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {pinned ? <HikeMap hikes={[pinned]} label={`Map of ${details.name}`} /> : null}
            <div className="event-day-actions">
              {openInMaps ? (
                <a className="kit-btn" href={openInMaps} target="_blank" rel="noopener noreferrer">
                  <Navigation size={15} aria-hidden="true" />
                  Open in Maps
                </a>
              ) : null}
              {event.location_url ? (
                <a className="kit-btn" href={event.location_url} target="_blank" rel="noopener noreferrer">
                  <MapPin size={15} aria-hidden="true" />
                  Directions
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              ) : null}
              {plan?.route_url ? (
                <OpenExternal className="kit-btn" href={plan.route_url}>
                  <Route size={15} aria-hidden="true" />
                  Route
                  <ExternalLink size={13} aria-hidden="true" />
                </OpenExternal>
              ) : null}
              {walking ? (
                <Link className="kit-btn" href="/portal/events/map">
                  <MapIcon size={15} aria-hidden="true" />
                  All this year’s walks
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {plan?.kit_list.length ? (
        <section className="event-section" aria-labelledby="event-kit">
          <h3 id="event-kit" className="event-section-title">
            What to bring
          </h3>
          <KitChecklist eventKey={event.suu_event_id ?? event.id} items={plan.kit_list} />
        </section>
      ) : null}

      {plan?.notes ? (
        <section className="event-section" aria-labelledby="event-notes">
          <h3 id="event-notes" className="event-section-title">
            From the leader
          </h3>
          <div className="event-text">
            {plan.notes.split(/\n+/).map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </section>
      ) : null}

      {details.more.length ? (
        hasFactSheet ? (
          <details className="event-more">
            <summary>Everything else you need to know</summary>
            <EventText lines={details.more} />
          </details>
        ) : (
          <section className="event-section">
            <EventText lines={details.more} />
          </section>
        )
      ) : null}
    </article>
  );
}

function EventText({ lines }: { lines: string[] }) {
  return (
    <div className="event-text">
      {lines.map((line, i) =>
        isHeading(line) ? <h4 key={i}>{line}</h4> : <p key={i}>{line}</p>,
      )}
    </div>
  );
}
