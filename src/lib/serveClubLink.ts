import { notFound, redirect } from "next/navigation";
import { requestedPath, type CLUB_LINK_PREFIXES } from "@/lib/clubLinks";
import { findClubLinkDestination } from "@/lib/clubLinkStore";

/**
 * Send a short-link visitor on, keeping any query string they arrived with as
 * Next's static redirects did. A temporary (307) redirect, so a browser never
 * caches a destination the committee may change.
 */
export async function serveClubLink(
  prefix: (typeof CLUB_LINK_PREFIXES)[number],
  segments: string[],
  query: Record<string, string | string[] | undefined>,
): Promise<never> {
  const destination = await findClubLinkDestination(requestedPath(prefix, segments));
  if (!destination) notFound();
  redirect(withQuery(destination, query));
}

function withQuery(destination: string, query: Record<string, string | string[] | undefined>): string {
  const entries = Object.entries(query).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v === undefined ? [] : [[k, v]]));
  if (!entries.length) return destination;
  const url = new URL(destination, "https://placeholder.invalid");
  for (const [k, v] of entries) if (!url.searchParams.has(k)) url.searchParams.append(k, v);
  return url.origin === "https://placeholder.invalid" ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}
