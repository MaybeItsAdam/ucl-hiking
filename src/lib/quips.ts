"use client";

import { useSyncExternalStore } from "react";

/**
 * One-liners for the pages nobody wants to see: a missing page, a crash, no
 * signal. A light touch so a dead end doesn't feel like one; the heading and
 * the buttons around them still say plainly what happened.
 */
export const QUIPS = {
  notFound: [
    "This path isn't on any map we own.",
    "You've wandered off the trail. Retrace your steps to the last stile.",
    "No trig point here. Just bracken.",
    "This page took the scenic route and never came back.",
    "Even the sheep don't know where this goes.",
    "Wrong turn at the kissing gate.",
  ],
  error: [
    "We've hit a bog. Give it a moment and try again.",
    "A stile gave way under this page. We're on it.",
    "The weather's turned on the server. Try again shortly.",
    "Nobody panic. Check the map, then try again.",
  ],
  offline: [
    "Classic hill.",
    "Zero bars. You must be somewhere lovely.",
    "The internet stayed in London.",
    "Out of signal, hopefully not out of snacks.",
  ],
} as const;

export type QuipKind = keyof typeof QUIPS;

// One pick per kind per page load, so a re-render doesn't change the joke.
const chosen: Partial<Record<QuipKind, string>> = {};
const subscribe = () => () => {};

/**
 * A random quip of the kind, or null while server rendering and hydrating (a
 * random pick there would differ between server and phone).
 */
export function useQuip(kind: QuipKind): string | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const list = QUIPS[kind];
      return (chosen[kind] ??= list[Math.floor(Math.random() * list.length)]);
    },
    () => null,
  );
}
