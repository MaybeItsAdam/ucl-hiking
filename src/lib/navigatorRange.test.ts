import { describe, expect, it } from "vitest";
import {
  RangeCache,
  assemble,
  chunkBounds,
  chunkCount,
  chunkSpan,
  missingRuns,
  parseByteRange,
  splitChunks,
  totalFromContentRange,
  type ChunkStore,
} from "./navigatorRange";

const file = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

function memoryStore(fail = false) {
  const map = new Map<number, Uint8Array>();
  const store: ChunkStore = {
    get: async (i) => (fail ? null : (map.get(i) ?? null)),
    put: async (i, d) => {
      if (fail) throw new Error("blocked");
      map.set(i, d);
    },
  };
  return { map, store };
}

function network(bytes: Uint8Array) {
  const calls: [number, number][] = [];
  const fetchRange = async (b: number, e: number) => {
    calls.push([b, e]);
    await Promise.resolve();
    return bytes.slice(b, e);
  };
  return { calls, fetchRange };
}

describe("chunk arithmetic", () => {
  it("finds the chunks a range touches", () => {
    expect(chunkSpan(0, 10, 10, 35)).toEqual([0, 0]);
    expect(chunkSpan(5, 25, 10, 35)).toEqual([0, 2]);
    expect(chunkSpan(30, 99, 10, 35)).toEqual([3, 3]);
    expect(chunkSpan(40, 50, 10, 35)).toBeNull();
  });
  it("counts and bounds chunks, the last one short", () => {
    expect(chunkCount(35, 10)).toBe(4);
    expect(chunkBounds(3, 10, 35)).toEqual([30, 35]);
  });
  it("groups missing chunks into runs no longer than the cap", () => {
    const have = new Set([2, 7]);
    expect(missingRuns(0, 9, (i) => have.has(i), 3)).toEqual([[0, 1], [3, 5], [6, 6], [8, 9]]);
    expect(missingRuns(0, 3, () => true)).toEqual([]);
  });
  it("splits and reassembles bytes exactly", () => {
    const bytes = file(35);
    const chunks = splitChunks(bytes.slice(10, 35), 1, 3, 10, 35);
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 5]);
    expect(assemble(12, 33, 1, chunks, 10)).toEqual(bytes.slice(12, 33));
  });
  it("reads the total from a Content-Range header", () => {
    expect(totalFromContentRange("bytes 0-2097151/50230514")).toBe(50230514);
    expect(totalFromContentRange(null)).toBeNull();
    expect(totalFromContentRange("bytes */*")).toBeNull();
  });
});

describe("RangeCache", () => {
  it("answers a range from the network, then from storage", async () => {
    const bytes = file(100);
    const { store, map } = memoryStore();
    const net = network(bytes);
    const cache = new RangeCache(100, store, net.fetchRange, 10);
    expect(await cache.read(15, 42)).toEqual(bytes.slice(15, 42));
    expect(net.calls).toEqual([[10, 50]]); // chunks 1–4, one request
    await cache.flush();
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);

    const again = new RangeCache(100, store, net.fetchRange, 10);
    expect(await again.read(15, 42)).toEqual(bytes.slice(15, 42));
    expect(net.calls).toHaveLength(1);
    expect(again.fetchedBytes).toBe(0);
  });

  it("shares one fetch between reads that want the same chunk", async () => {
    const bytes = file(50);
    const net = network(bytes);
    const cache = new RangeCache(50, memoryStore().store, net.fetchRange, 10);
    const [a, b] = await Promise.all([cache.read(0, 15), cache.read(5, 20)]);
    expect(a).toEqual(bytes.slice(0, 15));
    expect(b).toEqual(bytes.slice(5, 20));
    expect(net.calls).toEqual([[0, 20]]);
  });

  it("keeps chunks in memory when storage is blocked, so nothing is fetched twice", async () => {
    const bytes = file(30);
    const net = network(bytes);
    const cache = new RangeCache(30, memoryStore(true).store, net.fetchRange, 10);
    await cache.read(0, 30);
    await cache.flush();
    await cache.read(0, 30);
    expect(net.calls).toHaveLength(1);
  });

  it("fetches a whole file for saving, reporting progress", async () => {
    const bytes = file(95);
    const { store, map } = memoryStore();
    const net = network(bytes);
    const cache = new RangeCache(95, store, net.fetchRange, 10);
    const progress: number[] = [];
    await cache.fetchAll((p) => progress.push(p));
    await cache.flush();
    expect(map.size).toBe(10);
    expect(progress.at(-1)).toBe(1);
    expect(net.calls).toEqual([[0, 40], [40, 80], [80, 95]]);
  });

  it("uses a primed first chunk without fetching it", async () => {
    const bytes = file(25);
    const net = network(bytes);
    const cache = new RangeCache(25, memoryStore().store, net.fetchRange, 10);
    cache.prime(0, bytes.slice(0, 10));
    expect(await cache.read(0, 12)).toEqual(bytes.slice(0, 12));
    expect(net.calls).toEqual([[10, 20]]);
  });

  it("refetches after a failed fetch", async () => {
    const bytes = file(20);
    let fail = true;
    const cache = new RangeCache(20, memoryStore().store, async (b, e) => {
      if (fail) throw new Error("offline");
      return bytes.slice(b, e);
    }, 10);
    await expect(cache.read(0, 5)).rejects.toThrow("offline");
    fail = false;
    expect(await cache.read(0, 5)).toEqual(bytes.slice(0, 5));
  });
});

describe("parseByteRange", () => {
  it("reads the forms a range header takes", () => {
    expect(parseByteRange("bytes=0-9", 100)).toEqual([0, 10]);
    expect(parseByteRange("bytes=90-", 100)).toEqual([90, 100]);
    expect(parseByteRange("bytes=-5", 100)).toEqual([95, 100]);
    expect(parseByteRange("bytes=95-200", 100)).toEqual([95, 100]);
  });
  it("refuses what can't be served", () => {
    expect(parseByteRange("bytes=100-120", 100)).toBeNull();
    expect(parseByteRange("bytes=-", 100)).toBeNull();
    expect(parseByteRange("bytes=0-1,5-6", 100)).toBeNull();
  });
});
