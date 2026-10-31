/**
 * The Navigator kept on the device, in IndexedDB: the PDF's bytes in 2 MB chunks
 * (src/lib/navigatorRange.ts), pages already rendered as images, and which
 * issues the member saved to the device.
 *
 * Everything is keyed by the issue's version (navigatorVersion: its Drive file id
 * and size), so a replaced file never shows pages kept from the old one.
 *
 * Storage is a nicety, never a requirement: private browsing, a full disk or a
 * WebView with storage turned off all leave every call resolving to "nothing
 * kept", and the reader carries on from the network.
 */

import {
  CHUNK_CACHE_BYTES,
  PAGE_CACHE_BYTES,
  issuesToEvict,
  lruEvictions,
  pageKey,
  type IssueOnDevice,
} from "@/lib/navigatorCache";
import { NAVIGATOR_ISSUES, navigatorVersion } from "@/lib/navigator";
import { NAVIGATOR_CHUNK_BYTES, type ChunkStore } from "@/lib/navigatorRange";

const DB_NAME = "navigator";
const DB_VERSION = 1;
const CHUNKS = "chunks"; // key [version, index] → Uint8Array
const PAGES = "pages"; // key "version|page|width" → PageRecord
const ISSUES = "issues"; // key version → IssueRecord

type PageRecord = { blob: Blob; bytes: number; at: number; version: string };
type IssueRecord = { version: string; issue: number; saved: boolean; lastOpened: number };

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS);
        if (!db.objectStoreNames.contains(PAGES)) db.createObjectStore(PAGES);
        if (!db.objectStoreNames.contains(ISSUES)) db.createObjectStore(ISSUES);
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab upgrading: step aside rather than block it.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Runs `fn` against the store, or resolves to `fallback` if storage isn't there or fails. */
async function withStore<T>(name: string, mode: IDBTransactionMode, fallback: T, fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  try {
    const db = await openDb();
    if (!db) return fallback;
    const tx = db.transaction(name, mode);
    const result = await fn(tx.objectStore(name));
    if (mode === "readwrite") await finished(tx);
    return result;
  } catch {
    return fallback;
  }
}

const chunkRange = (version: string) => IDBKeyRange.bound([version, 0], [version, Number.MAX_SAFE_INTEGER]);
const pageRange = (version: string) => IDBKeyRange.bound(`${version}|`, `${version}|￿`);

/** The chunks of one issue's file, for RangeCache. */
export function chunkStore(version: string): ChunkStore {
  return {
    get: (index) =>
      withStore(CHUNKS, "readonly", null, async (s) => {
        const value = (await done(s.get([version, index]))) as Uint8Array | ArrayBuffer | undefined;
        if (!value) return null;
        return value instanceof Uint8Array ? value : new Uint8Array(value);
      }),
    put: async (index, data) => {
      const ok = await withStore(CHUNKS, "readwrite", false, async (s) => {
        await done(s.put(data, [version, index]));
        return true;
      });
      if (!ok) throw new Error("not stored");
    },
  };
}

/** A rendered page, if one is kept; marks it as just used. */
export async function getPageImage(version: string, page: number, width: number): Promise<Blob | null> {
  const key = pageKey(version, page, width);
  return withStore(PAGES, "readwrite", null, async (s) => {
    const record = (await done(s.get(key))) as PageRecord | undefined;
    if (!record) return null;
    s.put({ ...record, at: Date.now() }, key);
    return record.blob;
  });
}

let pageTrim: Promise<void> | null = null;

/** Keeps a rendered page, then trims the oldest pages if the total is over the cap. */
export async function putPageImage(version: string, page: number, width: number, blob: Blob): Promise<void> {
  const key = pageKey(version, page, width);
  const stored = await withStore(PAGES, "readwrite", false, async (s) => {
    await done(s.put({ blob, bytes: blob.size, at: Date.now(), version } satisfies PageRecord, key));
    return true;
  });
  if (stored) {
    // One trim at a time; a burst of puts is covered by the trim already running.
    pageTrim ??= trimPages().finally(() => (pageTrim = null));
  }
}

async function trimPages(cap = PAGE_CACHE_BYTES): Promise<void> {
  await withStore(PAGES, "readwrite", undefined, async (s) => {
    const entries: { key: string; bytes: number; at: number }[] = [];
    await new Promise<void>((resolve, reject) => {
      const cursor = s.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return resolve();
        const r = c.value as PageRecord;
        entries.push({ key: String(c.key), bytes: r.bytes, at: r.at });
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    for (const key of lruEvictions(entries, cap)) s.delete(key);
  });
}

async function readIssues(): Promise<IssueRecord[]> {
  return withStore(ISSUES, "readonly", [] as IssueRecord[], (s) => done(s.getAll()) as Promise<IssueRecord[]>);
}

async function chunkBytes(version: string): Promise<number> {
  return withStore(CHUNKS, "readonly", 0, async (s) => (await done(s.count(chunkRange(version)))) * NAVIGATOR_CHUNK_BYTES);
}

/**
 * Notes an issue as just opened, and tidies up: files no issue reads any more
 * go, then the longest-unopened unsaved issues past the cap.
 */
export async function markOpened(version: string, issue: number): Promise<void> {
  await pruneStale(NAVIGATOR_ISSUES.map(navigatorVersion));
  const existing = (await readIssues()).find((r) => r.version === version);
  await withStore(ISSUES, "readwrite", undefined, async (s) => {
    s.put({ version, issue, saved: existing?.saved ?? false, lastOpened: Date.now() } satisfies IssueRecord, version);
  });
  const records = await readIssues();
  const onDevice: IssueOnDevice[] = await Promise.all(
    records.map(async (r) => ({ version: r.version, bytes: await chunkBytes(r.version), lastOpened: r.lastOpened, saved: r.saved })),
  );
  for (const v of issuesToEvict(onDevice, CHUNK_CACHE_BYTES, version)) await removeIssue(v);
}

export async function isSaved(version: string): Promise<boolean> {
  return withStore(ISSUES, "readonly", false, async (s) => !!((await done(s.get(version))) as IssueRecord | undefined)?.saved);
}

export async function setSaved(version: string, issue: number, saved: boolean): Promise<boolean> {
  const ok = await withStore(ISSUES, "readwrite", false, async (s) => {
    const existing = (await done(s.get(version))) as IssueRecord | undefined;
    s.put({ version, issue, saved, lastOpened: existing?.lastOpened ?? Date.now() } satisfies IssueRecord, version);
    return true;
  });
  // Ask the browser not to clear a saved issue under storage pressure.
  if (ok && saved) await navigator.storage?.persist?.().catch(() => false);
  return ok;
}

/** Everything kept for one issue's file: its bytes, its rendered pages, its record. */
export async function removeIssue(version: string): Promise<void> {
  await withStore(CHUNKS, "readwrite", undefined, async (s) => void s.delete(chunkRange(version)));
  await withStore(PAGES, "readwrite", undefined, async (s) => void s.delete(pageRange(version)));
  await withStore(ISSUES, "readwrite", undefined, async (s) => void s.delete(version));
}

/** Lets go of files no issue reads any more (a web copy replaced, a file fixed). */
async function pruneStale(current: readonly string[]): Promise<void> {
  for (const r of await readIssues()) if (!current.includes(r.version)) await removeIssue(r.version);
}

/** Whether every chunk of a file is kept. */
export async function hasAllChunks(version: string, length: number): Promise<boolean> {
  return (await chunkBytes(version)) / NAVIGATOR_CHUNK_BYTES >= Math.ceil(length / NAVIGATOR_CHUNK_BYTES);
}
