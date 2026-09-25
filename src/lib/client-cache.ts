"use client";

/**
 * The last data each portal loaded, kept for the life of the page.
 *
 * Moving between tabs unmounts the portal, and without this it came back to a
 * skeleton and a fresh round trip every time. Now it comes back showing what
 * it had and refreshes behind it (stale-while-revalidate).
 *
 * Memory only, never storage: the roster is personal data, and a full reload —
 * signing out, switching role preview — clears it.
 */
const entries = new Map<string, unknown>();

export function readCache<T>(key: string): T | undefined {
  return entries.get(key) as T | undefined;
}

export function writeCache<T>(key: string, value: T): void {
  entries.set(key, value);
}
