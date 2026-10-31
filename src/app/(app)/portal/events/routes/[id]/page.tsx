import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Lock, Route, TriangleAlert } from "lucide-react";
import { OpenExternal } from "@/components/OpenExternal";
import { RouteView } from "@/components/RouteView";
import { profileOf } from "@/lib/access";
import { eventDetails, formatAscent, formatKm } from "@/lib/eventDetails";
import { longDate } from "@/lib/eventList";
import { mapRouteOf } from "@/lib/eventRoutes";
import { osmapsShareUrl } from "@/lib/osmaps";
import { canSeeLibraryRoute, routeDisplayName } from "@/lib/routeCatalogue";
import { getLibraryLinks, getLibraryRoute, walksFor } from "@/lib/routeLibrary";
import { isPlotted } from "@/lib/routeShape";
import { getCurrentMember } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

/** The page and its metadata both read the route once. */
const routeFor = cache(getLibraryRoute);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const [member, route] = await Promise.all([getCurrentMember(), params.then(({ id }) => routeFor(id))]);
  const visible = member && route && canSeeLibraryRoute(route, profileOf(member));
  return { title: `${visible ? routeDisplayName(route.name) : "Route"} | UCL Hiking Club` };
}

/**
 * One route from the club's OS Maps library: its line on the map with the
 * climb beneath, the way into OS Maps, the GPX, and the walks that used it.
 * Committee only, and only a route tagged [CLUB] in OS Maps; anyone else, or
 * any other route, gets a 404, as the GPX endpoint does.
 */
export default async function RoutePage({ params }: Params) {
  const [member, route] = await Promise.all([getCurrentMember(), params.then(({ id }) => routeFor(id))]);
  if (!member) redirect("/auth/signin");
  if (!route || !canSeeLibraryRoute(route, profileOf(member))) notFound();

  const mapRoute = mapRouteOf(route);
  const walks = await walksFor(await getLibraryLinks(route.id), member);
  const plotted = isPlotted(route.segments);
  const now = new Date().toISOString();
  const byDate = [...walks].sort((a, b) => (b.starts_at ?? "").localeCompare(a.starts_at ?? ""));
  const walked = walks.filter((w) => w.starts_at && w.starts_at <= now).length;

  const stats = [
    { label: "Distance", value: formatKm(route.distance_m / 1000) },
    route.ascent_m !== null ? { label: "Ascent", value: formatAscent(route.ascent_m) } : null,
    { label: "Walked", value: walked === 1 ? "Once" : walked ? `${walked} times` : "Not yet" },
  ].filter((s) => s !== null);

  return (
    <article className="event-page route-page">
      <Link href="/portal/events/routes" className="event-back">
        <ChevronLeft size={18} aria-hidden="true" />
        Routes
      </Link>

      <header className="route-page-head">
        <span className="event-eyebrow">OS Maps route</span>
        <h2>{routeDisplayName(route.name)}</h2>
        {route.private ? (
          <p className="route-tags">
            <span className="route-tag is-private">
              <Lock size={11} aria-hidden="true" /> Private in OS Maps
            </span>
          </p>
        ) : null}
      </header>

      <dl className="event-stats">
        {stats.map((s) => (
          <div key={s.label}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>

      <section className="event-section" aria-labelledby="route-map">
        <h3 id="route-map" className="event-section-title">
          The route
        </h3>
        <div className="event-day">
          {mapRoute ? (
            <RouteView hikes={[]} route={mapRoute} label={`Map of ${routeDisplayName(route.name)}`}>
              {plotted ? (
                <p className="route-note">
                  <TriangleAlert size={15} aria-hidden="true" />
                  <span>Drawn without snapping to paths; the line is approximate.</span>
                </p>
              ) : null}
            </RouteView>
          ) : (
            <p className="route-note is-plain">
              <Route size={15} aria-hidden="true" />
              <span>This route has no track to draw.</span>
            </p>
          )}
          <div className="event-day-actions">
            <OpenExternal className="kit-btn primary" href={osmapsShareUrl(route.id)}>
              <Route size={15} aria-hidden="true" />
              Open in OS Maps
              <ExternalLink size={13} aria-hidden="true" />
            </OpenExternal>
            {mapRoute ? (
              <a className="kit-btn" href={`/api/osmaps/routes/${encodeURIComponent(route.id)}/gpx`} download>
                <Download size={15} aria-hidden="true" />
                Download GPX
              </a>
            ) : null}
          </div>
          {route.private ? (
            // Only committee see Routes at all, and they're the ones with the club's login.
            <p className="route-note is-plain">
              <Lock size={15} aria-hidden="true" />
              <span>Private in OS Maps: the link opens only when signed in to the club&apos;s OS Maps account. Download GPX works without it.</span>
            </p>
          ) : null}
        </div>
      </section>

      <section className="event-section" aria-labelledby="route-walks">
        <h3 id="route-walks" className="event-section-title">
          Walks on this route
        </h3>
        {byDate.length ? (
          <ol className="events-list route-walks">
            {byDate.map((event) => (
              <li key={event.id}>
                <Link href={`/portal/events/${event.id}`}>
                  <span>
                    <strong>{eventDetails(event).name}</strong>
                    {event.starts_at ? <small>{longDate(event.starts_at)}</small> : null}
                  </span>
                  <ChevronRight size={18} aria-hidden="true" className="event-chevron" />
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="event-meta">No walk in the app has used this route yet.</p>
        )}
      </section>
    </article>
  );
}
