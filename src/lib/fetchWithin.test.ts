import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithin, isTimeout } from "./fetchWithin";

/** A fetch that never answers, but gives up when its signal aborts. */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchWithin", () => {
  it("gives up with a TimeoutError when nothing answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const pending = fetchWithin("/api/x", {}, 1000);
    const caught = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err = await caught;
    expect(isTimeout(err)).toBe(true);
  });

  it("passes an answer straight through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    const res = await fetchWithin("/api/x", {}, 1000);
    expect(await res.text()).toBe("ok");
  });

  it("reports the caller's own abort as an abort, not a timeout", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const controller = new AbortController();
    const pending = fetchWithin("/api/x", { signal: controller.signal }, 60000).catch((e: unknown) => e);
    controller.abort();
    const err = await pending;
    expect(isTimeout(err)).toBe(false);
    expect((err as DOMException).name).toBe("AbortError");
  });
});
