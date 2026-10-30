import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import {
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  Clock,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Download,
  ExternalLink,
  Flag,
  Map as MapIcon,
  MapPin,
  Moon,
  Navigation,
  Route,
  Sun,
  Ticket,
  TrainFront,
  UserRound,
  Users,
} from "lucide-react";
import { DifficultyChip } from "@/components/EventFacts";
import { EventPlanEditor } from "@/components/EventPlanEditor";
import { KitChecklist } from "@/components/KitChecklist";
import { OpenExternal } from "@/components/OpenExternal";
import { RouteView } from "@/components/RouteView";
import { profileOf } from "@/lib/access";
import { DIFFICULTY_LABELS, eventDetails, formatAscent, formatKm, isHeading, KIND_LABELS } from "@/lib/eventDetails";
import { countdown, eventWhen, longDate } from "@/lib/eventList";
import { canEditPlan, getEventPlan } from "@/lib/eventPlans";
import { getEventRoute, mapRouteOf } from "@/lib/eventRoutes";
import { getEvent } from "@/lib/events";
import { mapHikes } from "@/lib/hikeMap";
import { loadPlaces, type LatLng } from "@/lib/places";
import { getCurrentMember } from "@/lib/session";
import type { SUEvent } from "@/lib/types";
import { canSeeEvent, viewerOf } from "@/lib/walkVisibility";
import { getWalkForecast, inForecastWindow, walkHours } from "@/lib/weather";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const event = await getEvent((await params).id);
  return { title: `${event ? eventDetails(event).name : "Event"} | UCL Hiking Club` };
}

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/**
 * Directions to the start, in the phone's own maps app: the walk itself is on
 * the map above, so this is only for getting there.
 */
