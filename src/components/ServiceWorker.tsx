"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, which keeps walk-day registers and the kit scanner
 * openable with no signal. Production only: in development it would serve
 * stale build files. The iOS app runs it through app-bound domains
 * (capacitor.config.ts); a build from before that has no service worker.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // No worker just means no offline copy; the site works the same.
    });
  }, []);
  return null;
}
