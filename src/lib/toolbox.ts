export interface ToolboxIdentity {
  id: string;
  email: string;
  name: string | null;
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
  const response = await fetch(`${toolboxUrl()}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") return null;

  const value = body as {
    loggedIn?: unknown;
    user?: { id?: unknown; email?: unknown; name?: unknown };
  };
  if (
    value.loggedIn !== true ||
    typeof value.user?.id !== "string" ||
    typeof value.user.email !== "string"
  ) {
    return null;
  }

  return {
    id: value.user.id,
    email: value.user.email.trim().toLowerCase(),
    name: typeof value.user.name === "string" ? value.user.name : null,
  };
}
