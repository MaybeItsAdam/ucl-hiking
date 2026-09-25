"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAppNav } from "@/components/AppNav";

// Leave the screen edges to the phone's own back gesture.
const EDGE_GUARD = 24;
const COMMIT_DISTANCE = 70;
const COMMIT_VELOCITY = 0.45; // px per ms

/** Whether a touch began somewhere that owns its own sideways movement. */
function startsOutsideSwipe(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  // The tab bar is tapped, not swiped; sheets and dialogs sit above the page.
  if (!target.closest(".app-shell") || target.closest(".app-tabs, [role='dialog'], .modal-overlay")) return true;
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
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
 *
 * The gesture is heard on the whole document rather than on the page content:
 * a short page — Settings, an empty list, one still loading — leaves most of
 * the screen below it, and a swipe that starts there has to count too.
 */
export function TabSwipe({ children }: { children: ReactNode }) {
  const { pages, active, go } = useAppNav();
  const pathname = usePathname();
  const pane = useRef<HTMLDivElement>(null);
  // Which side the next page should slide in from, set when a swipe commits.
  const entering = useRef<"left" | "right" | null>(null);

  const index = pages.indexOf(active);
  const prev = index > 0 ? pages[index - 1] : null;
  const next = index >= 0 && index < pages.length - 1 ? pages[index + 1] : null;
  // Read by the listeners below, which are bound once rather than on every render.
  const latest = useRef({ prev, next, go });
  useEffect(() => {
    latest.current = { prev, next, go };
  });

  useEffect(() => {
    const el = pane.current;
    const from = entering.current;
    entering.current = null;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = "";
    if (!from) return;
    el.classList.add(`tab-enter-${from}`);
    const done = () => el.classList.remove(`tab-enter-${from}`);
    el.addEventListener("animationend", done, { once: true });
    return () => {
      el.removeEventListener("animationend", done);
      done();
    };
  }, [pathname]);

  useEffect(() => {
    let gesture: { x: number; y: number; t: number; axis: "x" | "y" | null } | null = null;

    function setOffset(px: number, animate: boolean) {
      const el = pane.current;
      if (!el) return;
      el.style.transition = animate ? "transform .22s cubic-bezier(.2,.8,.2,1)" : "none";
      // An empty string, not translate3d(0): a lingering transform would make this
      // element the containing block for the sheets' position: fixed overlays.
      el.style.transform = px ? `translate3d(${px}px,0,0)` : "";
    }

    function onStart(event: TouchEvent) {
      const touch = event.touches[0];
      if (
        event.touches.length > 1 ||
        touch.clientX < EDGE_GUARD ||
        touch.clientX > window.innerWidth - EDGE_GUARD ||
        startsOutsideSwipe(event.target)
      ) {
        gesture = null;
        return;
      }
      gesture = { x: touch.clientX, y: touch.clientY, t: event.timeStamp, axis: null };
    }

    function onMove(event: TouchEvent) {
      const g = gesture;
      if (!g) return;
      const dx = event.touches[0].clientX - g.x;
      const dy = event.touches[0].clientY - g.y;
      if (!g.axis) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        g.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";
      }
      if (g.axis !== "x") return;
      const { prev, next } = latest.current;
      // Heavy resistance past the first or last tab, so the edge is felt.
      const target = dx < 0 ? next : prev;
      setOffset(target ? dx * 0.6 : dx * 0.15, false);
    }

    function onEnd(event: TouchEvent) {
      const g = gesture;
      gesture = null;
      if (!g || g.axis !== "x") return;
      const dx = event.changedTouches[0].clientX - g.x;
      const velocity = Math.abs(dx) / Math.max(1, event.timeStamp - g.t);
      const { prev, next, go } = latest.current;
      const target = dx < 0 ? next : prev;
      if (!target || (Math.abs(dx) < COMMIT_DISTANCE && velocity < COMMIT_VELOCITY)) {
        setOffset(0, true);
        return;
      }
      entering.current = dx < 0 ? "right" : "left";
      setOffset(dx < 0 ? -window.innerWidth * 0.35 : window.innerWidth * 0.35, true);
      go(target);
    }

    function onCancel() {
      if (gesture?.axis === "x") setOffset(0, true);
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
    <div ref={pane} className="tab-swipe">
      {children}
    </div>
  );
}
