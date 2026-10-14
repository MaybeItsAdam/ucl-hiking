import type { ReactNode } from "react";
import Link from "next/link";
import { ClubMark } from "@/components/ClubMark";
import { AccountButton } from "@/components/AccountButton";
import { AppNavProvider, AppTabs } from "@/components/AppNav";
import { AppTitleBar } from "@/components/AppTitleBar";
import { InboxBell } from "@/components/InboxBell";
import { PullToRefresh } from "@/components/PullToRefresh";
import { TabSwipe } from "@/components/TabSwipe";
import { availablePages } from "@/lib/app-pages";
import { sharedWith } from "@/lib/handbook";
import { getCurrentMember, getRolePreviewState } from "@/lib/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/** Whether the committee have shared a handbook page with this member, which earns them the Handbook tab. */
async function hasSharedHandbook(isWalkLeader: boolean): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const { count, error } = await getSupabaseAdmin()
    .from("club_docs")
    .select("slug", { count: "exact", head: true })
    .in("visibility", sharedWith(isWalkLeader));
  return !error && (count ?? 0) > 0;
}

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
    // The committee read the handbook from Club, so only ask for everyone else.
    member && !member.governance_role ? await hasSharedHandbook(member.is_walk_leader) : false,
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
          {member ? <InboxBell className="app-bar-inbox" /> : null}
          {previewState.canPreviewRoles && (
            <div className="app-bar-account">
              <AccountButton
                member={member}
                canPreviewRoles={previewState.canPreviewRoles}
                previewableRoles={previewState.previewableRoles}
                preview={previewState.preview}
                realMember={previewState.realMember}
              />
            </div>
          )}
        </header>
        <AppTitleBar inbox={Boolean(member)} />
        <main className="app-main">
          <PullToRefresh>
            <TabSwipe>{children}</TabSwipe>
          </PullToRefresh>
        </main>
      </div>
    </AppNavProvider>
  );
}
