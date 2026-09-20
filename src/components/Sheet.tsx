"use client";

import { useEffect, useRef, type ReactNode, type TouchEvent } from "react";

/** Past this much of a downward drag, letting go closes the sheet. */
const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.6; // px per ms

let lockCount = 0;
let lockedScrollY = 0;

/**
 * Stop the page behind the sheet from scrolling. `overflow: hidden` alone is
 * ignored by iOS Safari, so the body is pinned in place and put back after.
 */
function lockPage() {
  if (lockCount++ > 0) return;
  lockedScrollY = window.scrollY;
  const { body } = document;
  body.style.position = "fixed";
  body.style.top = `-${lockedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
}

function unlockPage() {
  if (--lockCount > 0) return;
  const { body } = document;
  body.style.position = "";
  body.style.top = "";
  body.style.left = "";
  body.style.right = "";
  body.style.width = "";
  window.scrollTo(0, lockedScrollY);
}

/**
 * A dialog on a desktop, a bottom sheet on a phone: it rises from the bottom
 * edge, has a grab handle, and can be flicked back down or dismissed by
 * tapping the dimmed page behind it.
 */
export function Sheet({
  onClose,
  labelledBy,
  children,
}: {
  onClose: () => void;
  /** id of the heading inside `children`, so the dialog is named for screen readers. */
  labelledBy?: string;
  children: ReactNode;
}) {
  const card = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dragging: boolean } | null>(null);

  useEffect(() => {
    lockPage();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      unlockPage();
    };
  }, [onClose]);

  // Focus the sheet itself so the keyboard and screen reader follow it in, and
  // so Escape works before anything inside has been touched.
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
  }, []);

  function offset(px: number, animate: boolean) {
    const el = card.current;
    if (!el) return;
    el.style.transition = animate ? "transform .24s cubic-bezier(.2,.8,.2,1)" : "none";
    el.style.transform = px ? `translate3d(0,${px}px,0)` : "";
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    const el = card.current;
    if (!el || event.touches.length > 1) {
      drag.current = null;
      return;
    }
    const target = event.target as HTMLElement;
    const fromHandle = Boolean(target.closest(".sheet-grip"));
    // Anywhere else, the drag only starts if the sheet is scrolled to the top
    // and the finger did not land on something that handles its own touches.
    const fromBody =
      el.scrollTop <= 0 && !target.closest("input, textarea, select, button, a, [data-no-drag]");
    if (!fromHandle && !fromBody) {
      drag.current = null;
      return;
    }
    drag.current = { y: event.touches[0].clientY, t: event.timeStamp, dragging: fromHandle };
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dy = event.touches[0].clientY - d.y;
    if (!d.dragging) {
      if (dy < 10) return;
      d.dragging = true;
    }
    // Upward is the sheet's own scrolling; only the downward drag is ours.
    offset(Math.max(0, dy), false);
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d?.dragging) return;
    const dy = event.changedTouches[0].clientY - d.y;
    const velocity = dy / Math.max(1, event.timeStamp - d.t);
    if (dy > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
      onClose();
      return;
    }
    offset(0, true);
  }

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={card}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => {
          drag.current = null;
          offset(0, true);
        }}
      >
        {/* Grab handle: the sheet's own Cancel button is what closes it, so this
            is a target for the drag and a signal that the drag exists. */}
        <div className="sheet-grip" aria-hidden="true">
          <span className="sheet-handle" />
        </div>
        {children}
      </div>
    </div>
  );
}
