import { can, type AccessProfile } from "@/lib/access";

/**
 * The photo archive: a Google Photos shared-album link per trip.
 *
 * Why links and not an integration: since Google's 2025 changes the Photos
 * Library API only lets an app read albums the app itself created, and never a
 * person's own library or the albums shared with them. So the committee paste
 * each trip's shared-album link, and the app decides who to show it to.
 *
 * Be clear about what that gating is. A shared album opens for anyone holding
 * its link, signed in to Google or not. Showing a trip's album only to the
 * people who were on it keeps it out of everyone else's way; it does not stop
 * someone who has the link from forwarding it.
 */

/** Hosts a Google Photos shared-album link lives on. */
const ALBUM_HOSTS = new Set(["photos.app.goo.gl", "photos.google.com"]);

/**
 * The stored form of an album link, `{ url: null }` to remove it, or an error to
 * show. Only Google Photos links: the archive is for albums, and a link here
 * is shown as one.
 */
export function normalizeAlbumUrl(input: unknown): { url: string | null } | { error: string } {
  if (input === null || input === undefined) return { url: null };
  if (typeof input !== "string") return { error: "Paste the album's link." };
  const raw = input.trim();
  if (!raw) return { url: null };
  if (raw.length > 500) return { error: "That link is too long." };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: "That isn't a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "Paste a Google Photos link (https://photos.app.goo.gl/…)." };
  if (!ALBUM_HOSTS.has(url.hostname.toLowerCase()) || url.pathname.replace(/\/+$/, "") === "") {
    return { error: "Paste a Google Photos shared-album link (https://photos.app.goo.gl/… or photos.google.com/share/…)." };
  }
  url.protocol = "https:";
  return { url: url.toString() };
}

/** Who attaches album links to trips: the committee, as they edit events. */
export function canManageAlbums(profile: AccessProfile): boolean {
  return can(profile, "manage_walks");
}

export interface AlbumViewer {
  /** The committee (and up) see every album. */
  seesAll: boolean;
  /** SU ids of the trips this person was on. */
  attended: ReadonlySet<string>;
}

/** Whether this viewer is shown a trip's album. */
export function albumVisible(eventSuuId: string, viewer: AlbumViewer): boolean {
  return viewer.seesAll || viewer.attended.has(eventSuuId);
}

export function visibleAlbums<T extends { event_suu_id: string }>(albums: T[], viewer: AlbumViewer): T[] {
  return albums.filter((album) => albumVisible(album.event_suu_id, viewer));
}

/**
 * The trips someone was on: a ticket or a leader's walk-up on the register
 * that wasn't refunded (matched by account, or by email for a row the sync
 * couldn't tie to an account), or leading or backmarking it.
 */
export function attendedEventIds(
  person: { id: string; email: string | null },
  attendees: { event_suu_id: string; member_id: string | null; email: string | null; removed: boolean }[],
  plans: { event_suu_id: string; leader_member_id: string | null; backmarker_member_id: string | null }[] = [],
): Set<string> {
  const email = person.email?.toLowerCase() ?? null;
  const ids = new Set<string>();
  for (const row of attendees) {
    if (row.removed) continue;
    if (row.member_id === person.id || (email && !row.member_id && row.email?.toLowerCase() === email)) ids.add(row.event_suu_id);
  }
  for (const plan of plans) {
    if (plan.leader_member_id === person.id || plan.backmarker_member_id === person.id) ids.add(plan.event_suu_id);
  }
  return ids;
}

/**
 * The club-wide album, if the committee have made one: the short link at this
 * path (Club → Links) points at it. Shown to everyone who can open the archive.
 * Like every /media/ short link it is also a public redirect, so it suits
 * photos the club is happy for anyone to see.
 */
export const ALL_PHOTOS_LINK_PATH = "/media/photos";
