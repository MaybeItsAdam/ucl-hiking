import Link from "next/link";

export type ClubSection = "stats" | "broadcast" | "money" | "handbook" | "incidents";

/** Stats · Broadcast · Money · Handbook · Incidents; money and incidents are principals'. */
export function ClubSubnav({ active, principal }: { active: ClubSection; principal: boolean }) {
  const items: { key: ClubSection; href: string; label: string }[] = [
    { key: "stats", href: "/portal/club", label: "Stats" },
    { key: "broadcast", href: "/portal/club/broadcast", label: "Broadcast" },
    ...(principal ? [{ key: "money" as const, href: "/portal/club/money", label: "Money" }] : []),
    { key: "handbook", href: "/portal/club/handbook", label: "Handbook" },
    ...(principal ? [{ key: "incidents" as const, href: "/portal/club/incidents", label: "Incidents" }] : []),
  ];
  return (
    <nav className="portal-subnav club-subnav" aria-label="Club">
      {items.map((item) => (
        <Link key={item.key} href={item.href} className={item.key === active ? "active" : undefined} aria-current={item.key === active ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
