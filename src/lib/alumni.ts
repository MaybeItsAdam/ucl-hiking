import type { AppPage } from "@/lib/app-pages";

/**
 * Alumni: former members a principal has let back in to read the Navigator
 * and see the photo albums of the trips they went on, and nothing else.
 *
 * How that holds server-side: every page and API in the app finds its viewer
 * through getCurrentMember() (lib/session), which turns away anyone revoked
 * by the member sync or past their expiry. An alumnus is exactly such a
 * person, so they are refused everywhere by default. Only the routes in
 * ALUMNI_ROUTES ask getArchiveViewer() (lib/archiveViewer) instead, which also
 * accepts a lapsed member with an alumni grant. The grant lives in its own
 * table (`alumni`), so the sync never wipes it.
 *
 * A current member who also holds a grant is simply a member: the grant only
 * matters once their membership lapses.
 */

/** The tabs an alumnus gets: the Navigator (which holds the photo archive) and their settings. */
export const ALUMNI_PAGES: readonly AppPage[] = ["navigator", "settings"];

/**
 * Every route that lets an alumnus in. Each one reads its viewer through
 * getArchiveViewer(); a test checks that no other route does. The account
 * page and sign-out already work from the session alone, as they do for any
 * lapsed member, so they can see their details, sign out or delete their
 * account.
 */
export const ALUMNI_ROUTES: readonly string[] = [
  "/portal",
  "/portal/navigator",
  "/portal/navigator/[issue]",
  "/portal/navigator/photos",
  "/api/navigator/[issue]",
];

/** Whether an alumnus may open this path (pages and APIs). */
export function alumnusMayOpen(pathname: string): boolean {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/portal" || path === "/account") return true;
  if (path === "/portal/navigator" || path.startsWith("/portal/navigator/")) return true;
  if (path.startsWith("/api/navigator/")) return true;
  if (path === "/api/auth/logout" || path === "/api/account/delete") return true;
  return false;
}

export interface StandingRow {
  revoked_at: string | null;
  membership_expires_at: string | null;
}

/** Whether a members row is a current member: not revoked by the sync and not expired. */
export function isCurrentMember(row: StandingRow, now = new Date()): boolean {
  if (row.revoked_at) return false;
  return !(row.membership_expires_at && new Date(row.membership_expires_at) < now);
}

export type ArchiveStanding = "member" | "alumnus" | null;

/**
 * Who someone is to the archive: a current member, an alumnus (lapsed, with a
 * grant), or nobody. `granted` null means the grant couldn't be read, which
 * counts as no.
 */
export function archiveStanding(row: StandingRow | null, granted: boolean | null, now = new Date()): ArchiveStanding {
  if (!row) return null;
  if (isCurrentMember(row, now)) return "member";
  return granted === true ? "alumnus" : null;
}

/** Whether sign-in should let this person in as an alumnus rather than turn them away. */
export function signsInAsAlumnus(row: StandingRow | null, granted: boolean | null, now = new Date()): boolean {
  return archiveStanding(row, granted, now) === "alumnus";
}
