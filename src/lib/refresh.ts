"use client";

import { useEffect, useRef } from "react";

/**
 * Pull-to-refresh reloads the server-rendered page, but the portals fetch their
 * own data from /api. This event lets them join in on the same gesture.
 */
export const APP_REFRESH_EVENT = "app:refresh";

export function requestAppRefresh() {
  window.dispatchEvent(new Event(APP_REFRESH_EVENT));
}

/** Run `handler` whenever the app is pulled to refresh. */
export function useAppRefresh(handler: () => void) {
  const latest = useRef(handler);

  useEffect(() => {
    latest.current = handler;
  }, [handler]);

  useEffect(() => {
    const run = () => latest.current();
    window.addEventListener(APP_REFRESH_EVENT, run);
    return () => window.removeEventListener(APP_REFRESH_EVENT, run);
  }, []);
}
