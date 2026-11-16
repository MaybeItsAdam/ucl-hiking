/**
 * Ask the service worker (public/sw.js) to save the current page and its build
 * files, so it opens with no signal later. Only the pages the worker allows
 * are kept: a walk's "On the day" register and the kit lender's Equipment
 * page. Called each time such a page loads with signal, which also refreshes
 * the copy after a deploy.
 */
export function keepPageOffline(page: { name: string; when: string; expires: number }) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  // Waits for a worker to be active; never settles where none is registered (development).
  void navigator.serviceWorker.ready.then((registration) => {
    const assets = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes("/_next/static/"));
    registration.active?.postMessage({ type: "keep-page", path: location.pathname, ...page, assets });
  });
}
