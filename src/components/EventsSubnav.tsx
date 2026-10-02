import Link from "next/link";

export type EventsSection = "upcoming" | "mine" | "rota" | "leaderboard" | "programme";

/** Upcoming · My walks · Rota · Leaders (walk leaders and up) · Programme (committee). */
export function EventsSubnav({
  active,
  showRota,
  showProgramme = false,
}: {
  active: EventsSection;
  showRota: boolean;
  showProgramme?: boolean;
}) {
  const items: { key: EventsSection; href: string; label: string }[] = [
    { key: "upcoming", href: "/portal/events", label: "Upcoming" },
    { key: "mine", href: "/portal/events/mine", label: "My walks" },
  ];
  if (showRota) {
    items.push({ key: "rota", href: "/portal/events/rota", label: "Rota" });
    items.push({ key: "leaderboard", href: "/portal/events/leaderboard", label: "Leaders" });
  }
  if (showProgramme) items.push({ key: "programme", href: "/portal/events/programme", label: "Programme" });
  return (
    <nav className="portal-subnav club-subnav" aria-label="Events">
      {items.map((item) => (
        <Link key={item.key} href={item.href} className={item.key === active ? "active" : undefined} aria-current={item.key === active ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
