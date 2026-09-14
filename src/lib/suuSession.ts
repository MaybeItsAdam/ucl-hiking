/**
 * The SU login cookie a principal pastes into the portal: turning it into a
 * Cookie header, and checking it against the SU site before it is saved.
 *
 * The check is one request to studentsunionucl.org/user. Drupal redirects that
 * to /user/<id> for a signed-in session and to /user/login otherwise — the same
 * test as cloud-jobs `session_check.py`.
 */

export const SU_ORIGIN = "https://studentsunionucl.org";

/** Drupal's secure session cookie name on the SU site, used when only a bare value is pasted. */
export const DEFAULT_SU_COOKIE_NAME = "SSESS41428e140b4dc9b07f8c5c3e1fd73f96";

export type SuProbeStatus = "active" | "expired" | "unknown";

export interface SuProbeResult {
  status: SuProbeStatus;
  detail: string;
}

/**
 * `SSESS…=value`, several `name=value; …` pairs, or a bare value → a Cookie
 * header for the SU site. Null when the input can't be one.
 */
export function suCookieHeader(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;
  if (!trimmed.includes("=")) {
    return /^[A-Za-z0-9_-]{16,256}$/.test(trimmed) ? `${DEFAULT_SU_COOKIE_NAME}=${trimmed}` : null;
  }
  const pairs = trimmed
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      return eq > 0 ? [part.slice(0, eq).trim(), part.slice(eq + 1).trim()] : null;
    });
  if (pairs.some((pair) => !pair || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(pair[0]) || !pair[1])) return null;
  return (pairs as string[][]).map(([name, value]) => `${name}=${value}`).join("; ");
}

/** A Cookie header from a Playwright storage state (raw JSON or base64 JSON). */
export function suCookieHeaderFromAuthState(authState: string): string | null {
  const trimmed = authState.trim();
  let json = trimmed;
  if (!trimmed.startsWith("{")) {
    try {
      json = Buffer.from(trimmed, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  try {
    const state = JSON.parse(json) as { cookies?: { name?: unknown; value?: unknown; domain?: unknown }[] };
    const pairs = (state.cookies ?? [])
      .filter((cookie) => String(cookie.domain ?? "").replace(/^\./, "").endsWith("studentsunionucl.org"))
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    return pairs.length ? pairs.join("; ") : null;
  } catch {
    return null;
  }
}

export function classifySuProbe(status: number, location: string | null): SuProbeResult {
  if (status >= 300 && status < 400 && location) {
    let path: string;
    try {
      path = new URL(location, SU_ORIGIN).pathname;
    } catch {
      return { status: "unknown", detail: "The SU site sent an unreadable redirect." };
    }
    if (/^\/user\/\d+\/?$/.test(path)) return { status: "active", detail: "Signed in to the SU site." };
    if (path.startsWith("/user/login")) {
      return { status: "expired", detail: "The SU site no longer accepts this login." };
    }
    return { status: "unknown", detail: `The SU site redirected to ${path}.` };
  }
  return { status: "unknown", detail: `The SU site answered HTTP ${status}, so the login could not be checked.` };
}

export async function probeSuSession(cookieHeader: string): Promise<SuProbeResult> {
  try {
    const response = await fetch(`${SU_ORIGIN}/user`, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { cookie: cookieHeader, "user-agent": "Mozilla/5.0 (compatible; ucl-hiking-session-check/1.0)" },
    });
    return classifySuProbe(response.status, response.headers.get("location"));
  } catch {
    return { status: "unknown", detail: "The SU site could not be reached." };
  }
}
