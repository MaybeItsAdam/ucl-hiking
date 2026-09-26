import { can, canUseKit, type AccessProfile } from "@/lib/access";

export type AppPage = "events" | "members" | "equipment" | "settings";

export const APP_PAGE_HREFS: Record<AppPage, string> = {
  events: "/portal/events",
  members: "/portal/members",
  equipment: "/portal/equipment",
  settings: "/account",
};

/**
 * The signed-in app's pages, in tab order. Events and settings are everyone's,
 * and events comes first so it is where sign-in lands. Members is governance
 * only; equipment is for principals who lend kit and the explorers and
 * committee who borrow it.
 */
export function availablePages(profile: AccessProfile | null): AppPage[] {
  const pages: AppPage[] = [];
  if (profile) pages.push("events");
  if (profile && can(profile, "manage_members")) pages.push("members");
  if (profile && canUseKit(profile)) pages.push("equipment");
  pages.push("settings");
  return pages;
}
