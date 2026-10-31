import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Lock, Route } from "lucide-react";
import { EventsSubnav } from "@/components/EventsSubnav";
import { RouteCatalogueSearch } from "@/components/RouteCatalogueSearch";
import { can, profileOf } from "@/lib/access";
import { formatAscent, formatKm } from "@/lib/eventDetails";
import {
  CATALOGUE_SORTS,
  catalogueHref,
  DISTANCE_BANDS,
  filterCatalogue,
  pageOf,
  parseCatalogueQuery,
  walkedLabel,
} from "@/lib/routeCatalogue";
import { getCatalogue, getLibraryThumbnails } from "@/lib/routeLibrary";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = { title: "Routes | UCL Hiking Club" };

const THUMB_W = 72;
const THUMB_H = 54;

/**
 * Every route in the club's OS Maps library, by name: the catalogue a member
 * browses for "where have we walked" and a leader for "what can we run again".
 * Search, band and sort live in the URL and the list is cut into pages on the
 * server, so a phone gets 25 rows and 25 thumbnail paths, never 800 tracks.
 */
export default async function RoutesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");
  const profile = profileOf(member);
  const query = parseCatalogueQuery(await searchParams);

  const catalogue = await getCatalogue(member);
  const matching = filterCatalogue(catalogue, query);
  const { items, page, pages, total } = pageOf(matching, query.page);
  const thumbs = await getLibraryThumbnails(
    items.map((r) => r.id),
    THUMB_W,
    THUMB_H,
  );

  return (
    <article className="events-page routes-page">
      <EventsSubnav active="routes" showRota={can(profile, "lead_walks")} showProgramme={can(profile, "manage_walks")} />

      <RouteCatalogueSearch key={`${query.q}|${query.band}|${query.sort}`} query={query} sorts={CATALOGUE_SORTS} />
      <nav className="programme-filters" aria-label="Distance">
        <Link href={catalogueHref(query, { band: null, page: 1 })} className={query.band ? undefined : "active"} aria-current={query.band ? undefined : "page"}>
          Any length
        </Link>
        {DISTANCE_BANDS.map((b) => (
          <Link
            key={b.key}
            href={catalogueHref(query, { band: b.key, page: 1 })}
            className={query.band === b.key ? "active" : undefined}
            aria-current={query.band === b.key ? "page" : undefined}
          >
            {b.label}
          </Link>
        ))}
      </nav>

      {catalogue.length ? (
        <section aria-labelledby="routes-count">
          <h2 id="routes-count" className="events-month">
            {total === catalogue.length ? `${total} routes` : `${total} of ${catalogue.length} routes`}
          </h2>
          {items.length ? (
            <ol className="events-list routes-list">
              {items.map((r) => {
                const walked = walkedLabel(r);
                const path = thumbs.get(r.id);
                return (
                  <li key={r.id}>
                    <Link href={`/portal/events/routes/${r.id}`} className="route-row">
                      <svg className="route-thumb" viewBox={`0 0 ${THUMB_W} ${THUMB_H}`} aria-hidden="true">
                        {path ? <path d={path} /> : null}
                      </svg>
                      <div className="route-row-body">
                        <h3>{r.name}</h3>
                        <p className="route-row-facts">
                          {formatKm(r.distance_m / 1000)}
                          {r.ascent_m !== null ? ` · ${formatAscent(r.ascent_m)} up` : ""}
                        </p>
                        {walked || r.private ? (
                          <p className="route-tags">
                            {r.private ? (
                              <span className="route-tag is-private">
                                <Lock size={11} aria-hidden="true" /> Private in OS Maps
                              </span>
                            ) : null}
                            {walked ? <span className="route-tag">{walked}</span> : null}
                          </p>
                        ) : null}
                      </div>
                      <ChevronRight size={18} aria-hidden="true" className="event-chevron" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="events-empty">
              <Route size={28} aria-hidden="true" />
              <p>No route matches that. Try fewer words, or another length.</p>
            </div>
          )}
          {pages > 1 ? (
            <nav className="routes-pager" aria-label="Pages">
              {page > 1 ? (
                <Link className="kit-btn" href={catalogueHref(query, { page: page - 1 })} rel="prev">
                  <ChevronLeft size={15} aria-hidden="true" /> Previous
                </Link>
              ) : (
                <span />
              )}
              <span>
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link className="kit-btn" href={catalogueHref(query, { page: page + 1 })} rel="next">
                  Next <ChevronRight size={15} aria-hidden="true" />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </section>
      ) : (
        <div className="events-empty">
          <Route size={28} aria-hidden="true" />
          <p>The club&apos;s OS Maps routes show up here once the morning sync has read them.</p>
        </div>
      )}
    </article>
  );
}
