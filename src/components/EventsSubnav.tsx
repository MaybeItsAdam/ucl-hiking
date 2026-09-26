import Link from "next/link";

export type EventsSection = "upcoming" | "mine" | "rota";

/** Upcoming · My walks · Rota (leaders and committee only). */
export function EventsSubnav({ active, showRota }: { active: EventsSection; showRota: boolean }) {
  const items: { key: EventsSection; href: string; label: string }[] = [
    { key: "upcoming", href: "/portal/events", label: "Upcoming" },
    { key: "mine", href: "/portal/events/mine", label: "My walks" },
  ];
  if (showRota) items.push({ key: "rota", href: "/portal/events/rota", label: "Rota" });
  return (
    <nav className="portal-subnav" aria-label="Events">
      {items.map((item) => (
        <Link key={item.key} href={item.href} className={item.key === active ? "active" : undefined} aria-current={item.key === active ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
