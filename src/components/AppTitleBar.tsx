"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The phone header: a large page title that scrolls away, and a compact bar
 * that takes over once it has gone — the arrangement every native list uses,
 * so where you are stays on screen without costing a fixed band of it.
 *
 * On wide screens the top bar carries the tabs and this is hidden by CSS.
 */
export function AppTitleBar({ title, action }: { title: string; action?: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    const mark = sentinel.current;
    if (!mark || typeof IntersectionObserver === "undefined") return;
    // Measured rather than assumed: the bar's height includes the notch inset,
    // which is 0 on Android and ~47px on a recent iPhone.
    const height = bar.current?.getBoundingClientRect().height ?? 44;
    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(!entry.isIntersecting),
      { rootMargin: `-${Math.round(height)}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(mark);
    return () => observer.disconnect();
  }, [title]);

  return (
    <>
      <div ref={bar} className={`app-titlebar${condensed ? " is-condensed" : ""}`}>
        <span className="app-titlebar-title">{title}</span>
      </div>
      <div className="app-page-head">
        <h1>{title}</h1>
        {action ? <div className="app-page-action">{action}</div> : null}
      </div>
      <div ref={sentinel} className="app-title-sentinel" aria-hidden="true" />
    </>
  );
}
