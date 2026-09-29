/**
 * The club's routes, straight from OS Maps.
 *
 * OS Maps has no public API, but its web app reads routes from
 * consumerplatform.ordnancesurvey.co.uk, and a route shared as "Anyone with
 * link" (or Public) can be read there by its id with no login. So the club's
 * account never signs in from here: a leader pastes a route's share link once,
 * and this fetches the details and GPX, and the daily sync refreshes it when
 * the route is edited.
 *
 * Listing the account's private routes would need the club's password on the
 * server and a scripted Microsoft sign-in, against OS Maps' terms (the login
 * must stay confidential). We don't.
 *
 * The API is undocumented: every call here fails soft, and a walk keeps the
 * last route it was given.
 */

const API = "https://consumerplatform.ordnancesurvey.co.uk/route-api/v1/routes";
const TIMEOUT_MS = 12_000;
const HEADERS = { "app-name": "ucl-hiking", platform: "WEB" };

export class OsmapsError extends Error {}

/** The route id from a share link: explore.osmaps.com/route/12345/some-slug, or osmaps.com/…/route/12345. */
export function osmapsRouteId(link: string | null | undefined): string | null {
  if (!link) return null;
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)osmaps\.com$|(^|\.)ordnancesurvey\.co\.uk$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/\/routes?\/(\d{3,12})(?:\/|$)/);
  return m ? m[1] : null;
}

export function osmapsShareUrl(id: string): string {
  return `https://explore.osmaps.com/route/${id}`;
}

export interface OsmapsDetails {
  id: string;
  name: string;
  /** Changes whenever the route is edited; the sync re-downloads on a change. */
  modifiedAt: string | null;
  version: string | null;
  distanceM: number | null;
  ascentM: number | null;
  descentM: number | null;
  visibility: string | null;
}

async function get(url: string, accept: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { ...HEADERS, Accept: accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new OsmapsError("OS Maps didn't answer. Try again in a minute.");
  }
  if (res.status === 404 || res.status === 403 || res.status === 401) {
    throw new OsmapsError(
      "OS Maps won't show that route. In OS Maps, set it to \"Anyone with link\" (Share › Visibility), then try again.",
    );
  }
  if (!res.ok) throw new OsmapsError(`OS Maps answered ${res.status}. Try again later.`);
  return res;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

export function detailsFrom(id: string, body: unknown): OsmapsDetails {
  const d = (body ?? {}) as {
    version?: unknown;
    metadata?: { name?: unknown; modifiedAt?: unknown; visibility?: unknown };
    characteristics?: { distance?: unknown; elevationAscent?: unknown; elevationDescent?: unknown };
  };
  const name = typeof d.metadata?.name === "string" && d.metadata.name.trim() ? d.metadata.name.trim() : `OS Maps route ${id}`;
  return {
    id,
    name: name.slice(0, 200),
    modifiedAt: typeof d.metadata?.modifiedAt === "string" ? d.metadata.modifiedAt : null,
    version: d.version == null ? null : String(d.version),
    distanceM: num(d.characteristics?.distance),
    ascentM: num(d.characteristics?.elevationAscent),
    descentM: num(d.characteristics?.elevationDescent),
    visibility: typeof d.metadata?.visibility === "string" ? d.metadata.visibility : null,
  };
}

export async function osmapsDetails(id: string): Promise<OsmapsDetails> {
  const res = await get(`${API}/${encodeURIComponent(id)}`, "application/json");
  return detailsFrom(id, await res.json().catch(() => null));
}

export async function osmapsGpx(id: string): Promise<string> {
  const res = await get(`${API}/${encodeURIComponent(id)}?exportTypes=TRK&osExtensions=false`, "application/gpx+xml");
  const text = await res.text();
  if (text.length > 4 * 1024 * 1024) throw new OsmapsError("That route is too long to store.");
  return text;
}

/** Details, then the track: what a stored route needs, with OS Maps' own distance and climb preferred. */
export async function osmapsRoute(id: string) {
  const details = await osmapsDetails(id);
  const gpx = await osmapsGpx(id);
  return { details, gpx };
}

/** "Changed since last time" marker for a route. */
export function stampOf(d: OsmapsDetails): string | null {
  return d.modifiedAt || d.version ? `${d.modifiedAt ?? ""}#${d.version ?? ""}` : null;
}
