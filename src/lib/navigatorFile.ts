/**
 * An issue's PDF as the device sees it: a RangeCache over the members-only proxy,
 * with every chunk kept in IndexedDB. Shared by the reader (which hands it to
 * pdf.js as a range transport) and the library's "save to device" control.
 */

import { NAVIGATOR_CHUNK_BYTES, RangeCache, totalFromContentRange, type RangeFetcher } from "@/lib/navigatorRange";
import { chunkStore } from "@/lib/navigatorStore";

/** Fetches bytes [begin, end) from the proxy. */
export function proxyFetcher(src: string): RangeFetcher {
  return async (begin, end, signal) => {
    const response = await fetch(src, {
      headers: { Range: `bytes=${begin}-${end - 1}` },
      // The chunks are kept in IndexedDB; a second copy in the HTTP cache would only take space.
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (response.status !== 206 && response.status !== 200) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A server that ignored the range sent the whole file.
    return response.status === 200 ? bytes.slice(begin, end) : bytes;
  };
}

export type IssueFile = { cache: RangeCache; first: Uint8Array };

/**
 * Opens an issue's file: its first chunk from the device or the network, and a
 * cache for the rest. Resolves to null if the file on the server isn't the
 * length the app expects (it was replaced): the reader then reads it uncached.
 */
export async function openIssueFile(src: string, version: string, length: number, signal?: AbortSignal): Promise<IssueFile | null> {
  const store = chunkStore(version);
  const fetchRange = proxyFetcher(src);
  const cache = new RangeCache(length, store, fetchRange);
  signal?.addEventListener("abort", () => cache.abort());
  let first = await store.get(0).catch(() => null);
  if (!first) {
    const end = Math.min(length, NAVIGATOR_CHUNK_BYTES);
    const response = await fetch(src, { headers: { Range: `bytes=0-${end - 1}` }, cache: "no-store", credentials: "same-origin", signal });
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => {});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return null;
    }
    if (totalFromContentRange(response.headers.get("content-range")) !== length) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    first = new Uint8Array(await response.arrayBuffer());
    if (first.byteLength !== end) return null;
    cache.fetchedBytes += first.byteLength;
  }
  cache.prime(0, first);
  return { cache, first };
}
