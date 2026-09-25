"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { requestAppRefresh } from "@/lib/refresh";

/** How far the finger has to travel before the release counts as a refresh. */
const THRESHOLD = 68;
/** Past this the indicator stops moving, so the pull always has an end to it. */
const MAX_PULL = 104;
/** Long enough that a refresh reads as having happened even when it is instant. */
const MIN_SPIN_MS = 550;

/**
 * Pull down at the top of a page to reload it, the way a native list does.
 *
 * Touch only — a mouse has the browser's own reload. The page follows the
 * finger with resistance, and releasing past the threshold refreshes both the
 * server-rendered page and anything listening for APP_REFRESH_EVENT.
 *
 * Like TabSwipe it listens on the whole document, so a pull that starts on the
 * title or on the empty space under a short page still counts.
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pane = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [pending, startTransition] = useTransition();
  // Read by the listeners below, which are bound once rather than on every render.
  const latest = useRef({ pending, refresh: () => {} });
  useEffect(() => {
    latest.current = {
      pending,
      refresh: () =>
        startTransition(async () => {
          requestAppRefresh();
          router.refresh();
          await new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS));
        }),
    };
  });

  const armed = pull >= THRESHOLD;

  useEffect(() => {
    let gesture: { y: number; x: number; axis: "x" | "y" | null } | null = null;
    let distance = 0;

    function move(to: number, animate: boolean) {
      distance = to;
      setPull(to);
      const el = pane.current;
      if (!el) return;
      el.style.transition = animate ? "transform .3s cubic-bezier(.2,.8,.2,1)" : "none";
      // An empty string, not translate3d(0): a lingering transform would make this
      // element the containing block for the dialogs' position: fixed overlays.
      el.style.transform = to ? `translate3d(0,${to * 0.5}px,0)` : "";
    }

    function onStart(event: TouchEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (
        latest.current.pending ||
        event.touches.length > 1 ||
        window.scrollY > 0 ||
        !target?.closest(".app-shell") ||
        target.closest(".app-tabs, [role='dialog'], .modal-overlay, [data-no-swipe]")
      ) {
        gesture = null;
        return;
      }
      gesture = { y: event.touches[0].clientY, x: event.touches[0].clientX, axis: null };
    }

    function onMove(event: TouchEvent) {
      const g = gesture;
      if (!g) return;
      const dy = event.touches[0].clientY - g.y;
      const dx = event.touches[0].clientX - g.x;
      if (!g.axis) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        // Sideways wins ties: TabSwipe owns that direction.
        g.axis = dy > Math.abs(dx) * 1.4 ? "y" : "x";
      }
      if (g.axis !== "y") return;
      // Scrolling back up mid-gesture hands the page back to the browser.
      if (dy <= 0 || window.scrollY > 0) {
        if (distance) move(0, false);
        return;
      }
      // Rubber band: the further it is pulled, the less each pixel gives.
      move(Math.min(MAX_PULL, dy * 0.55), false);
    }

    function onEnd() {
      const g = gesture;
      gesture = null;
      if (!g || g.axis !== "y") return;
      const release = distance;
      move(0, true);
      if (release >= THRESHOLD) latest.current.refresh();
    }

    function onCancel() {
      if (gesture?.axis === "y") move(0, true);
      gesture = null;
    }

    const options = { passive: true };
    document.addEventListener("touchstart", onStart, options);
    document.addEventListener("touchmove", onMove, options);
    document.addEventListener("touchend", onEnd, options);
    document.addEventListener("touchcancel", onCancel, options);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, []);

  return (
    <div className="pull-to-refresh">
      <div
        className={`ptr-indicator${pending ? " is-refreshing" : ""}`}
        // Custom properties rather than a transform: the stylesheet owns where
        // the indicator rests (under the title bar, clear of the notch) and
        // only needs the gesture's distance to carry it down from there.
        style={
          pending
            ? undefined
            : ({ "--ptr": `${pull}px`, "--ptr-opacity": Math.min(1, pull / THRESHOLD) } as CSSProperties)
        }
        aria-hidden={!pending}
      >
        <RefreshCw
          size={18}
          style={pending ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          aria-hidden="true"
        />
        <span className="sr-only">{pending ? "Refreshing" : armed ? "Release to refresh" : "Pull to refresh"}</span>
      </div>
      <div ref={pane}>{children}</div>
    </div>
  );
}
