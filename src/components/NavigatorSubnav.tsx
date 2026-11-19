import Link from "next/link";

/** Magazine · Photos: the Navigator tab holds the club's archive, the magazine and the trip albums. */
export function NavigatorSubnav({ active }: { active: "magazine" | "photos" }) {
  const items = [
    { key: "magazine", href: "/portal/navigator", label: "Magazine" },
    { key: "photos", href: "/portal/navigator/photos", label: "Photos" },
  ] as const;
  return (
    <nav className="portal-subnav club-subnav" aria-label="Archive">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={item.key === active ? "active" : undefined}
          aria-current={item.key === active ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
