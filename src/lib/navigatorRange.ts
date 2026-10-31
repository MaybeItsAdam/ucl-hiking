/**
 * The Navigator's PDF bytes, a fixed-size chunk at a time, kept on the device.
 *
 * pdf.js asks for byte ranges as it needs them (a page's images, the cross-
 * reference table at the end). Every range is answered from chunks: ones kept
 * from an earlier read come from storage, the rest from the proxy in as few
 * requests as possible, and are kept for next time. Reopening an issue, or
 * reading one saved to the device, doesn't go back to Drive at all.
 *
 * Storage and the network are passed in, so this is plain logic with no browser
 * in it: src/lib/navigatorStore.ts supplies IndexedDB and the reader a fetch.
 */

/** 2 MB: the same as pdf.js's range size, so its requests always line up with chunks. */
export const NAVIGATOR_CHUNK_BYTES = 2 * 1024 * 1024;
/** At most this many chunks in one request, so a cold read never asks the proxy for too much at once. */
export const MAX_CHUNKS_PER_REQUEST = 4;

/** The chunks a byte range [begin, end) touches, as [first, last] inclusive. */
export function chunkSpan(begin: number, end: number, chunkSize: number, length: number): [number, number] | null {
  const from = Math.max(0, begin);
  const to = Math.min(end, length);
  if (to <= from) return null;
  return [Math.floor(from / chunkSize), Math.floor((to - 1) / chunkSize)];
}

/** How many chunks a file of this length has. */
export function chunkCount(length: number, chunkSize: number): number {
  return Math.ceil(length / chunkSize);
}

/** The byte range [begin, end) of one chunk. The last chunk can be short. */
export function chunkBounds(index: number, chunkSize: number, length: number): [number, number] {
  return [index * chunkSize, Math.min(length, (index + 1) * chunkSize)];
}

/**
 * The chunks among [first, last] that aren't in `have`, gathered into runs of
 * consecutive chunks (each at most `maxRun` long) to fetch one request a run.
 */
export function missingRuns(first: number, last: number, have: (index: number) => boolean, maxRun = MAX_CHUNKS_PER_REQUEST): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = first; i <= last + 1; i++) {
    const missing = i <= last && !have(i);
    if (missing && start === -1) start = i;
    const runLength = start === -1 ? 0 : i - start;
    if (start !== -1 && (!missing || runLength === maxRun)) {
      runs.push([start, i - 1]);
      start = missing ? i : -1;
    }
  }
  return runs;
}

/** Copies the bytes [begin, end) out of whole chunks starting at chunk `first`. */
export function assemble(begin: number, end: number, first: number, chunks: Uint8Array[], chunkSize: number): Uint8Array {
  const out = new Uint8Array(end - begin);
  let offset = first * chunkSize;
  for (const chunk of chunks) {
    const from = Math.max(begin, offset);
    const to = Math.min(end, offset + chunk.byteLength);
    if (to > from) out.set(chunk.subarray(from - offset, to - offset), from - begin);
    offset += chunk.byteLength;
  }
  return out;
}

/** Splits bytes fetched for chunks [first, last] back into chunks. */
export function splitChunks(bytes: Uint8Array, first: number, last: number, chunkSize: number, length: number): Uint8Array[] {
  const base = first * chunkSize;
  const out: Uint8Array[] = [];
  for (let i = first; i <= last; i++) {
    const [b, e] = chunkBounds(i, chunkSize, length);
    out.push(bytes.slice(b - base, e - base));
  }
  return out;
}

/** "bytes 0-2097151/50230514" → 50230514. */
export function totalFromContentRange(header: string | null): number | null {
  const match = header ? /\/(\d+)\s*$/.exec(header) : null;
  return match ? Number(match[1]) : null;
}

/**
 * A single "bytes=…" range against a file of `total` bytes, as [begin, end)
 * clamped to the file, or null if it can't be satisfied. Covers "a-b", "a-" and
 * the suffix form "-n" (the last n bytes).
 */
export function parseByteRange(header: string, total: number): [number, number] | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let begin: number;
  let end: number;
  if (!match[1]) {
    begin = Math.max(0, total - Number(match[2]));
    end = total;
  } else {
    begin = Number(match[1]);
    end = match[2] ? Math.min(total, Number(match[2]) + 1) : total;
  }
  return begin < end ? [begin, end] : null;
}

export interface ChunkStore {
  get(index: number): Promise<Uint8Array | null>;
  put(index: number, data: Uint8Array): Promise<void>;
}

/** Fetches [begin, end) (end exclusive); resolves to exactly those bytes. */
export type RangeFetcher = (begin: number, end: number, signal?: AbortSignal) => Promise<Uint8Array>;

