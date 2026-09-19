import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, Package, Settings, Users } from "lucide-react";
import { ClubMark } from "@/components/ClubMark";
import { AccountButton } from "@/components/AccountButton";
import { TabSwipe } from "@/components/TabSwipe";
import { APP_PAGE_HREFS, availablePages, type AppPage } from "@/lib/app-pages";
import { getCurrentMember, getRolePreviewState } from "@/lib/session";

const PAGE_META: Record<AppPage, { label: string; icon: typeof Users }> = {
  events: { label: "Events", icon: CalendarDays },
  members: { label: "Members", icon: Users },
  equipment: { label: "Equipment", icon: Package },
  settings: { label: "Settings", icon: Settings },
};

/**
 * Full-width frame for the signed-in app. The tabs sit in the top bar on wide
 * screens and become a bottom tab bar on phones and in the native app.
 */
export async function AppShell({ active, children }: { active: AppPage; children: ReactNode }) {
  const member = await getCurrentMember();
  const previewState = await getRolePreviewState();
  const pages = availablePages(
    member
      ? {
          membershipTier: member.membership_tier,
          governanceRole: member.governance_role,
          isWalkLeader: member.is_walk_leader,
        }
      : null,
  );

  return (
    <div className={`app-shell${pages.length > 1 ? " has-tabs" : ""}`}>
      <header className="app-bar">
        <Link className="app-brand" href="/" aria-label="UCL Hiking Club home">
          <ClubMark size={30} />
          <span>UCL Hiking</span>
        </Link>
        {pages.length > 1 && (
          <nav className="app-tabs" aria-label="Sections">
            {pages.map((page) => {
              const { label, icon: Icon } = PAGE_META[page];
              return (
                <Link
                  key={page}
                  href={APP_PAGE_HREFS[page]}
                  className={page === active ? "active" : undefined}
                  aria-current={page === active ? "page" : undefined}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
        )}
        {previewState.isRealAdmin && (
          <div className="app-bar-account">
            <AccountButton
              member={member}
              isRealAdmin={previewState.isRealAdmin}
              preview={previewState.preview}
              realMember={previewState.realMember}
            />
          </div>
        )}
      </header>
      <main className="app-main">
        <TabSwipe hrefs={pages.map((page) => APP_PAGE_HREFS[page])} active={pages.indexOf(active)}>
          {children}
        </TabSwipe>
      </main>
    </div>
  );
}
