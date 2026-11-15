/**
 * Ask the service worker (public/sw.js) to save the current walk-day page and
 * its build files, so it opens with no signal later. Called each time the
 * register loads with signal, which also refreshes the copy after a deploy.
 */
export function keepWalkDayOffline(walk: { name: string; when: string; expires: number }) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  // Waits for a worker to be active; never settles where none is registered (development).
  void navigator.serviceWorker.ready.then((registration) => {
    const assets = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes("/_next/static/"));
    registration.active?.postMessage({ type: "keep-walk-day", path: location.pathname, ...walk, assets });
  });
}