/**
 * Byte ranges of one file, served from kept chunks where possible. Concurrent
 * reads that need the same chunk share one fetch of it. A fetched chunk stays in
 * memory only until storage has it, so reading a whole issue doesn't hold the
 * whole file in memory; when storage is blocked it stays, so nothing is fetched twice.
 */
export class RangeCache {
  private inflight = new Map<number, Promise<Uint8Array>>();
  private controller = new AbortController();
  private writes = new Set<Promise<void>>();
  /** Bytes fetched from the network, for the reader's own measurements. */
  fetchedBytes = 0;

  constructor(
    readonly length: number,
    private readonly store: ChunkStore,
    private readonly fetchRange: RangeFetcher,
    readonly chunkSize = NAVIGATOR_CHUNK_BYTES,
  ) {}

  /** Seeds a chunk already in hand (the first one, fetched to learn the length). */
  prime(index: number, data: Uint8Array) {
    if (this.inflight.has(index)) return;
    const p = Promise.resolve(data);
    this.inflight.set(index, p);
    this.keep(index, data, p);
  }

  abort() {
    this.controller.abort();
  }

  async read(begin: number, end: number): Promise<Uint8Array> {
    const span = chunkSpan(begin, end, this.chunkSize, this.length);
    if (!span) return new Uint8Array(0);
    const [first, last] = span;
    const chunks = await this.chunks(first, last);
    return assemble(begin, Math.min(end, this.length), first, chunks, this.chunkSize);
  }

  /** Makes sure every chunk is stored, a run at a time; reports progress as 0–1. */
  async fetchAll(onProgress?: (done: number) => void, signal?: AbortSignal): Promise<void> {
    const total = chunkCount(this.length, this.chunkSize);
    for (let i = 0; i < total; i += MAX_CHUNKS_PER_REQUEST) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const last = Math.min(total - 1, i + MAX_CHUNKS_PER_REQUEST - 1);
      await this.chunks(i, last);
      onProgress?.((last + 1) / total);
    }
  }

  /** Chunks [first, last]: in flight, stored, or fetched now in as few requests as possible. */
  private async chunks(first: number, last: number): Promise<Uint8Array[]> {
    // What storage already has, read in parallel; anything not already on its way is a miss.
    const known = new Map<number, Promise<Uint8Array>>();
    const lookups: Promise<void>[] = [];
    for (let i = first; i <= last; i++) {
      const pending = this.inflight.get(i);
      if (pending) {
        known.set(i, pending);
        continue;
      }
      lookups.push(
        this.store.get(i).then(
          (data) => {
            if (data) known.set(i, Promise.resolve(data));
          },
          () => {},
        ),
      );
    }
    await Promise.all(lookups);

    for (const [from, to] of missingRuns(first, last, (i) => known.has(i) || this.inflight.has(i))) {
      const run = this.fetchRun(from, to);
      for (let i = from; i <= to; i++) {
        const p = run.then((chunks) => chunks[i - from]);
        this.inflight.set(i, p);
        known.set(i, p);
        p.then(
          (data) => this.keep(i, data, p),
          () => {
            if (this.inflight.get(i) === p) this.inflight.delete(i);
          },
        );
      }
    }
    for (let i = first; i <= last; i++) if (!known.has(i)) known.set(i, this.inflight.get(i)!);

    const out: Uint8Array[] = [];
    for (let i = first; i <= last; i++) out.push(await known.get(i)!);
    return out;
  }

  /** Stores a chunk, then lets go of the in-memory copy. */
  private keep(index: number, data: Uint8Array, p: Promise<Uint8Array>) {
    const write = this.store.put(index, data).then(
      () => {
        if (this.inflight.get(index) === p) this.inflight.delete(index);
      },
      () => {},
    );
    this.writes.add(write);
    void write.finally(() => this.writes.delete(write));
  }

  /** Resolves once every chunk fetched so far has been offered to storage. */
  async flush(): Promise<void> {
    while (this.writes.size) await Promise.all([...this.writes]);
  }

  private async fetchRun(from: number, to: number): Promise<Uint8Array[]> {
    const [b] = chunkBounds(from, this.chunkSize, this.length);
    const [, e] = chunkBounds(to, this.chunkSize, this.length);
    const bytes = await this.fetchRange(b, e, this.controller.signal);
    if (bytes.byteLength !== e - b) throw new Error(`Expected ${e - b} bytes, got ${bytes.byteLength}`);
    this.fetchedBytes += bytes.byteLength;
    return splitChunks(bytes, from, to, this.chunkSize, this.length);
  }
}
