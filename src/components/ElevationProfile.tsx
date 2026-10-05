"use client";

import type { KeyboardEvent, PointerEvent } from "react";
import { formatKm } from "@/lib/eventDetails";

const STEP_KM = 0.1;
const PAGE_KM = 1;

/** The height at `km`, read off the profile between its two neighbours. */
function heightAt(profile: [number, number][], km: number): number {
  if (km <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    const [k1, e1] = profile[i];
    if (k1 >= km) {
      const [k0, e0] = profile[i - 1];
      const t = k1 > k0 ? (km - k0) / (k1 - k0) : 0;
      return e0 + (e1 - e0) * t;
    }
  }
  return profile[profile.length - 1][1];
}

const readout = (km: number, m: number) => `${km.toFixed(1)} km · ${Math.round(m).toLocaleString("en-GB")} m`;

/**
 * The walk's height along its length: a filled line on a hairline grid, the
 * way a printed route card draws it. Pure SVG, so it prints and costs nothing.
 *
 * Given `onScrub` it also reads back: a finger or pointer over the strip (or
 * the arrow keys once focused) picks a km along the walk, which the page can
 * show on the map. `at` draws a cursor there with its distance and height.
 * Without `onScrub` it's the still picture it always was.
 */
export function ElevationProfile({
  profile,
  at = null,
  onScrub,
}: {
  profile: [number, number][];
  at?: number | null;
  onScrub?: (km: number | null) => void;
}) {
  if (profile.length < 2) return null;
  const W = 600;
  const H = 96;
  const total = profile[profile.length - 1][0];
  const heights = profile.map((p) => p[1]);
  const lo = Math.min(...heights);
  const hi = Math.max(...heights);
  // At least 60 m of range, so a flat walk looks flat rather than jagged.
  const span = Math.max(hi - lo, 60);
  const floor = lo - (span - (hi - lo)) / 2;
  const x = (km: number) => (km / total) * W;
  const y = (m: number) => H - 6 - ((m - floor) / span) * (H - 14);
  const line = profile.map(([km, m], i) => `${i ? "L" : "M"}${x(km).toFixed(1)},${y(m).toFixed(1)}`).join("");
  const highest = profile.reduce((a, b) => (b[1] > a[1] ? b : a));

  const clamp = (km: number) => Math.min(Math.max(km, 0), total);
  const cursor = typeof at === "number" && Number.isFinite(at) ? clamp(at) : null;
  const cursorM = cursor === null ? null : heightAt(profile, cursor);

  const svg = (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Height along the walk, from ${lo} to ${hi} metres`}>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} className="elevation-grid" x1={W * f} x2={W * f} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
      ))}
      <path className="elevation-fill" d={`${line}L${W},${H}L0,${H}Z`} />
      <path className="elevation-line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );

  // Percentages, so the cursor tracks the stretched SVG without measuring it.
  const marker =
    cursor !== null && cursorM !== null ? (
      <span className="elevation-cursor" style={{ left: `${(x(cursor) / W) * 100}%` }} aria-hidden="true">
        <span className="elevation-dot" style={{ top: `${(y(cursorM) / H) * 100}%` }} />
      </span>
    ) : null;

  let plot = (
    <div className="elevation-plot">
      {svg}
      {marker}
    </div>
  );

  if (onScrub) {
    const kmAt = (e: PointerEvent<HTMLDivElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      return box.width > 0 ? clamp(((e.clientX - box.left) / box.width) * total) : 0;
    };
    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
      // Keep a dragging finger's moves coming here even when it strays off the strip.
      if (e.pointerType !== "mouse") e.currentTarget.setPointerCapture(e.pointerId);
      onScrub(kmAt(e));
    };
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
      // A mouse reads on hover; a finger only while it's down.
      if (e.pointerType === "mouse" || e.currentTarget.hasPointerCapture(e.pointerId)) onScrub(kmAt(e));
    };
    const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== "mouse") onScrub(null);
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      const from = cursor ?? 0;
      const next: Record<string, number | null> = {
        ArrowRight: from + STEP_KM,
        ArrowUp: from + STEP_KM,
        ArrowLeft: from - STEP_KM,
        ArrowDown: from - STEP_KM,
        PageUp: from + PAGE_KM,
        PageDown: from - PAGE_KM,
        Home: 0,
        End: total,
        Escape: null,
      };
      if (!(e.key in next)) return;
      e.preventDefault();
      const km = next[e.key];
      onScrub(km === null ? null : Math.round(clamp(km) * 100) / 100);
    };
    const now = cursor ?? 0;
    plot = (
      <div
        className="elevation-plot is-scrubbable"
        tabIndex={0}
        role="slider"
        aria-label="Distance along the walk"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.round(now * 100) / 100}
        aria-valuetext={readout(now, heightAt(profile, now))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={() => onScrub(null)}
        onPointerLeave={() => onScrub(null)}
        onKeyDown={onKeyDown}
      >
        {svg}
        {marker}
      </div>
    );
  }

  return (
    <figure className="elevation">
      <figcaption className="elevation-labels">
        <span>Elevation</span>
        {cursor !== null && cursorM !== null ? (
          <span className="elevation-readout">{readout(cursor, cursorM)}</span>
        ) : (
          <span>
            {lo} – {hi} m · high point {formatKm(highest[0])} in
          </span>
        )}
      </figcaption>
      {plot}
      <div className="elevation-axis" aria-hidden="true">
        <span>0</span>
        <span>{formatKm(total)}</span>
      </div>
    </figure>
  );
}
