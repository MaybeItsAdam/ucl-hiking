/**
 * Short links the committee runs: uclhiking.org/e/trip-signup and the like,
 * pointed at whatever form, chat or document is current. They live in the
 * `club_links` table and are served by `src/app/e` and `src/app/media`, so the
 * committee repoints a printed QR code without a deploy.
 *
 * Only paths under these prefixes can be links: the app owns everything else.
 */
export const CLUB_LINK_PREFIXES = ["e", "media"] as const;

export interface ClubLink {
  id: number;
  path: string;
  destination: string;
  note: string;
  updated_at: string;
}

const SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * The stored form of a link's path, or an error to show. Accepts what the
 * committee is likely to paste: "e/trip", "/e/trip/", or a full URL on the site.
 * Case is kept for display; matching ignores it, as Next's own redirects do.
 */
export function normalizeLinkPath(input: string): { path: string } | { error: string } {
  let raw = input.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).pathname;
    } catch {
      return { error: "That address isn't a link on the site." };
    }
  }
  const segments = raw.split("/").filter(Boolean);
  const [prefix, ...rest] = segments;
  if (!prefix || !CLUB_LINK_PREFIXES.includes(prefix.toLowerCase() as (typeof CLUB_LINK_PREFIXES)[number])) {
    return { error: "Short links start with /e/ or /media/." };
  }
  if (!rest.length) return { error: "Add a name after the /e/ or /media/." };
  if (!rest.every((s) => SEGMENT.test(s))) {
    return { error: "Use letters, numbers, - and _ in the name." };
  }
  const path = `/${prefix.toLowerCase()}/${rest.join("/")}`;
  if (path.length > 200) return { error: "That name is too long." };
  return { path };
}

/** The key a link is matched on: the path, ignoring case. */
export function linkKey(path: string): string {
  return path.toLowerCase();
}

/** The path a request for these catch-all segments is looking for. */
export function requestedPath(prefix: (typeof CLUB_LINK_PREFIXES)[number], segments: string[]): string {
  return `/${prefix}/${segments.map((s) => safeDecode(s)).join("/")}`;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * A destination is a web address, or a path on this site. Anything else
 * (javascript:, mailto:, "//evil.example") is refused.
 */
export function normalizeDestination(input: string): { destination: string } | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "Paste where the link should go." };
  if (raw.length > 2000) return { error: "That address is too long." };
  if (raw.startsWith("//")) return { error: "Start the address with https://." };
  if (raw.startsWith("/")) return { destination: raw };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: "That isn't a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "Links go to a web address (https://…)." };
  if (!url.hostname.includes(".")) return { error: "That isn't a web address." };
  return { destination: url.toString() };
}

/** Whether following `destination` from `path` would land straight back on it. */
export function pointsAtItself(path: string, destination: string): boolean {
  if (!destination.startsWith("/")) return false;
  const target = destination.split(/[?#]/)[0].replace(/\/+$/, "");
  return linkKey(target) === linkKey(path);
}
