import { NextResponse } from "next/server";
import { POST as exchange } from "../exchange/route";

// Email/password sign-in for the App Store / Play Store reviewer accounts.
// Reviewers have no UCL account, and the normal button goes straight to UCL's
// Entra login, so they never see Toolbox's own hidden reviewer dialog. This
// route asks Toolbox's /api/auth/backdoor on the reviewer's behalf and feeds
// the resulting Toolbox token through the same exchange as a UCL sign-in.
// Toolbox holds the passwords and rate-limits attempts; this route only
// forwards the two reviewer addresses so it can't become a general proxy.
const REVIEW_EMAILS = new Set([
  "apple@adamscampustoolbox.org.uk",
  "android@adamscampustoolbox.org.uk",
]);

function toolboxUrl(): string {
  return (process.env.TOOLBOX_URL || "https://www.adamscampustoolbox.org.uk").replace(/\/$/, "");
}

const invalid = () => NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!REVIEW_EMAILS.has(email) || !password) return invalid();

  let res: Response;
  try {
    res = await fetch(`${toolboxUrl()}/api/auth/backdoor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return NextResponse.json({ error: "Identity service is unavailable" }, { status: 502 });
  }
  if (res.status === 429) {
    return NextResponse.json({ error: "Too many attempts. Try again in ten minutes." }, { status: 429 });
  }
  if (!res.ok) return invalid();

  const token = res.headers
    .getSetCookie()
    .map((cookie) => /^user_token=([^;]+)/.exec(cookie)?.[1])
    .find(Boolean);
  if (!token) {
    return NextResponse.json({ error: "Identity service returned no session" }, { status: 502 });
  }

  return exchange(
    new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }),
  );
}
