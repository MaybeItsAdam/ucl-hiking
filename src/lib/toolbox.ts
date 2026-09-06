export interface ToolboxIdentity {
  id: string;
  email: string;
  name: string | null;
  isAdmin?: boolean;
  isReviewer?: boolean;
  committeeOrganiserIds?: string[];
  principalOrganiserIds?: string[];
}

export function getSocietyName(): string {
  return process.env.NEXT_PUBLIC_SOCIETY_NAME || "UCL Hiking Club";
}

export function getSocietyOrganiserId(): string | null {
  return process.env.NEXT_PUBLIC_ORGANISER_ID || process.env.ORGANISER_ID || null;
}

/**
 * Returns true if the user is a global platform administrator (e.g. Adam Cleary)
 * or a store reviewer (Apple / Google App Store review accounts), as certified
 * by Adam's Campus Toolbox, or explicitly listed in ADMIN_EMAILS.
 */
export function isPlatformAdmin(identity: ToolboxIdentity): boolean {
  if (identity.isAdmin || identity.isReviewer) return true;
  const email = identity.email.toLowerCase();
  const envAdmins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return envAdmins.includes(email);
}

/**
 * Resolves the governance role for this specific society from the user's
 * verified identity in Adam's Campus Toolbox.
 */
export function getSocietyGovernanceRole(
  identity: ToolboxIdentity,
): "admin" | "principal" | "committee" | null {
  if (isPlatformAdmin(identity)) return "admin";

  const orgId = getSocietyOrganiserId();
  if (orgId) {
    if (identity.principalOrganiserIds?.includes(orgId)) return "principal";
    if (identity.committeeOrganiserIds?.includes(orgId)) return "committee";
  }

  return null;
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

  // Try /api/auth/status first (returns session user + isAdmin, isReviewer, committeeOrganiserIds from Toolbox)
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

  const isReviewer = body.isReviewer === true;

  const committeeOrganiserIds = Array.isArray(body.committeeOrganiserIds)
    ? (body.committeeOrganiserIds.filter((id) => typeof id === "string") as string[])
    : [];

  const principalOrganiserIds = Array.isArray(body.principalOrganiserIds)
    ? (body.principalOrganiserIds.filter((id) => typeof id === "string") as string[])
    : [];

  return {
    id: user.id,
    email: user.email.trim().toLowerCase(),
    name: typeof user.name === "string" ? user.name : null,
    isAdmin,
    isReviewer,
    committeeOrganiserIds,
    principalOrganiserIds,
  };
}
