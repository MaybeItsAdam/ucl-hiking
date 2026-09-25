"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, Package, Settings, Users } from "lucide-react";
import { APP_PAGE_HREFS, type AppPage } from "@/lib/app-pages";

export const PAGE_META: Record<AppPage, { label: string; icon: typeof Users }> = {
  events: { label: "Events", icon: CalendarDays },
  members: { label: "Members", icon: Users },
  equipment: { label: "Equipment", icon: Package },
  settings: { label: "Settings", icon: Settings },
};

function pageForPath(pages: AppPage[], pathname: string): AppPage {
  return (
    pages.find((page) => pathname === APP_PAGE_HREFS[page] || pathname.startsWith(`${APP_PAGE_HREFS[page]}/`)) ??
    pages[0]
  );
}

type AppNav = {
  pages: AppPage[];
  /** The tab to show as current: the one just tapped, before its page has arrived. */
  active: AppPage;
  go: (page: AppPage) => void;
};

const AppNavContext = createContext<AppNav | null>(null);

export function useAppNav(): AppNav {
  const nav = useContext(AppNavContext);
  if (!nav) throw new Error("useAppNav must be used inside AppNavProvider");
  return nav;
}

/**
 * Which tab is current, shared by the tab bar, the title bar and the swipe
 * gesture. A tap or swipe moves the highlight and the title at once rather than
 * when the server answers, which is most of what makes a tab bar feel instant.
 */
export function AppNavProvider({ pages, children }: { pages: AppPage[]; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Tied to the path it was chosen from, so it lapses by itself once the page changes.
  const [pending, setPending] = useState<{ page: AppPage; from: string } | null>(null);
  const active = pending && pending.from === pathname ? pending.page : pageForPath(pages, pathname);

  function go(page: AppPage) {
    if (page === active) return;
    setPending({ page, from: pathname });
    router.push(APP_PAGE_HREFS[page]);
  }

  return <AppNavContext.Provider value={{ pages, active, go }}>{children}</AppNavContext.Provider>;
}

export function AppTabs() {
  const pathname = usePathname();
  const { pages, active, go } = useAppNav();
  if (pages.length < 2) return null;

  return (
    <nav className="app-tabs" aria-label="Sections">
      {pages.map((page) => {
        const { label, icon: Icon } = PAGE_META[page];
        const href = APP_PAGE_HREFS[page];
        return (
          <Link
            key={page}
            href={href}
            className={page === active ? "active" : undefined}
            aria-current={page === active ? "page" : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              // Tapping the current tab again takes you back to the top of it.
              if (page === active && pathname === href) window.scrollTo({ top: 0 });
              else go(page);
            }}
          >
            <span className="app-tab-icon">
              <Icon size={18} aria-hidden="true" />
            </span>
            <span className="app-tab-label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
