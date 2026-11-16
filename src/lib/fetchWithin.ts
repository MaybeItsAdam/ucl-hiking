/**
 * fetch() with a deadline. On a hillside or in a basement kit room the phone
 * often says it is online while nothing gets through ("lie-fi"), and a plain
 * fetch then waits for minutes. Past the deadline this rejects with a
 * TimeoutError, which looksOffline() (src/lib/kitScan.ts) counts as no signal,
 * so the caller queues the change instead of spinning.
 *
 * Only use it where resending is harmless: every queued write carries an id
 * the server deduplicates on, so a request that timed out but did land is
 * applied once.
 */
export async function fetchWithin(input: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("No answer in time", "TimeoutError")), ms);
  const outer = init.signal;
  const forward = () => controller.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) forward();
    else outer.addEventListener("abort", forward, { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    // Some engines reject with a plain AbortError rather than the reason given.
    if (controller.signal.aborted && !outer?.aborted) throw new DOMException("No answer in time", "TimeoutError");
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", forward);
  }
}

/** True for the error fetchWithin() throws when its deadline passes. */
export function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}
