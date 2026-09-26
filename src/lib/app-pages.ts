import { can, canUseKit, type AccessProfile } from "@/lib/access";

export type AppPage = "events" | "members" | "equipment" | "club" | "settings";

export const APP_PAGE_HREFS: Record<AppPage, string> = {
  events: "/portal/events",
  members: "/portal/members",
  equipment: "/portal/equipment",
  club: "/portal/club",
  settings: "/account",
};

/**
 * The signed-in app's pages, in tab order. Events and settings are everyone's,
 * and events comes first so it is where sign-in lands. Members is governance
 * only; equipment is for principals who lend kit and the explorers and
 * committee who borrow it. Club (broadcasts, stats, money, handbook) is the
 * committee's.
 */
export function availablePages(profile: AccessProfile | null): AppPage[] {
  const pages: AppPage[] = [];
  if (profile) pages.push("events");
  if (profile && can(profile, "manage_members")) pages.push("members");
  if (profile && canUseKit(profile)) pages.push("equipment");
  if (profile && can(profile, "manage_club")) pages.push("club");
  pages.push("settings");
  return pages;
}
