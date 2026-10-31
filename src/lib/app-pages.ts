import { can, canUseKit, type AccessProfile } from "@/lib/access";
import { claimKindsFor } from "@/lib/expenseClaims";

export type AppPage = "events" | "navigator" | "members" | "equipment" | "club" | "handbook" | "expenses" | "settings";

export const APP_PAGE_HREFS: Record<AppPage, string> = {
  events: "/portal/events",
  navigator: "/portal/navigator",
  members: "/portal/members",
  equipment: "/portal/equipment",
  club: "/portal/club",
  handbook: "/portal/handbook",
  expenses: "/portal/expenses",
  settings: "/account",
};

/**
 * The signed-in app's pages, in tab order. Events, the Navigator and settings
 * are everyone's, and events comes first so it is where sign-in lands. The
 * Navigator (the club magazine) sits right after it, ahead of the role-specific
 * tabs, so it is in the same place for every member and one swipe from Events. Members is governance
 * only; equipment is for principals who lend kit and the explorers and
 * committee who borrow it. Club (broadcasts, stats, money, handbook) is the
 * committee's. Everyone else gets a Handbook tab once the committee shares a
 * page with them (`sharedHandbook`); the committee reads it from Club.
 * Expenses is for anyone who can claim: walk leaders and committee.
 */
export function availablePages(profile: AccessProfile | null, sharedHandbook = false): AppPage[] {
  const pages: AppPage[] = [];
  if (profile) pages.push("events", "navigator");
  if (profile && can(profile, "manage_members")) pages.push("members");
  if (profile && canUseKit(profile)) pages.push("equipment");
  if (profile && can(profile, "manage_club")) pages.push("club");
  else if (profile && sharedHandbook) pages.push("handbook");
  if (profile && claimKindsFor(profile).length) pages.push("expenses");
  pages.push("settings");
  return pages;
}
