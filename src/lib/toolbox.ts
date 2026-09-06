export interface ToolboxIdentity {
  id: string;
  email: string;
  name: string | null;
  isAdmin?: boolean;
}

export const REVIEW_ACCOUNT_EMAILS = [
  "apple@adamscampustoolbox.org.uk",
  "android@adamscampustoolbox.org.uk",
];

export const BUILT_IN_ADMIN_EMAILS = [
  "adam.cleary.24@ucl.ac.uk",
  ...REVIEW_ACCOUNT_EMAILS,
];

export function isToolboxAdmin(identity: ToolboxIdentity): boolean {
  if (identity.isAdmin) return true;
  const email = identity.email.toLowerCase();
  if (BUILT_IN_ADMIN_EMAILS.includes(email)) return true;
  const envAdmins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return envAdmins.includes(email);
}

export function getSocietyName(): string {
  return process.env.NEXT_PUBLIC_SOCIETY_NAME || "UCL Hiking Club";
}

function toolboxUrl(): string {
  return (process.env.TOOLBOX_URL || "https://www.adamscampustoolbox.org.uk").replace(
    /\/$/,
    "",
  );
}

export function getToolboxLoginUrl(returnTo: string): string {
  const url = new URL("/api/auth/entra", toolboxUrl());
  url.searchParams.set("return_to", returnTo);
  return url.toString();
}

export async function verifyToolboxToken(token: string): Promise<ToolboxIdentity | null> {
  const base = toolboxUrl();
  const headers = { Authorization: `Bearer ${token}` };

  // Try /api/auth/status first (returns session user + isAdmin from Toolbox)
  let body: Record<string, unknown> | null = null;
  try {
    const statusRes = await fetch(`${base}/api/auth/status`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (statusRes.ok) {
      body = (await statusRes.json()) as Record<string, unknown>;
    }
  } catch {}

  // Fall back to /api/auth/me if status endpoint fails
  if (!body) {
    try {
      const meRes = await fetch(`${base}/api/auth/me`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (meRes.ok) {
        body = (await meRes.json()) as Record<string, unknown>;
      }
    } catch {}
  }

  if (!body || typeof body !== "object") return null;

  const user = body.user as { id?: unknown; email?: unknown; name?: unknown } | undefined;
  if (
    body.loggedIn !== true ||
    typeof user?.id !== "string" ||
    typeof user?.email !== "string"
  ) {
    return null;
  }

  const isAdmin =
    body.isAdmin === true ||
    body.role === "global_admin" ||
    body.role === "admin";

  return {
    id: user.id,
    email: user.email.trim().toLowerCase(),
    name: typeof user.name === "string" ? user.name : null,
    isAdmin,
  };
}