function directionsUrl(to: LatLng | null, fallback: string | null): string | null {
  if (to) return `https://www.google.com/maps/dir/?api=1&destination=${to[0].toFixed(5)},${to[1].toFixed(5)}`;
  return fallback ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fallback)}` : null;
}

/** Name the app a route link opens in, so the button says where it goes. */
function routeLinkLabel(href: string): string {
  const host = (() => {
    try {
      return new URL(href).hostname;
    } catch {
      return "";
    }
  })();
  if (/(^|\.)osmaps\.com$|(^|\.)ordnancesurvey\.co\.uk$/.test(host)) return "Open in OS Maps";
  if (/(^|\.)komoot\.(com|de)$/.test(host)) return "Open in Komoot";
  if (/(^|\.)strava\.com$/.test(host)) return "Open in Strava";
  if (/(^|\.)alltrails\.com$/.test(host)) return "Open in AllTrails";
  return "Route";
}

/** A WMO weather code as a picture, by night as well as by day. */
function WeatherIcon({ code, isDay = true, size }: { code: number | null; isDay?: boolean; size: number }) {
  const Icon =
    code === null ? CloudSun
    : code === 0 ? (isDay ? Sun : Moon)
    : code <= 2 ? (isDay ? CloudSun : CloudMoon)
    : code === 3 ? Cloud
    : code <= 48 ? CloudFog
    : code <= 57 ? CloudDrizzle
    : code <= 67 || (code >= 80 && code <= 82) ? CloudRain
    : code <= 86 ? CloudSnow
    : CloudLightning;
  return <Icon size={size} aria-hidden="true" />;
}

const hhmm = (time: string | null) => (time ? time.slice(11, 16) : null);
const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** "23 km/h SW", or "23–49 km/h SW" when the gusts are worth knowing about. */
function windText(speed: number, gust: number | null, from: string | null, unit = true): string {
  const gusty = gust !== null && gust > speed + 10 ? `–${gust}` : "";
  return `${speed}${gusty}${unit ? " km/h" : ""}${from ? ` ${from}` : ""}`;
}

/**
 * The day's forecast at the start, or nothing when Open-Meteo has none to give.
 * The day at a glance, then hour by hour behind a fold, with the walk's own
 * hours marked.
 */
async function WalkForecast({ at, event }: { at: LatLng; event: Pick<SUEvent, "starts_at" | "ends_at" | "is_all_day"> }) {
  const forecast = await getWalkForecast(at, event.starts_at);
  if (!forecast) return null;
  // An all-day event has no hours of its own to mark: it is taken as sunrise to dark.
  const hours = event.is_all_day ? walkHours(forecast, null, null) : walkHours(forecast, event.starts_at, event.ends_at);
  const feels = forecast.feelsMin !== null && forecast.feelsMax !== null && (forecast.feelsMin < forecast.tempMin - 1 || forecast.feelsMax < forecast.tempMax - 1)
    ? `feels ${forecast.feelsMin}° to ${forecast.feelsMax}°`
    : null;
  const sunrise = hhmm(forecast.sunrise);
  const sunset = hhmm(forecast.sunset);
  return (
    <section className="event-section" aria-labelledby="event-weather">
      <h3 id="event-weather" className="event-section-title">
        Forecast
      </h3>
      <div className="event-forecast">
        <div className="event-forecast-head">
          <WeatherIcon code={forecast.code} size={22} />
          <div className="event-forecast-main">
            <strong>{forecast.summary}</strong>
            <span>
              {forecast.tempMin}° to {forecast.tempMax}°C
              {feels ? ` · ${feels}` : ""}
              {forecast.uvMax !== null && forecast.uvMax >= 3 ? ` · UV ${forecast.uvMax}` : ""}
            </span>
          </div>
        </div>
        <dl>
          <div>
            <dt>Rain</dt>
            <dd>
              {forecast.rainChance !== null ? `${forecast.rainChance}%` : "–"}
              {forecast.rainMm ? <small>{forecast.rainMm} mm</small> : null}
            </dd>
          </div>
          <div>
            <dt>Wind</dt>
            <dd>
              {forecast.windMaxKmh !== null ? windText(forecast.windMaxKmh, forecast.gustMaxKmh, null) : "–"}
              {forecast.windFrom ? <small>from the {forecast.windFrom}</small> : null}
            </dd>
          </div>
          <div>
            <dt>Sunrise</dt>
            <dd>{sunrise ?? "–"}</dd>
          </div>
          <div>
            <dt>Sunset</dt>
            <dd>{sunset ?? "–"}</dd>
          </div>
        </dl>
        {hours.length ? (
          <details className="event-forecast-hours">
            <summary>
              Hour by hour
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <table>
              <caption className="sr-only">Hourly forecast. Hours during the walk are marked.</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">
                    <span className="sr-only">Sky</span>
                  </th>
                  <th scope="col">Temp</th>
                  <th scope="col">Rain</th>
                  <th scope="col">Wind km/h</th>
                </tr>
              </thead>
              <tbody>
                {hours.map((h) => (
                  <tr key={h.hour} className={`${h.walk ? "is-walk" : ""}${h.isDay ? "" : " is-night"}`}>
                    <th scope="row">
                      {pad(h.hour)}
                      {h.walk ? <span className="sr-only"> (walking)</span> : null}
                    </th>
                    <td className="event-forecast-sky" title={h.summary}>
                      <WeatherIcon code={h.code} isDay={h.isDay} size={16} />
                      <span className="sr-only">{h.summary}</span>
                    </td>
                    <td>
                      {h.temp}°
                      {h.feelsLike !== null && h.feelsLike < h.temp - 1 ? <small>feels {h.feelsLike}°</small> : null}
                    </td>
                    <td>
                      {h.rainChance !== null ? `${h.rainChance}%` : "–"}
                      {h.rainMm ? <small>{h.rainMm} mm</small> : null}
                    </td>
                    <td>{h.windKmh !== null ? windText(h.windKmh, h.gustKmh, h.windFrom, false) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="event-forecast-key">
              <span aria-hidden="true" /> During the walk
            </p>
          </details>
        ) : null}
      </div>
    </section>
  );
}

/** Holds the forecast's place while it loads, so the page below doesn't jump. */
function ForecastPlaceholder() {
  return (
    <section className="event-section" aria-busy="true">
      <h3 className="event-section-title">Forecast</h3>
      <div className="event-forecast is-loading" aria-hidden="true">
        <span className="skeleton" />
      </div>
    </section>
  );
}

export default async function EventPage({ params, searchParams }: Params & { searchParams?: Promise<{ from?: string; walk?: string }> }) {
  const [member, event] = await Promise.all([getCurrentMember(), params.then(({ id }) => getEvent(id))]);
  if (!member) redirect("/auth/signin");
  if (!event || !(await canSeeEvent(event, viewerOf(member)))) notFound();

  const details = eventDetails(event);
  const [places, plan, route] = await Promise.all([
    loadPlaces([details.start, details.finish].filter((p): p is string => Boolean(p))),
    getEventPlan(event.suu_event_id),
    getEventRoute(event.suu_event_id),
  ]);
  const [hike] = mapHikes([event], places);
  const pinned = hike && (hike.start || hike.finish) ? hike : null;
  const mapRoute = route ? mapRouteOf(route) : null;
  const distanceKm = details.distanceKm ?? (route && route.distance_m > 0 ? route.distance_m / 1000 : null);
  const ascentM = details.ascentM ?? route?.ascent_m ?? null;
  const soon = countdown(event);
  const walking = details.kind === "hike" || details.kind === "walk" || details.kind === "trip";
  // Streamed in behind the rest of the page, so a slow forecast never holds it up.
  const forecastSpot = pinned?.start ?? mapRoute?.start ?? pinned?.finish ?? null;
  const forecastAt = walking && event.status !== "cancelled" && inForecastWindow(event.starts_at) ? forecastSpot : null;
  const editable = Boolean(event.suu_event_id) && canEditPlan(profileOf(member));
  const planMeet = plan?.meet_at || plan?.meet_point
    ? [plan.meet_at ? clock.format(new Date(plan.meet_at)) : null, plan.meet_point].filter(Boolean).join(" · ")
    : null;
  const meet = planMeet ?? details.meetingPoint;
  // The organiser's own map link wins; otherwise Google directions to the start.
  const directions =
    event.location_url ??
    directionsUrl(pinned?.start ?? mapRoute?.start ?? null, details.start ? `${details.start} station` : details.meetingPoint);
  // A GPX link already drawn and downloadable here doesn't need its own button too.
  const routeLink = plan?.route_url && plan.route_url !== route?.source_url ? plan.route_url : null;

  const routeFacts = route ? (
    <p className="event-route-facts">
      <Route size={15} aria-hidden="true" />
      <span>
        {route.osmaps_route_id ? "Route from the club's OS Maps" : "GPX route"} · {formatKm(route.distance_m / 1000)}
        {route.ascent_m !== null ? ` · ${formatAscent(route.ascent_m)} up` : ""}
      </span>
    </p>
  ) : null;

  const stats = [
    distanceKm !== null ? { label: "Distance", value: formatKm(distanceKm) } : null,
    ascentM !== null ? { label: "Ascent", value: formatAscent(ascentM) } : null,
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

  // Opened from a walk's sign-up sheet on the rota: the back link returns to that sheet.
  const query = searchParams ? await searchParams : undefined;
  const fromRota = query?.from === "rota";
  const backHref = fromRota
    ? `/portal/events/rota${query?.walk ? `?${new URLSearchParams({ open: query.walk })}` : ""}`
    : "/portal/events";

  return (
    <article className={`event-page kind-${details.kind}${event.status === "cancelled" ? " is-cancelled" : ""}`}>
      <Link href={backHref} className="event-back">
        <ChevronLeft size={18} aria-hidden="true" />
        {fromRota ? "Back to sign-up" : "Events"}
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

      {forecastAt ? (
        <Suspense fallback={<ForecastPlaceholder />}>
          <WalkForecast at={forecastAt} event={event} />
        </Suspense>
      ) : null}

      {day.length || pinned || mapRoute || directions || routeLink ? (
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
            {pinned || mapRoute ? (
              <RouteView hikes={pinned ? [pinned] : []} route={mapRoute} label={`Map of ${details.name}`}>
                {routeFacts}
              </RouteView>
            ) : (
              routeFacts
            )}
            <div className="event-day-actions">
              {route ? (
                // Desktop only: on a phone the route lives on the map above, not in a file.
                <a className="kit-btn event-gpx-download" href={`/api/events/${event.id}/gpx`} download>
                  <Download size={15} aria-hidden="true" />
                  Download GPX
                </a>
              ) : null}
              {directions ? (
                <OpenExternal className="kit-btn" href={directions}>
                  {event.location_url ? <MapPin size={15} aria-hidden="true" /> : <Navigation size={15} aria-hidden="true" />}
                  Directions
                  <ExternalLink size={13} aria-hidden="true" />
                </OpenExternal>
              ) : null}
              {routeLink ? (
                <OpenExternal className="kit-btn" href={routeLink}>
                  <Route size={15} aria-hidden="true" />
                  {routeLinkLabel(routeLink)}
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
