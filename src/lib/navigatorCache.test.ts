import { describe, expect, it } from "vitest";
import { readerViews } from "./navigator";
import { RenderQueue, bucketWidth, issuesToEvict, lruEvictions, pageKey, preloadPlan } from "./navigatorCache";

describe("preloadPlan", () => {
  const single = readerViews(24, false);
  const spreads = readerViews(24, true);

  it("draws the page open, then the next, then the one behind, then further on", () => {
    expect(preloadPlan(single, 4, 1)).toEqual([5, 6, 4, 7, 8, 9, 3]);
  });
  it("follows the direction of reading", () => {
    expect(preloadPlan(single, 4, -1)).toEqual([5, 4, 6, 3, 2, 1, 7]);
  });
  it("stops at either end", () => {
    expect(preloadPlan(single, 0, 1)).toEqual([1, 2, 3, 4, 5]);
    expect(preloadPlan(single, 23, 1)).toEqual([24, 23, 22]);
  });
  it("counts pages, not views, when facing pages are shown", () => {
    // View 2 is pages 4–5. Next spread 6–7, previous 2–3, then 8–9 (4 ahead), 2 behind.
    expect(preloadPlan(spreads, 2, 1)).toEqual([4, 5, 6, 7, 2, 3, 8, 9]);
  });
});

describe("lruEvictions", () => {
  it("keeps everything under the cap", () => {
    expect(lruEvictions([{ key: "a", bytes: 5, at: 1 }], 10)).toEqual([]);
  });
  it("drops the least recently used first until it fits", () => {
    const entries = [
      { key: "new", bytes: 4, at: 30 },
      { key: "old", bytes: 4, at: 10 },
      { key: "mid", bytes: 4, at: 20 },
    ];
    expect(lruEvictions(entries, 8)).toEqual(["old"]);
    expect(lruEvictions(entries, 4)).toEqual(["old", "mid"]);
  });
});

describe("issuesToEvict", () => {
  const issues = [
    { version: "a", bytes: 50, lastOpened: 1, saved: false },
    { version: "b", bytes: 50, lastOpened: 2, saved: true },
    { version: "c", bytes: 50, lastOpened: 3, saved: false },
    { version: "d", bytes: 50, lastOpened: 4, saved: false },
  ];
  it("never counts or drops a saved issue", () => {
    expect(issuesToEvict(issues, 150)).toEqual([]);
    expect(issuesToEvict(issues, 100)).toEqual(["a"]);
  });
  it("keeps the issue open now even if it's the oldest", () => {
    expect(issuesToEvict(issues, 50, "a")).toEqual(["c", "d"]);
  });
});

describe("keys", () => {
  it("bucket widths upwards in steps", () => {
    expect(bucketWidth(1)).toBe(128);
    expect(bucketWidth(1098)).toBe(1152);
    expect(bucketWidth(1152)).toBe(1152);
  });
  it("names a page by file, page and width", () => {
    expect(pageKey("abc-10", 3, 1152)).toBe("abc-10|3|1152");
  });
});

describe("RenderQueue", () => {
  /** A queue whose jobs finish only when told to. */
  function setup() {
    const started: number[] = [];
    const aborted: number[] = [];
    const done: number[] = [];
    const resolvers = new Map<number, () => void>();
    const queue = new RenderQueue<number>(
      (page, signal) =>
        new Promise((resolve, reject) => {
          started.push(page);
          signal.addEventListener("abort", () => {
            aborted.push(page);
            reject(new Error("aborted"));
          });
          resolvers.set(page, () => resolve(page));
        }),
      (page) => done.push(page),
    );
    const finish = async (page: number) => {
      resolvers.get(page)!();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { queue, started, aborted, done, finish };
  }

  it("draws one page at a time, in plan order", async () => {
    const q = setup();
    q.queue.plan([3, 4, 2]);
    expect(q.started).toEqual([3]);
    await q.finish(3);
    expect(q.started).toEqual([3, 4]);
    await q.finish(4);
    await q.finish(2);
    expect(q.done).toEqual([3, 4, 2]);
  });

  it("cancels a page no longer wanted and starts on the new first page", async () => {
    const q = setup();
    q.queue.plan([3, 4]);
    q.queue.plan([10, 11]);
    await new Promise((r) => setTimeout(r, 0));
    expect(q.aborted).toEqual([3]);
    expect(q.started).toEqual([3, 10]);
    await q.finish(10);
    expect(q.done).toEqual([10]);
  });

  it("lets a page still wanted finish, and doesn't draw a done page again", async () => {
    const q = setup();
    q.queue.plan([3, 4]);
    q.queue.plan([4, 3]);
    expect(q.aborted).toEqual([]);
    await q.finish(3);
    expect(q.started).toEqual([3, 4]);
    q.queue.plan([3]);
    await new Promise((r) => setTimeout(r, 0));
    expect(q.started.filter((p) => p === 3)).toHaveLength(1);
    q.queue.forget(3);
    q.queue.plan([3]);
    await new Promise((r) => setTimeout(r, 0));
    expect(q.aborted).toEqual([4]);
    expect(q.started.at(-1)).toBe(3);
  });
});
