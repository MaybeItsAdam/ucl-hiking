import type { ReactNode } from "react";
import Link from "next/link";
import { ClubMark } from "@/components/ClubMark";
import { AccountButton } from "@/components/AccountButton";
import { AppNavProvider, AppTabs } from "@/components/AppNav";
import { AppTitleBar } from "@/components/AppTitleBar";
import { PullToRefresh } from "@/components/PullToRefresh";
import { TabSwipe } from "@/components/TabSwipe";
import { availablePages } from "@/lib/app-pages";
import { getCurrentMember, getRolePreviewState } from "@/lib/session";

/**
 * Full-width frame for the signed-in app. The tabs sit in the top bar on wide
 * screens and become a bottom tab bar on phones and in the native app, where
 * the page title takes over the top and pulling down reloads the page.
 *
 * Rendered once by the (app) layout, so it stays on screen while the tabs
 * change underneath it instead of being rebuilt by every page.
 */
export async function AppShell({ children }: { children: ReactNode }) {
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
    <AppNavProvider pages={pages}>
      <div className={`app-shell${pages.length > 1 ? " has-tabs" : ""}`}>
        <header className="app-bar">
          <Link className="app-brand" href="/" aria-label="UCL Hiking Club home">
            <ClubMark size={30} />
            <span>UCL Hiking</span>
          </Link>
          <AppTabs />
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
        <AppTitleBar />
        <main className="app-main">
          <PullToRefresh>
            <TabSwipe>{children}</TabSwipe>
          </PullToRefresh>
        </main>
      </div>
    </AppNavProvider>
  );
}
