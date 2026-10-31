// The [CLUB] tag on a route's name in OS Maps. No imports, so the browser can
// use it too (the plan editor) without pulling the server-side catalogue in.

export const CLUB_ROUTE_TAG = "[CLUB]";
const CLUB_SUFFIX = /\s*\[club\]\s*$/i;

/** Ends in [CLUB] (any case, stray spaces forgiven): one of the club's own routes. */
export function isClubRoute(name: string | null | undefined): boolean {
  return CLUB_SUFFIX.test(name ?? "");
}

/** The name without its [CLUB] tag, which is a filter, not part of the name. */
export function routeDisplayName(name: string): string {
  return name.replace(CLUB_SUFFIX, "").trim() || name;
}
