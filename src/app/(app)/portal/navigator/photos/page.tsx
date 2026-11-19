import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExternalLink, Images } from "lucide-react";
import { AlbumEditor } from "@/components/AlbumEditor";
import { NavigatorSubnav } from "@/components/NavigatorSubnav";
import { OpenExternal } from "@/components/OpenExternal";
import { getArchiveViewer } from "@/lib/archiveViewer";
import { findClubLinkDestination } from "@/lib/clubLinkStore";
import { eventDetails } from "@/lib/eventDetails";
import { dedupeEvents } from "@/lib/eventDuplicates";
import { longDate } from "@/lib/eventList";
import { getEventsBySuuIds, getEventsInClubYear } from "@/lib/events";
import { clubYear } from "@/lib/hikeMap";
import { listAlbums, tripsAttendedBy } from "@/lib/photoAlbumStore";
import { ALL_PHOTOS_LINK_PATH, visibleAlbums } from "@/lib/photoAlbums";
import type { SUEvent } from "@/lib/types";

export const metadata: Metadata = { title: "Photo archive | UCL Hiking Club" };

const newestFirst = (a: SUEvent, b: SUEvent) => (b.starts_at ?? "").localeCompare(a.starts_at ?? "");

/**
 * The trips' Google Photos albums. Each member sees the albums of the trips
 * they were on, alumni included (lib/alumni); the committee see them all and
 * attach the links. Showing an album only to its trip is about keeping it out
 * of everyone else's way: a shared-album link opens for whoever has it.
 */
export default async function PhotoArchivePage() {
  const viewer = await getArchiveViewer();
  if (!viewer) redirect("/auth/signin");

  const now = new Date();
  const [albums, attended, allPhotos] = await Promise.all([
    listAlbums(),
    viewer.seesAll ? Promise.resolve(new Set<string>()) : tripsAttendedBy(viewer),
    findClubLinkDestination(ALL_PHOTOS_LINK_PATH),
  ]);
  const shown = visibleAlbums(albums, { seesAll: viewer.seesAll, attended });
  const urlBySuuId = new Map(shown.map((album) => [album.event_suu_id, album.url]));
  const trips = dedupeEvents(await getEventsBySuuIds([...urlBySuuId.keys()]), urlBySuuId.keys()).sort(newestFirst);

  // The committee also get this year's and last year's past trips that have no album yet, to add one.
  let missing: SUEvent[] = [];
  if (viewer.seesAll) {
    const year = clubYear(now);
    const recent = [...(await getEventsInClubYear(year - 1)), ...(await getEventsInClubYear(year))];
    missing = dedupeEvents(recent)
      .filter((e) => e.suu_event_id && !urlBySuuId.has(e.suu_event_id))
      .filter((e) => e.status !== "cancelled" && e.starts_at && new Date(e.starts_at) < now)
      .sort(newestFirst);
  }

  return (
    <article className="navigator-library photo-archive">
      <NavigatorSubnav active="photos" />
      <header className="navigator-intro">
        <p className="event-eyebrow">Photo archive</p>
        <p>
          {viewer.seesAll
            ? "Every trip's Google Photos album. Members see the albums of the trips they were on."
            : "The Google Photos albums from the trips you've been on."}
        </p>
      </header>

      {allPhotos ? (
        <section className="event-section" aria-labelledby="photos-club">
          <h3 id="photos-club" className="event-section-title">
            The club album
          </h3>
          <div className="calendar-feed-actions">
            <OpenExternal className="kit-btn" href={allPhotos}>
              <Images size={15} aria-hidden="true" />
              All club photos
              <ExternalLink size={13} aria-hidden="true" />
            </OpenExternal>
          </div>
        </section>
      ) : null}

      <section className="event-section" aria-labelledby="photos-trips">
        <h3 id="photos-trips" className="event-section-title">
          {viewer.seesAll ? "Trips with an album" : "Your trips"}
        </h3>
        {trips.length ? (
          <ul className="kit-list">
            {trips.map((event) => (
              <TripRow key={event.id} event={event} url={urlBySuuId.get(event.suu_event_id ?? "") ?? null} edit={viewer.seesAll} />
            ))}
          </ul>
        ) : (
          <p className="day-note">
            {viewer.seesAll
              ? "No albums yet. Add one to a past trip below, or from the trip's event page."
              : "No albums from your trips yet. Once the committee add a trip's album, it turns up here for everyone who was on it."}
          </p>
        )}
      </section>

      {viewer.seesAll && missing.length ? (
        <section className="event-section" aria-labelledby="photos-missing">
          <h3 id="photos-missing" className="event-section-title">
            Past trips without an album
          </h3>
          <ul className="kit-list">
            {missing.map((event) => (
              <TripRow key={event.id} event={event} url={null} edit />
            ))}
          </ul>
        </section>
      ) : null}

      <p className="day-note photo-archive-note">
        {viewer.seesAll
          ? "Albums are Google Photos shared links. The app only decides who it shows each one to: anyone with a link can open it and pass it on."
          : "Albums are Google Photos shared links: please don't pass them on beyond the people who were there."}
      </p>
    </article>
  );
}

function TripRow({ event, url, edit }: { event: SUEvent; url: string | null; edit: boolean }) {
  const name = eventDetails(event).name;
  return (
    <li className="kit-item photo-trip">
      <span className="photo-trip-main">
        <span className="kit-item-name">{name}</span>
        {event.starts_at ? <span className="kit-item-desc">{longDate(event.starts_at)}</span> : null}
      </span>
      <span className="photo-trip-actions">
        {url ? (
          <OpenExternal className="kit-btn" href={url}>
            Open album
            <ExternalLink size={13} aria-hidden="true" />
          </OpenExternal>
        ) : null}
        {edit ? <AlbumEditor eventId={event.id} eventName={name} url={url} /> : null}
      </span>
    </li>
  );
}
