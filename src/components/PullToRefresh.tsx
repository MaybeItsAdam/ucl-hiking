"use client";

import { useRef, useState, useTransition, type CSSProperties, type ReactNode, type TouchEvent } from "react";
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
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pane = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ y: number; x: number; axis: "x" | "y" | null } | null>(null);
  const [pull, setPull] = useState(0);
  const [pending, startTransition] = useTransition();

  const armed = pull >= THRESHOLD;

  function move(distance: number, animate: boolean) {
    setPull(distance);
    const el = pane.current;
    if (!el) return;
    el.style.transition = animate ? "transform .3s cubic-bezier(.2,.8,.2,1)" : "none";
    // An empty string, not translate3d(0): a lingering transform would make this
    // element the containing block for the dialogs' position: fixed overlays.
    el.style.transform = distance ? `translate3d(0,${distance * 0.5}px,0)` : "";
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (pending || event.touches.length > 1 || window.scrollY > 0) {
      gesture.current = null;
      return;
    }
    gesture.current = { y: event.touches[0].clientY, x: event.touches[0].clientX, axis: null };
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    const g = gesture.current;
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
      if (pull) move(0, false);
      return;
    }
    // Rubber band: the further it is pulled, the less each pixel gives.
    move(Math.min(MAX_PULL, dy * 0.55), false);
  }

  function onTouchEnd() {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.axis !== "y") return;
    if (pull < THRESHOLD) {
      move(0, true);
      return;
    }
    move(0, true);
    startTransition(async () => {
      requestAppRefresh();
      router.refresh();
      await new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS));
    });
  }

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
      <div
        ref={pane}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => {
          gesture.current = null;
          move(0, true);
        }}
      >
        {children}
      </div>
    </div>
  );
}
