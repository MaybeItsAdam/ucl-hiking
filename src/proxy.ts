import { NextResponse, type NextRequest } from "next/server";
import { readSessionToken, sessionCookieName } from "@/lib/session";

// Marker the native shell appends to its user agent (capacitor.config.ts).
const APP_USER_AGENT = "UCLHikingApp";

/**
 * Opening the phone app starts at the club homepage, which is the website's
 * front door. A signed-in member opening the app wants their portal instead, so
 * send the app's cold launch there. Only a launch: a tap on the brand link
 * inside the app carries a Referer and still reaches the homepage.
 */
export async function proxy(request: NextRequest) {
  if (!request.headers.get("user-agent")?.includes(APP_USER_AGENT)) return;
  if (request.headers.get("referer")) return;
  const token = request.cookies.get(sessionCookieName())?.value;
  if (!token || !(await readSessionToken(token))) return;
  return NextResponse.redirect(new URL("/portal", request.url));
}

export const config = {
  matcher: "/",
};
