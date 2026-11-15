"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useOffline } from "next/offline";
import { CloudOff, Wifi, X } from "lucide-react";
import { useQuip } from "@/lib/quips";

// The bottom tab bar on phones and in the app; the banner sits just above it.
const TAB_BAR = ".app-tabs";

/**
 * Says when the phone has lost its connection. With experimental.useOffline a
 * tap on a link waits for signal instead of failing, so this is what tells you
 * why nothing has happened yet. Briefly says so when the connection is back.
 */
export function OfflineBanner() {
  const offline = useOffline();
  const quip = useQuip("offline");
  const [seen, setSeen] = useState(offline);
  const [back, setBack] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The walk-day register has its own offline status and keeps working.
  const ownStatus = usePathname()?.endsWith("/day") ?? false;

  // Follow the transitions while rendering, not in an effect.
  if (seen !== offline) {
    setSeen(offline);
    setBack(!offline);
    if (offline) setDismissed(false);
  }

  useEffect(() => {
    if (!back) return;
    const t = setTimeout(() => setBack(false), 2500);
    return () => clearTimeout(t);
  }, [back]);

  const visible = (offline && !dismissed) || back;

  // Clear the tab bar where there is one fixed along the bottom.
  useEffect(() => {
    if (!visible) return;
    const place = () => {
      const bar = [...document.querySelectorAll<HTMLElement>(TAB_BAR)].find(
        (el) => getComputedStyle(el).position === "fixed" && el.offsetHeight > 0,
      );
      const lift = bar ? Math.max(0, window.innerHeight - bar.getBoundingClientRect().top) : 0;
      ref.current?.style.setProperty("--offline-lift", `${lift}px`);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [visible]);

  if (!visible || ownStatus) return null;

  return (
    <div ref={ref} className={`offline-banner${offline ? "" : " is-back"}`} role="status" aria-live="polite">
      {offline ? <CloudOff size={16} aria-hidden="true" /> : <Wifi size={16} aria-hidden="true" />}
      <span className="offline-banner-text">
        <strong>{offline ? "You’re offline" : "Back online"}</strong>
        {offline ? <span> Links will open once you’re back. {quip}</span> : null}
      </span>
      {offline ? (
        <button type="button" className="offline-banner-close" onClick={() => setDismissed(true)} aria-label="Hide">
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
