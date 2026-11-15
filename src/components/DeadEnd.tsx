import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Quip } from "@/components/Quip";
import type { QuipKind } from "@/lib/quips";

/** The card for a dead end (missing page, crash): an icon, a heading, a one-liner and a way out. */
export function DeadEnd({
  icon: Icon,
  label,
  title,
  quip,
  children,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  quip: QuipKind;
  children: ReactNode;
}) {
  return (
    <div className="dead-end">
      <div className="dead-end-icon">
        <Icon size={28} aria-hidden="true" />
      </div>
      <span className="dead-end-label">{label}</span>
      <h1>{title}</h1>
      <Quip kind={quip} className="dead-end-quip" />
      <div className="dead-end-actions">{children}</div>
    </div>
  );
}
