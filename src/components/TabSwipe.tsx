"use client";

import { useEffect, useRef, type ReactNode, type TouchEvent } from "react";
import { useRouter } from "next/navigation";

// Where the last swipe came from, so the next tab can slide in from that side.
const DIRECTION_KEY = "hiking:tab-swipe";
// Leave the screen edges to the phone's own back gesture.
const EDGE_GUARD = 24;
const COMMIT_DISTANCE = 70;
const COMMIT_VELOCITY = 0.45; // px per ms

/** Whether the touch began inside something that scrolls sideways itself. */
function startsInSideScroller(target: EventTarget | null, boundary: HTMLElement): boolean {
  for (let el = target as HTMLElement | null; el && el !== boundary; el = el.parentElement) {
    if (el.matches("input, textarea, select, [data-no-swipe]")) return true;
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}

/**
 * Swipe left and right between the app's tabs, the way a native tab bar
 * behaves. The page follows the finger, then either commits to the next tab
 * or springs back. Sideways scrollers (tables, chip rows) keep their own swipe.
 */
export function TabSwipe({ hrefs, active, children }: { hrefs: string[]; active: number; children: ReactNode }) {
  const router = useRouter();
  const pane = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);
  const prev = active > 0 ? hrefs[active - 1] : null;
  const next = active < hrefs.length - 1 ? hrefs[active + 1] : null;

  useEffect(() => {
    if (prev) router.prefetch(prev);
    if (next) router.prefetch(next);
  }, [router, prev, next]);

  useEffect(() => {
    let from: string | null = null;
    try {
      from = sessionStorage.getItem(DIRECTION_KEY);
      sessionStorage.removeItem(DIRECTION_KEY);
    } catch {}
    const el = pane.current;
    if (!el || (from !== "left" && from !== "right")) return;
    el.classList.add(`tab-enter-${from}`);
    const done = () => el.classList.remove(`tab-enter-${from}`);
    el.addEventListener("animationend", done, { once: true });
    return () => el.removeEventListener("animationend", done);
  }, []);

  function setOffset(px: number, animate: boolean) {
    const el = pane.current;
    if (!el) return;
    el.style.transition = animate ? "transform .22s cubic-bezier(.2,.8,.2,1)" : "none";
    el.style.transform = px ? `translate3d(${px}px,0,0)` : "";
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    if (
      hrefs.length < 2 ||
      event.touches.length > 1 ||
      touch.clientX < EDGE_GUARD ||
      touch.clientX > window.innerWidth - EDGE_GUARD ||
      startsInSideScroller(event.target, event.currentTarget)
    ) {
      gesture.current = null;
      return;
    }
    gesture.current = { x: touch.clientX, y: touch.clientY, t: event.timeStamp, axis: null };
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g) return;
    const dx = event.touches[0].clientX - g.x;
    const dy = event.touches[0].clientY - g.y;
    if (!g.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      g.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";
    }
    if (g.axis !== "x") return;
    // Heavy resistance past the first or last tab, so the edge is felt.
    const target = dx < 0 ? next : prev;
    setOffset(target ? dx * 0.6 : dx * 0.15, false);
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.axis !== "x") return;
    const dx = event.changedTouches[0].clientX - g.x;
    const velocity = Math.abs(dx) / Math.max(1, event.timeStamp - g.t);
    const target = dx < 0 ? next : prev;
    if (!target || (Math.abs(dx) < COMMIT_DISTANCE && velocity < COMMIT_VELOCITY)) {
      setOffset(0, true);
      return;
    }
    try {
      sessionStorage.setItem(DIRECTION_KEY, dx < 0 ? "right" : "left");
    } catch {}
    setOffset(dx < 0 ? -window.innerWidth * 0.35 : window.innerWidth * 0.35, true);
    router.push(target);
  }

  return (
    <div
      ref={pane}
      className="tab-swipe"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        gesture.current = null;
        setOffset(0, true);
      }}
    >
      {children}
    </div>
  );
}
