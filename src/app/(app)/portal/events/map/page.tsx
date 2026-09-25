import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, MapPinOff } from "lucide-react";
import { DifficultyChip } from "@/components/EventFacts";
import { HikeMap } from "@/components/HikeMap";
import { formatAscent, formatKm } from "@/lib/eventDetails";
import { getEventsInClubYear } from "@/lib/events";
import { clubYear, clubYearLabel, eventPlaces, mapHikes, onMap, yearStats } from "@/lib/hikeMap";
import { loadPlaces } from "@/lib/places";
import { getCurrentMember } from "@/lib/session";

export const metadata: Metadata = {
  title: "Walk map | UCL Hiking Club",
};

/** The first club year (2025–26) with events in this app. */
const FIRST_YEAR = 2025;

export default async function WalkMapPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const member = await getCurrentMember();
  if (!member) redirect("/auth/signin");

  const current = clubYear();
  const asked = Number((await searchParams).year);
  const year = Number.isInteger(asked) && asked >= FIRST_YEAR && asked <= current ? asked : current;

  const events = await getEventsInClubYear(year);
  const places = await loadPlaces(eventPlaces(events));
  const hikes = mapHikes(events, places);
  const stats = yearStats(hikes);
  const pinned = hikes.filter(onMap);
  // Newest first below the map: the walk you went on last is the one you look for.
  const list = [...hikes].reverse();

  return (
    <article className="walkmap-page">
      <Link href="/portal/events" className="event-back">
        <ChevronLeft size={18} aria-hidden="true" />
        Events
      </Link>

      <header className="walkmap-head">
        <div>
          <span className="event-eyebrow">Where we walked</span>
          <h2>{year === current ? `${clubYearLabel(year)} so far` : clubYearLabel(year)}</h2>
        </div>
        <nav className="walkmap-years" aria-label="Year">
          {year > FIRST_YEAR ? (
            <Link href={`/portal/events/map?year=${year - 1}`} aria-label={clubYearLabel(year - 1)}>
              <ChevronLeft size={16} aria-hidden="true" />
              {clubYearLabel(year - 1)}
            </Link>
          ) : null}
          {year < current ? (
            <Link href={year + 1 === current ? "/portal/events/map" : `/portal/events/map?year=${year + 1}`} aria-label={clubYearLabel(year + 1)}>
              {clubYearLabel(year + 1)}
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          ) : null}
        </nav>
      </header>

      <dl className="walkmap-stats">
        <div>
          <dt>Walks</dt>
          <dd>{stats.done}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{stats.km ? formatKm(stats.km) : "–"}</dd>
        </div>
        <div>
          <dt>Climbed</dt>
          <dd>{stats.ascentM ? formatAscent(stats.ascentM) : "–"}</dd>
        </div>
        <div>
          <dt>Places</dt>
          <dd>{stats.places}</dd>
        </div>
      </dl>

      {pinned.length ? (
        <>
          <HikeMap hikes={pinned} interactive label={`Map of the club’s walks in ${clubYearLabel(year)}`} />
          <p className="walkmap-legend">
            <span><span className="hike-pin is-beginner is-key" /> Beginner</span>
            <span><span className="hike-pin is-moderate is-key" /> Moderate</span>
            <span><span className="hike-pin is-challenging is-key" /> Challenging</span>
            <span><span className="hike-pin is-difficult is-key" /> Difficult</span>
            {stats.upcoming ? <span><span className="hike-pin is-none is-upcoming is-key" /> Coming up</span> : null}
          </p>
        </>
      ) : (
        <div className="events-empty">
          <MapPinOff size={28} aria-hidden="true" />
          <p>
            {hikes.length
              ? "These walks haven’t been put on the map yet. Pins are added each morning when the events sync."
              : `No walks in ${clubYearLabel(year)} yet.`}
          </p>
        </div>
      )}

      {stats.longest || stats.steepest ? (
        <div className="walkmap-records">
          {stats.longest?.distanceKm ? (
            <Link href={`/portal/events/${stats.longest.id}`}>
              <span className="event-eyebrow">Longest day</span>
              <strong>{stats.longest.name}</strong>
              <span>{formatKm(stats.longest.distanceKm)}</span>
            </Link>
          ) : null}
          {stats.steepest?.ascentM ? (
            <Link href={`/portal/events/${stats.steepest.id}`}>
              <span className="event-eyebrow">Most climbing</span>
              <strong>{stats.steepest.name}</strong>
              <span>{formatAscent(stats.steepest.ascentM)}</span>
            </Link>
          ) : null}
        </div>
      ) : null}

      {list.length ? (
        <section aria-labelledby="walkmap-list">
          <h3 id="walkmap-list" className="events-month">
            Every walk
          </h3>
          <ol className="events-list walkmap-list">
            {list.map((hike) => (
              <li key={hike.id}>
                <Link href={`/portal/events/${hike.id}`} className={`walkmap-row${hike.upcoming ? " is-upcoming" : ""}`}>
                  <span className={`hike-pin is-${hike.difficulty ?? "none"}${hike.upcoming ? " is-upcoming" : ""}`}>
                    {hike.n}
                  </span>
                  <span className="walkmap-row-text">
                    <strong>{hike.name}</strong>
                    <span>
                      {hike.dateLabel}
                      {hike.upcoming ? " · coming up" : ""}
                      {hike.distanceKm ? ` · ${formatKm(hike.distanceKm)}` : ""}
                      {!onMap(hike) ? " · not on the map" : ""}
                    </span>
                  </span>
                  {hike.difficulty ? <DifficultyChip difficulty={hike.difficulty} /> : null}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}
