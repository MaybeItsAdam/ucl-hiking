/** Keep a sign-in handoff on the same website origin that started it. */
export function authCallbackUrl(requestUrl: URL, requestedReturnTo?: string | null): string | null {
  const callback = new URL("/auth/callback", requestUrl.origin);
  if (!requestedReturnTo) return callback.toString();

  let candidate: URL;
  try {
    candidate = new URL(requestedReturnTo);
  } catch {
    return null;
  }

  if (
    candidate.origin !== requestUrl.origin ||
    candidate.pathname !== callback.pathname ||
    candidate.hash ||
    candidate.username ||
    candidate.password
  ) {
    return null;
  }
  if (candidate.searchParams.size > 1 || [...candidate.searchParams.keys()].some((key) => key !== "native")) return null;
  if (candidate.searchParams.has("native") && candidate.searchParams.get("native") !== "1") return null;

  return candidate.toString();
}

/** Whether this callback must hand the completed sign-in back to the native app. */
export function isNativeAuthCallback(callbackUrl: URL): boolean {
  return callbackUrl.searchParams.get("native") === "1";
}
