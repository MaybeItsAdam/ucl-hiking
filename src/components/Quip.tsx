"use client";

import { useQuip, QUIPS, type QuipKind } from "@/lib/quips";

/** A random one-liner; keeps its space while hydrating so nothing jumps. */
export function Quip({ kind, className }: { kind: QuipKind; className?: string }) {
  const quip = useQuip(kind);
  return (
    <p className={className} style={quip ? undefined : { visibility: "hidden" }}>
      {quip ?? QUIPS[kind][0]}
    </p>
  );
}
