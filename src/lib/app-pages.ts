import { can, type AccessProfile } from "@/lib/access";

export type AppPage = "members" | "equipment" | "settings";

export const APP_PAGE_HREFS: Record<AppPage, string> = {
  members: "/portal/members",
  equipment: "/portal/equipment",
  settings: "/account",
};

/**
 * The signed-in app's pages, in tab order. Members and equipment are governance
 * only for now: principals lend kit, committee borrow it from them. Settings is
 * everyone's.
 */
export function availablePages(profile: AccessProfile | null): AppPage[] {
  const pages: AppPage[] = [];
  if (profile && can(profile, "manage_members")) pages.push("members");
  if (profile && profile.governanceRole !== null) pages.push("equipment");
  pages.push("settings");
  return pages;
}
